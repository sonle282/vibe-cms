// P7 e2e: headless Chrome drives /admin of the BUILT demo site (wrangler dev --local with local D1 / KV / rate limits,
// see lib/e2e-site.mjs). The owner signs in (bootstrap → own password), edits EVERY field of the demo — salon info
// (text, maxLength, locked phone / email / address / hours, rich text, image + alt, ordered references, nested lists,
// dotted keys), a service, a new service, team members (image, single + ordered multiple references), a Markdown
// post (status, list, body) — saves drafts through the P5 API and the drafts are compared with the expected content.
// P8: the owner reviews every draft (what changes, in plain words) and publishes them — one commit on a fake GitHub on
// 127.0.0.1, whose files then hold exactly the drafts; the admin says "Publishing…".
// P8b: the owner adds the editor on the People screen (temporary password shown once). P8c: unsafe HTML typed into rich
// text is removed on save. P10: a photo is uploaded through the image sheet (made smaller + WebP in the browser, kept in
// local R2, served at its final address) and published in the same commit, exact bytes. P8d: the blog post is written
// in the visual editor (bold, heading, list, an uploaded image resized by dragging its corner) and saved as Markdown.
// P9: the preview next to the form shows the draft on the real page as it is typed (no reload, < 16 ms a key), links
// the page and the form both ways, and shows a new service in its list.
// Then the editor signs in: locked fields are shown but disabled, other fields save; they change their own password on
// the Change password dialog. Nothing remote; test values only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { contentPaths, loadCmsConfig } from "../dist/index.js";
import { lineDiff } from "../test/helpers/diff.mjs";
import { startFakeGitHub } from "../test/helpers/fake-github.mjs";
import { tinyPng } from "../test/helpers/images.mjs";
import { findChrome, site, startDemoWithCms } from "./lib/e2e-site.mjs";

const BOOT = { username: "owner", password: "bootstrap-e2e-secret" };
const OWNER_PASSWORD = "owner-e2e-password-1";
const EDITOR_PASSWORD = "editor-e2e-password-2";
const data = (path) => JSON.parse(readFileSync(join(site, path), "utf8"));
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); if (!ok) console.error(`✘ ${name}\n${JSON.stringify(detail ?? null, null, 1).slice(0, 3000)}`); };

const demoConfig = await loadCmsConfig(join(site, "cms.config.ts"));
const demoFiles = Object.fromEntries(contentPaths(demoConfig, site).map((path) => [path, readFileSync(join(site, path), "utf8")]));
const github = await startFakeGitHub({ owner: demoConfig.repo.owner, name: demoConfig.repo.name, branch: demoConfig.repo.branch, files: demoFiles });
// VIBE_GITHUB_API_URL is honoured only for this machine (loopback): the token never leaves 127.0.0.1 in this test.
const server = await startDemoWithCms({ CMS_BOOTSTRAP_USERNAME: BOOT.username, CMS_BOOTSTRAP_PASSWORD: BOOT.password, VIBE_GITHUB_TOKEN: github.token, VIBE_GITHUB_API_URL: github.url });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const problems = [];
try {
  const { base } = server;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|Blocked form submission to '\/contact' because the form's frame is sandboxed/.test(message.text())) problems.push(`console: ${message.text()}`); });
  page.on("response", (response) => { if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${response.url()}`); });

  const field = (path) => page.locator(`[data-path=${JSON.stringify(path)}]`);
  const input = (path) => field(path).locator("input, textarea, select").first();
  const button = (path, name) => field(path).getByRole("button", { name, exact: true });
  // M3 (Mr Spa): the inspector shows one section at a time — open it from its row (going back first if another is open).
  const section = async (key) => {
    if (await page.locator(`.vc-form > [data-section="${key}"]:not([hidden])`).count()) return;
    if (await page.locator(".vc-inspector-back:not([hidden])").count()) await page.locator(".vc-inspector-back").click();
    await page.locator(`[data-section-key="${key}"]`).click();
    await page.locator(`.vc-form > [data-section="${key}"]:not([hidden])`).waitFor();
  };
  // M4: a Link field — Web address, then the address (a page of the site would be picked from its list).
  const link = async (path, value) => { await field(path).getByRole("radio", { name: "Web address" }).click(); await field(path).locator("input.vc-link-text").fill(value); };
  // M5 (Mr Spa): an image card — Replace (or Choose image) opens the sheet; a tile, then Use image.
  const sheetFor = (label) => page.getByRole("dialog", { name: label ? `Choose image for ${label}` : "Choose an image" });
  const shownImage = (path) => field(path).locator(".vc-image-thumb img").getAttribute("src");
  const pickImage = async (path, label, src) => {
    await field(path).locator(".vc-image-replace, .vc-image-empty").first().click();
    const sheet = sheetFor(label);
    await sheet.locator(`.vc-sheet-tile[data-src="${src}"]`).click();
    await sheet.getByRole("button", { name: "Use image" }).click();
    await sheet.waitFor({ state: "detached" });
  };
  // M3: deleting a list item asks first (the CMS dialog, red Delete).
  const confirmDelete = async () => { const dialog = page.getByRole("alertdialog", { name: /^Delete / }); await dialog.getByRole("button", { name: "Delete", exact: true }).click(); await dialog.waitFor({ state: "detached" }); };
  // P8d: the visual editor — its editable area and a toolbar button (M10: the Mr Spa set, no source view).
  const rich = (path) => field(path).locator(".vc-rich-area");
  // M10: on the paper of a document the bar is on top of the paper, outside the field.
  const tool = (path, name) => page.locator(`[data-path="${path}"] .vc-rich-toolbar, .vc-doc-paper:has(> .vc-form > [data-path="${path}"]) > .vc-rich-toolbar`).getByRole("button", { name, exact: true });
  // P9: the preview pane (the real page in a same-origin iframe) and what it shows.
  const preview = page.frameLocator(".vc-preview-frame");
  const previewReady = () => page.locator('.vc-preview[data-state="ready"]').waitFor({ timeout: 20_000 });
  const previewWindow = () => page.frames().find((frame) => frame.url().includes("cmsPreview=1"));
  const saveState = () => page.locator(".vc-state-long").textContent();
  // E2E_SCREENSHOTS=<folder>: keep pictures of the image sheet, the review and published screens (local look only; CI leaves it unset).
  const shot = async (name) => { if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: join(process.env.E2E_SCREENSHOTS, `${name}.png`) }); };
  const api = (path) => page.evaluate(async (url) => (await fetch(url)).json(), path);
  const open = async (path) => { await page.goto(`${base}${path}`); await page.locator(".vc-inspector, .vc-form, .vc-list-table, .vc-rows, .vc-pages-columns, .vc-empty-state").first().waitFor(); };
  const save = async () => {
    await page.getByRole("button", { name: "Save draft" }).click();
    // M1 (Mr Spa): a record already on the website says only its changes are not live yet.
    await page.waitForFunction(() => /^Draft saved · (changes )?not live yet$/.test(document.querySelector(".vc-state-long")?.textContent ?? ""), null, { timeout: 10_000 });
  };
  const signIn = async (username, password, newPassword) => {
    await page.goto(`${base}/admin`);
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.click("#login button[type=submit]");
    await page.locator("#change").waitFor();
    await page.fill("#current", password);
    await page.fill("#new", newPassword);
    await page.click("#change button[type=submit]");
    await page.locator(".vc-top").waitFor();
  };

  // ---------------------------------------------------------------- owner: sign in, overview
  const adminResponse = await page.goto(`${base}/admin`);
  check("/admin: no framing, no caching", adminResponse.headers()["x-frame-options"] === "DENY" && /no-store/.test(adminResponse.headers()["cache-control"] ?? ""), adminResponse.headers());
  check("signed out → the sign-in form posts", (await page.locator("form#login").getAttribute("method")) === "post");
  check("sign-in (U4): the site's mark and name, its address, one primary button", /^Sign in to Demo Salon$/.test((await page.locator("form#login h1").textContent()) ?? "") && /Edit the website at demo.example/.test(await page.locator("form#login").innerText()));
  await shot("u4-sign-in");
  // M12 (Mr Spa): a problem is said just above the button, which reads "Sign in" again; a phone still gets the form.
  await page.fill("#username", "nobody-here");
  await page.fill("#password", "not-a-real-password");
  await page.click("#login button[type=submit]");
  await page.locator("#login .vc-error", { hasText: /\S/ }).waitFor();
  const signInOrder = await page.locator("#login").evaluate((form) => [...form.children].map((element) => element.classList.contains("vc-error") ? "error" : element.tagName === "BUTTON" ? "button" : "").filter(Boolean).join(" "));
  check("sign-in: the problem is above the button, the button reads Sign in again", signInOrder === "error button" && (await page.locator("#login button[type=submit]").textContent()) === "Sign in" && await page.locator("#login button[type=submit]").isEnabled(), signInOrder);
  await page.setViewportSize({ width: 390, height: 800 });
  check("sign-in on a phone: the form, not Open on a laptop", await page.locator("form#login").isVisible() && !(await page.locator(".vc-small-screen").isVisible()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(BOOT.username, BOOT.password, OWNER_PASSWORD);
  // U4: smaller than 900 px, the editor asks for a laptop (Mr Spa 24).
  await page.setViewportSize({ width: 900, height: 900 });
  check("small screen: Open on a laptop, the editor hidden", await page.locator(".vc-small-screen").isVisible() && !(await page.locator(".vc-rail").isVisible()) && /Open on a laptop/.test(await page.locator(".vc-small-screen").innerText()));
  await page.setViewportSize({ width: 1280, height: 900 });
  // M1 (Mr Spa): /admin opens the first page's editor, at its own address.
  await page.locator(".vc-inspector").waitFor();
  check("/admin opens the first page's editor (M1)", new URL(page.url()).pathname === "/admin/pages/site", page.url());
  await open("/admin/pages");
  const navText = await page.locator(".vc-rail").innerText();
  check("shell: the rail has Pages, every collection and Drafts", ["Pages", "Services", "Team", "Blog", "Drafts"].every((label) => navText.includes(label)), navText);
  // M7 (Mr Spa): Main pages | Across the whole site, each row with its address or what it holds, Live / Off.
  const pagesText = await page.locator(".vc-pages-columns").innerText();
  const columns = await page.evaluate(() => { const groups = [...document.querySelectorAll(".vc-pages-group")].map((group) => group.getBoundingClientRect()); return groups.map((box) => Math.round(box.left)); });
  check("Pages (M7): Main pages | Across the whole site (+ Policies), two columns, “2 pages · 2 site-wide areas”", /Main pages\s+Salon info\s+\/\s+Live/.test(pagesText) && /Across the whole site\s*Changes here show on every page\s+Notice\s+A short message at the top of every page\s+Live\s+Search & sharing\s+How the site looks in Google and when shared\s+Live\s+Policies\s+Privacy policy\s+\/privacy\/\s+Live/.test(pagesText) && new Set(columns).size === 2 && columns[1] > columns[0] && (await page.locator(".vc-pages-count").textContent()) === "2 pages · 2 site-wide areas", { pagesText, columns });
  // An area: on the page it is shown on, framed in teal; the inspector says where it is and what it holds; the switch.
  await page.locator(".vc-pages-row", { hasText: "Notice" }).click();
  await previewReady();
  await page.waitForFunction(() => [...(document.querySelector(".vc-preview-frame")?.contentDocument?.querySelectorAll("[data-vibe-cms-preview] div") ?? [])].some((box) => box.style.border.startsWith("3px solid") && box.style.display === "block"), null, { timeout: 10_000 }).catch(() => {});
  const area = await page.evaluate(() => {
    const frameBox = [...(document.querySelector(".vc-preview-frame")?.contentDocument?.querySelectorAll("[data-vibe-cms-preview] div") ?? [])].find((box) => box.style.border.startsWith("3px solid"));
    return { frame: frameBox ? [frameBox.style.display, getComputedStyle(frameBox).borderTopColor] : null, crumb: document.querySelector(".vc-inspector-crumb")?.textContent, title: document.querySelector(".vc-inspector-title")?.textContent, note: document.querySelector(".vc-area-description")?.textContent, status: document.querySelector('[data-path="enabled"] .vc-switch-text span')?.textContent, top: document.querySelector(".vc-top")?.innerText };
  });
  check("area (M7): framed in teal on the page; “Across the whole site” / Notice; “… Applies site-wide.”; the switch says what visitors see", assertEqual(area.frame, ["block", "rgb(15, 118, 110)"]) && area.crumb === "Across the whole site" && area.title === "Notice" && area.note === "A short message at the top of every page. Applies site-wide." && area.status === "On — visitors see this notice." && /Pages\s*\/\s*Notice/.test(area.top), area);
  await page.locator('[data-path="enabled"] .vc-switch').click();
  check("area (M7): switched off in the draft — “Off after you publish — visitors still see it until then.”", (await page.locator('[data-path="enabled"] .vc-switch-text span').textContent()) === "Off after you publish — visitors still see it until then.");
  await shot("m7-area");
  await page.locator('[data-path="enabled"] .vc-switch').click();
  // Search & sharing: its own screen — the cards, the description's N / 160, the Google and share previews.
  await open("/admin/pages/seo");
  await page.locator(".vc-seo-preview").waitFor();
  check("Search & sharing (M7): Search results · Sharing image, “38 / 160”, the Google result and the share card", assertEqual(await page.locator(".vc-seo-form .vc-section-title").allTextContents(), ["Search results", "Sharing image"]) && (await page.locator(".vc-seo-count").textContent()) === "38 / 160" && (await page.locator(".vc-seo-google-title").textContent()) === "Demo Salon — an invented salon" && (await page.locator(".vc-seo-share-site").textContent()) === "DEMO.EXAMPLE" && (await page.locator(".vc-preview-frame").count()) === 0);
  await shot("m7-search-sharing");
  await open("/admin/pages");
  await shot("u4-pages");

  // ---------------------------------------------------------------- owner: every field of the salon info
  const siteBefore = data("src/data/site.json");
  await open("/admin/pages/site");
  // P9: the page is shown next to the form (wide window), and stays the same page while typing (no reload).
  await previewReady();
  check("preview: the home page on the canvas, with how many places show the salon info", Number(await page.locator(".vc-preview").getAttribute("data-places")) >= 10, await page.locator(".vc-preview").getAttribute("data-places"));
  // The canvas settles once the inspector is laid out; the page is refitted on every resize (ResizeObserver): wait for it.
  const fitted = () => { const stage = document.querySelector(".vc-preview-stage")?.getBoundingClientRect(); const canvas = document.querySelector(".vc-preview")?.getBoundingClientRect(); return Boolean(stage && canvas) && (Math.abs(stage.width - (canvas.width - 48)) <= 2 || Math.abs(stage.height - (canvas.height - 48)) <= 2); };
  await page.waitForFunction(fitted, null, { timeout: 5_000 }).catch(() => {});
  const fit = await page.evaluate(() => { const frame = document.querySelector(".vc-preview-frame"); const stage = document.querySelector(".vc-preview-stage").getBoundingClientRect(); const canvas = document.querySelector(".vc-preview").getBoundingClientRect(); return { width: frame.style.width, scale: Number(document.querySelector(".vc-preview").dataset.scale), stage: [Math.round(stage.width), Math.round(stage.height)], canvas: [Math.round(canvas.width), Math.round(canvas.height)] }; });
  check("preview (M1): a 1280 px Laptop page scaled to fit the canvas inside its 24 px padding", fit.width === "1280px" && fit.scale < 1 && (Math.abs(fit.stage[0] - (fit.canvas[0] - 48)) <= 2 || Math.abs(fit.stage[1] - (fit.canvas[1] - 48)) <= 2), fit);
  const frame = await page.evaluate(() => { const box = (selector) => document.querySelector(selector)?.getBoundingClientRect(); return { rail: box(".vc-rail")?.width, top: box(".vc-top")?.height, inspector: box(".vc-editor-main")?.width, devices: Boolean(document.querySelector(".vc-top-center .vc-devices")), font: getComputedStyle(document.body).fontFamily }; });
  check("shell (U2): rail 64, top bar 56, inspector 360, devices in the top bar, Geist", frame.rail === 64 && frame.top === 56 && frame.inspector === 360 && frame.devices && /Geist/.test(frame.font), frame);
  await previewWindow().evaluate(() => { window.__vibeCmsStayed = true; });
  check("salon info: nothing changed yet", (await saveState()) === "No changes" && await page.getByRole("button", { name: "Save draft" }).isDisabled());
  // M3 (Mr Spa): level 1 — the tip and one row per section, in the order the page shows them, each with what it holds.
  const levelOne = await page.locator(".vc-section-row").evaluateAll((rows) => rows.map((row) => row.querySelector("strong").textContent));
  check("inspector level 1: Pages / Salon info, the tip, the sections in page order", (await page.locator(".vc-inspector-crumb").textContent()) === "Pages" && (await page.locator(".vc-inspector-title").textContent()) === "Salon info" && /Click any part of the page, or pick a section below\./.test(await page.locator(".vc-tip").innerText()) && assertEqual(levelOne, ["Homepage", "Menu", "Contact & hours", "Footer & search"]), levelOne);
  await shot("m3-inspector-sections");
  await section("home");
  check("inspector level 2: ← Close section, Salon info / Homepage, only its fields", (await page.locator(".vc-inspector-crumb").textContent()) === "Salon info" && (await page.locator(".vc-inspector-title").textContent()) === "Homepage" && await page.getByRole("button", { name: "Close section" }).isVisible() && !(await field("phone").isVisible()));
  const sectionChip = await preview.locator("[data-vibe-cms-preview] span").textContent();
  check("preview: opening a section outlines it with its name", sectionChip === "Homepage", sectionChip);
  await shot("m3-inspector-section");
  await input("name").fill("Demo Salon & Spa");
  await section("contact");
  await input("phone").fill("(555) 010-0001");
  await input("email").fill("hi@demo.example");
  await input("address.street").fill("2 Example Street");
  // M13: the footer's phone is the salon's phone (sameAs): it changed with it.
  check("save state counts unsaved changes", (await saveState()) === "5 unsaved changes", await saveState());
  // Hours: Mon–Fri closes later; Sunday opens; Saturday relabelled; Sunday row moved above Saturday.
  await field("hours[0]").getByLabel("Closes").fill("18:30");
  await field("hours[1]").getByLabel("Label (optional)").fill("Sat");
  await field("hours[2]").getByLabel("Closed").uncheck();
  await field("hours[2]").getByLabel("Opens").fill("10:00");
  await field("hours[2]").getByLabel("Closes").fill("16:00");
  await field("hours").getByRole("button", { name: "Move Row 3 up" }).click();
  // Typed key by key: every key shows on the page, without reloading it, each well under a frame (16 ms).
  await section("home");
  await input("tagline").fill("");
  await input("tagline").pressSequentially("Invented, and proud of it.");
  await input("hero.title").fill("Hello from Demo Salon");
  const paneData = await page.locator(".vc-preview").evaluate((element) => ({ updates: Number(element.dataset.updates), maxMs: Number(element.dataset.maxApplyMs) }));
  check("preview: typing shows at once — heading, tagline, and the name bound by selector (cms.config bind)", (await preview.locator("h1").textContent()) === "Hello from Demo Salon" && (await preview.locator('[data-cms-field="site.tagline"]').textContent()) === "Invented, and proud of it." && (await preview.locator("header .brand strong").textContent()) === "Demo Salon & Spa");
  check("preview: the page is never reloaded while typing", await previewWindow().evaluate(() => window.__vibeCmsStayed === true));
  check("preview: each key applied in under 16 ms", paneData.updates >= 26 && paneData.maxMs < 16, paneData);
  // From the form to the page: focusing a field outlines it, with its section and name.
  await section("contact");
  await input("address.street").focus();
  await page.waitForTimeout(300);
  check("preview: focusing a field outlines it on the page with “Section · Field”", (await preview.locator("[data-vibe-cms-preview] span").textContent()) === "Contact & hours · Address › Street");
  // From the page to the form: clicking an element opens its field.
  await preview.locator('[data-cms-field="site.phone"]').click();
  check("preview: clicking the phone on the page focuses its field", await page.evaluate(() => document.activeElement?.closest("[data-path]")?.getAttribute("data-path")) === "phone");
  await preview.getByRole("link", { name: "Elsewhere" }).click();
  await preview.locator("form button").click();
  await page.waitForTimeout(300);
  check("preview: links to other sites and forms do nothing", new URL(previewWindow().url()).pathname === "/" && await previewWindow().evaluate(() => window.__vibeCmsStayed === true));
  await section("home");
  // Typed in the visual editor, the word in italics with the toolbar's I.
  await rich("hero.text").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Everything here is ");
  await tool("hero.text", "Italic").click(); await page.keyboard.type("invented"); await tool("hero.text", "Italic").click();
  await page.keyboard.type(".");
  await pickImage("hero.image", "Picture", "/images/team-sam.svg");
  await field("hero.image").getByLabel("Image description").fill("A blue square");
  await field("highlights").locator("select").selectOption("nail-art");
  await button("highlights", "Move Classic Manicure up").click();
  await button("highlights", "Remove Spa Pedicure").click();
  await section("footer");
  await input("footerLinks[0].title").fill("Visit us");
  await field("footerLinks[0].links").getByRole("button", { name: "Add link" }).click();
  await input("footerLinks[0].links[2].label").fill("Blog");
  // M4 (Mr Spa): a link shows what it opens — Page for a page of the site, with its list and where it goes.
  const teamLink = field("footerLinks[0].links[1].href");
  check("link (M4): Page · Web address · Phone · Email, the site's pages, “Opens: demo.example/team/”",
    assertEqual(await teamLink.getByRole("radio").allTextContents(), ["Page", "Web address", "Phone", "Email"])
    && (await teamLink.getByRole("radio", { name: "Page" }).getAttribute("aria-checked")) === "true"
    && assertEqual(await teamLink.locator("select option").allTextContents(), ["Salon info — /", "Privacy policy — /privacy/", "Services — /services/", "Team — /team/"])
    && (await teamLink.locator(".vc-link-opens").textContent()) === "Opens: demo.example/team/"
    && (await teamLink.locator(".vc-help").textContent()) === "Link destination: not visible in the preview.",
  { kinds: await teamLink.getByRole("radio").allTextContents(), pages: await teamLink.locator("select option").allTextContents(), opens: await teamLink.locator(".vc-link-opens").textContent() });
  // A wrong address is never written: it says why, and Save waits until it is fixed.
  await link("footerLinks[0].links[2].href", "blog page");
  const newLink = field("footerLinks[0].links[2].href");
  check("link (M4): a wrong address says why in plain words, “— until this is fixed”, Save off with the reason",
    (await newLink.locator(".vc-link-error").textContent()) === "Enter a full web address, like https://example.com or /about."
    && /— until this is fixed$/.test(await newLink.locator(".vc-link-opens").textContent())
    && await page.getByRole("button", { name: "Save draft" }).isDisabled()
    && (await page.getByRole("button", { name: "Save draft" }).getAttribute("data-tooltip")) === "Fix the link marked in red before saving.",
  { error: await newLink.locator(".vc-link-error").textContent(), opens: await newLink.locator(".vc-link-opens").textContent(), tooltip: await page.getByRole("button", { name: "Save draft" }).getAttribute("data-tooltip") });
  await newLink.locator("input.vc-link-text").fill("/blog/");
  check("link (M4): fixed, it is written and Save is back", (await newLink.locator(".vc-link-opens").textContent()) === "Opens: demo.example/blog/" && await newLink.locator(".vc-link-error").isHidden() && await page.getByRole("button", { name: "Save draft" }).isEnabled());
  await shot("m4-link");
  await button("footerLinks[0].links", "Move Link 3 up").click();
  await button("footerLinks[0].links", "Delete Link 1").click();
  await confirmDelete();
  await field("footerLinks").getByRole("button", { name: "Add group" }).click();
  await input("footerLinks[1].title").fill("Legal");
  await field("footerLinks[1].links").getByRole("button", { name: "Add link" }).click();
  await input("footerLinks[1].links[0].label").fill("Privacy");
  await link("footerLinks[1].links[0].href", "/privacy/");
  await input("seo.title").fill("Demo Salon");
  await input("seo.description").fill("Invented salon.\nSecond line.");
  // P12g: the banner price points to a package of the same file (pick, choices from the content) + a toggle.
  await section("home");
  check("pick: the choices are the packages of this file, by name and price", assertEqual(await field("fromPrice.of").locator("option").allTextContents(), ["Choose…", "Express visit · $30", "Deluxe visit · $75"]));
  await input("packages[1].name").fill("Deluxe hour");
  await field("fromPrice.of").locator("select").selectOption("deluxe");
  await field("fromPrice.plain").locator("input[type=checkbox]").check();
  const footerShown = await preview.locator("footer section:not([hidden])").evaluateAll((groups) => groups.map((group) => [group.querySelector("h2").textContent, [...group.querySelectorAll("li:not([hidden]) a")].map((a) => `${a.textContent} ${a.getAttribute("href")}`)]));
  check("preview: rich text, image and list items (added, moved, removed) follow the form", assertEqual(footerShown, [["Visit us", ["Blog /blog/", "Team /team/"]], ["Legal", ["Privacy /privacy/"]]]) && (await preview.locator('[data-cms-field="site.hero.text"]').innerHTML()) === "Everything here is <em>invented</em>." && (await preview.locator("img[data-cms-field]").getAttribute("src")) === "/images/team-sam.svg" && (await preview.locator('[data-cms-field="site.highlights"] li').allTextContents()).join(", ") === "Classic Manicure, Nail Art", footerShown);
  await shot("p9-preview");
  await save();
  const siteExpected = {
    ...siteBefore, name: "Demo Salon & Spa", phone: "(555) 010-0001", footerPhone: "(555) 010-0001", email: "hi@demo.example", address: { ...siteBefore.address, street: "2 Example Street" },
    hours: [
      { ...siteBefore.hours[0], close: "18:30" },
      { days: [0], label: "Sunday", open: "10:00", close: "16:00" },
      { ...siteBefore.hours[1], label: "Sat" },
    ],
    tagline: "Invented, and proud of it.",
    hero: { title: "Hello from Demo Salon", text: "Everything here is <em>invented</em>.", image: { src: "/images/team-sam.svg", alt: "A blue square" } },
    highlights: ["classic-manicure", "nail-art"],
    footerLinks: [
      { title: "Visit us", links: [{ label: "Blog", href: "/blog/" }, { label: "Team", href: "/team/" }] },
      { title: "Legal", links: [{ label: "Privacy", href: "/privacy/" }] },
    ],
    seo: { title: "Demo Salon", description: "Invented salon.\nSecond line." },
    packages: [siteBefore.packages[0], { ...siteBefore.packages[1], name: "Deluxe hour" }],
    fromPrice: { of: "deluxe", plain: true },
  };
  const siteDraft = await api("/api/cms/files/site");
  check("salon info: every field edited in the form is in the saved draft (P5 API)", JSON.stringify(siteDraft.draft?.content) && assertEqual(siteDraft.draft.content, siteExpected), { draft: siteDraft.draft?.content, expected: siteExpected });
  check("salon info: unchanged keys keep their order", JSON.stringify(Object.keys(siteDraft.draft.content)) === JSON.stringify(Object.keys(siteBefore)) && JSON.stringify(Object.keys(siteDraft.draft.content.hours[2])) === JSON.stringify(Object.keys(siteBefore.hours[1])));
  // M13: the menu cards (the Mr Spa CMS's), and the footer's phone that comes from Contact & hours.
  await section("menu");
  check("menu (M13): a card per link with where it goes; a dropdown counts its links", assertEqual(await page.locator('[data-path="menu"] > .vc-menu-list > .vc-menu-cards > .vc-menu-card .vc-menu-card-meta').allTextContents(), ["Opens: demo.example", "Opens: demo.example/services/", "Opens: demo.example/team/", "Dropdown · 2 links", "Opens: example.com"]));
  await page.locator('[data-path="menu"] > .vc-menu-list > .vc-menu-cards > .vc-menu-card .vc-menu-card-summary').nth(3).click();
  check("menu: the open card — Editing link 4 of 5, its dropdown's links", (await page.locator(".vc-menu-card.is-open > .vc-menu-card-head .vc-menu-card-heading").first().textContent()) === "Editing link 4 of 5" && assertEqual(await page.locator(".vc-menu-card.is-open .vc-menu-cards .vc-menu-card-title").allTextContents(), ["Blog", "Privacy"]));
  await shot("m13-menu");
  await page.locator(".vc-menu-card.is-open > .vc-menu-card-head .vc-menu-card-heading").first().click();
  await section("footer");
  check("same as (M13): the footer's phone comes from Contact & hours › Phone", (await field("footerPhone").innerText()).includes("Phone comes from Contact & hours › Phone") && (await field("footerPhone").locator(".vc-same-value").textContent()) === "(555) 010-0001", await field("footerPhone").innerText());
  await shot("m13-same-as");
  await field("footerPhone").getByRole("button", { name: "Edit the phone in Contact & hours" }).click();
  await page.waitForTimeout(200);
  check("same as: Edit goes to the phone", await input("phone").evaluate((element) => element === document.activeElement));
  await page.reload();
  await page.locator(".vc-inspector").waitFor();
  await section("home");
  check("reopening shows the draft", (await input("tagline").inputValue()) === "Invented, and proud of it." && (await saveState()) === "Draft saved · not live yet");

  // ---------------------------------------------------------------- owner: a service (text, locked price, select, ordered list)
  const services = data("src/data/services.json");
  await open("/admin/catalog/services/spa-pedicure");
  check("record id is shown but fixed", await input("id").isDisabled());
  await input("name").fill("Spa Pedicure Deluxe");
  // P12d: the demo's own rule (cms.config.ts `rules`) runs in the built Worker: a price without "$" is refused, with its message.
  // M13: a plain amount gets its "$" (f.price); words without one are kept as typed — and refused by the rule.
  // M14: the demo's own plugin (cms/admin-plugin.ts, bundled into /admin) wraps the price box: "Call for price".
  const callForPrice = field("price").getByLabel("Show “Call for price” instead");
  await callForPrice.check();
  check("plugin control (M14): ticking “Call for price” hides the box and says what shoppers see", (await field("price").locator(".vc-plugin-standard").isHidden()) && /Shoppers see “Call for price” instead of a price\./.test(await field("price").innerText()), await field("price").innerText());
  await shot("m14-control");
  await callForPrice.uncheck();
  await input("price").fill("40 and up");
  await page.getByRole("button", { name: "Save draft" }).click();
  const ruleShown = await page.waitForFunction(() => /a price starts with \$/.test(document.querySelector(".vc-form")?.textContent ?? ""), null, { timeout: 10_000 }).then(() => true, () => false);
  check("rules: the site's own rule refuses a price without $ (in the Worker), next to the field", ruleShown && /a price starts with \$/.test(await field("price").innerText()), await field("price").innerText());
  await shot("m13-price");
  await input("price").fill("$40");
  await input("category").selectOption("Nails");
  await button("extras", "Move Extra 2 up").click();
  await field("extras").getByRole("button", { name: "Add extra" }).click();
  await input("extras[2]").fill("Foot mask");
  await button("extras", "Delete Extra 2").click();
  await confirmDelete();
  await input("description").fill("Warm soak and massage.");
  await previewReady();
  check("preview: the service is shown in the services list as edited", (await preview.locator('[data-cms-item="services:spa-pedicure"]').innerText()) === "Spa Pedicure Deluxe — $40 (+ Paraffin, Foot mask)", await preview.locator('[data-cms-item="services:spa-pedicure"]').innerText());
  await save();
  // Clicking content of another record on the page opens that record (here: the footer, from the salon info).
  await preview.locator("footer h2").first().click();
  await page.waitForURL(/\/admin\/pages\/site$/);
  await page.locator(".vc-inspector").waitFor();
  // The field is focused after the form renders (it may be a moment after .vc-form appears): wait for it, up to 5 s.
  const focusedFooter = await page.waitForFunction(() => document.activeElement?.closest("[data-path]")?.getAttribute("data-path") === "footerLinks[0].title", null, { timeout: 5_000 }).then(() => true, () => false);
  check("preview: clicking the footer opens the salon info at that field", focusedFooter, await page.evaluate(() => document.activeElement?.closest("[data-path]")?.getAttribute("data-path") ?? document.activeElement?.tagName));
  const spa = await api("/api/cms/collections/services/items/spa-pedicure");
  check("service: every field in the draft", assertEqual(spa.draft?.content, { ...services[1], name: "Spa Pedicure Deluxe", price: "$40", category: "Nails", extras: ["Paraffin", "Foot mask"], description: "Warm soak and massage." }), spa.draft);

  // A new service: the id follows the name until edited.
  await open("/admin/catalog/services");
  await page.getByRole("link", { name: "Add service" }).click();
  await page.locator(".vc-form").waitFor();
  await input("name").fill("Gel Removal");
  check("new record: id filled from the name", (await input("id").inputValue()) === "gel-removal");
  await input("price").fill("$10");
  await input("category").selectOption("Nails");
  await field("extras").getByRole("button", { name: "Add extra" }).click();
  await input("extras[0]").fill("Cuticle oil");
  await previewReady();
  check("preview: a new service shows in the list as it is typed", (await preview.locator('[data-cms-item="services:gel-removal"]').innerText()) === "Gel Removal — $10 (+ Cuticle oil)" && (await preview.locator('[data-cms-list="services"] > li').count()) === 4);
  await save();
  await page.waitForURL(/\/admin\/catalog\/services\/gel-removal$/);
  const gel = await api("/api/cms/collections/services/items/gel-removal");
  check("new service saved as a draft (expectedRevision 0, version new)", assertEqual(gel.draft?.content, { id: "gel-removal", name: "Gel Removal", price: "$10", category: "Nails", extras: ["Cuticle oil"] }) && gel.version === "new", gel);
  await open("/admin/catalog/services");
  // M8 (Mr Spa): the records on the website, Live + "Unpublished changes" where I have a draft; the new record's draft
  // is on Drafts (not a row) until it is published.
  const listText = await page.locator(".vc-list-table").innerText();
  check("list: Live + Unpublished changes; a new record is not a row yet", /Spa Pedicure[\s\S]*Live\s*Unpublished changes/.test(listText) && !/Gel Removal/.test(listText) && (await page.locator(".vc-list-count").innerText()) === "3 services", listText);
  await page.getByRole("searchbox").fill("spa");
  check("list: search filters", (await page.locator(".vc-list-table tbody tr.vc-list-row").count()) === 1 && (await page.locator(".vc-list-count").innerText()) === "1 of 3 services");
  await page.getByRole("searchbox").fill("");
  await page.locator('.vc-list-segmented[aria-label="Category"]').getByRole("radio", { name: "Spa" }).click();
  check("list: the Category filter", (await page.locator(".vc-list-table tbody tr.vc-list-row").count()) === 1);
  await shot("m8-list");
  check("plugin panel (M14): above the Services list, told the rows", (await page.locator(".vc-list-panels .vc-plugin-panel").innerText()).includes("3 services in 2 categories, in this order."), await page.locator(".vc-list-panels").innerText());

  // ---------------------------------------------------------------- owner: team (image, references)
  const team = data("src/data/team.json");
  await open("/admin/catalog/team/alex");
  // M9: the record editor (Mr Spa) — sections on the left, the form in cards, On the website / Ready to publish.
  check("record editor (M9): Basics · Photo · About, Live on demo.example/team, Ready to publish",
    assertEqual(await page.locator(".vc-record-toc-link").allTextContents(), ["Basics", "Photo", "About"])
    && (await page.locator(".vc-record-side .vc-content-status").first().textContent()) === "Live"
    && (await page.locator(".vc-record-side-url").textContent()) === "demo.example/team"
    && (await page.locator(".vc-record-side-card h2").nth(1).textContent()) === "Ready to publish",
  { toc: await page.locator(".vc-record-toc-link").allTextContents(), ready: await page.locator(".vc-record-side-card h2").allTextContents() });
  await shot("m9-record");
  check("plugin panel (M14): Profile in the team member's right column", /Profile\s+4 of 4 details filled in\./.test(await page.locator('.vc-record-side .vc-plugin-panel[data-plugin="demo"]').innerText()), await page.locator(".vc-record-side").innerText());
  await pickImage("photo", "Photo", "/images/hero.svg");
  await field("photo").getByLabel("Image description").fill("Alex at work");
  await input("specialty").selectOption("spa-pedicure");
  await button("services", "Remove Nail Art").click();
  await field("services").locator("select").selectOption("spa-pedicure");
  await button("services", "Move Spa Pedicure up").click();
  // P8d: rich text typed in the visual editor (select all, type over it).
  await rich("bio").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Still invented.");
  await save();
  const alex = await api("/api/cms/collections/team/items/alex");
  check("team: image + alt, one reference, ordered references, rich text", assertEqual(alex.draft?.content, { ...team[0], photo: { src: "/images/hero.svg", alt: "Alex at work" }, specialty: "spa-pedicure", services: ["spa-pedicure", "classic-manicure"], bio: "<p>Still invented.</p>" }), alex.draft);
  // P10: Sam's photo through the image sheet — a large PNG chosen from the computer is made smaller and WebP in the
  // browser, uploaded to the local R2 bucket, picked, and served at its final address until it is published.
  await open("/admin/catalog/team/sam");
  // M5 (Mr Spa): the sheet — where the image area is, Current first, the area chips; Upload selects the new image.
  await field("photo").locator(".vc-image-replace").click();
  const sheet = sheetFor("Photo");
  await sheet.locator('.vc-sheet-tile[data-src="/images/team-alex.svg"]').waitFor();
  check("image sheet (M5): Team › Sam, the current image first, chips, the site's own images", (await sheet.locator(".vc-sheet-tile").count()) === 3
    && (await sheet.locator(".vc-sheet-context").textContent()) === "Team › Sam Sample"
    && (await sheet.locator(".vc-sheet-tile").first().getAttribute("data-src")) === "/images/team-sam.svg" && (await sheet.locator(".vc-sheet-tile").first().locator(".vc-sheet-badge").textContent()) === "Current"
    && assertEqual(await sheet.locator(".vc-chip").allTextContents(), ["All", "Pages", "Services", "Team", "Blog", "Not used", "Not published yet"]),
  { tiles: await sheet.locator(".vc-sheet-tile").count(), context: await sheet.locator(".vc-sheet-context").textContent(), chips: await sheet.locator(".vc-chip").allTextContents() });
  await shot("p10-image-sheet");
  await sheet.getByRole("tab", { name: "Upload" }).click();
  await sheet.locator("input[type=file]").setInputFiles({ name: "Sam at the desk.png", mimeType: "image/png", buffer: Buffer.from(tinyPng(2600, 1300)) });
  await sheet.locator(".vc-sheet-upload-status", { hasText: "Uploaded. It is selected in the Library." }).waitFor({ state: "attached", timeout: 20_000 });
  check("upload (M5): the new image is selected in the Library, “Not published yet”, Use image focused", (await sheet.locator('.vc-sheet-tile[aria-selected="true"] .vc-sheet-badge').textContent()) === "Not published yet" && await sheet.getByRole("button", { name: "Use image" }).evaluate((button) => button === document.activeElement));
  await sheet.getByRole("button", { name: "Use image" }).click();
  await sheet.waitFor({ state: "detached" });
  let samPhoto = await shownImage("photo");
  check("upload: picked at its final address (month folder, name, hash, .webp)", /^\/assets\/uploads\/20\d\d\/\d\d\/sam-at-the-desk-[0-9a-f]{8}\.webp$/.test(samPhoto), samPhoto);
  const library = await api("/api/cms/media");
  check("upload: resized in the browser to 2400 px wide, WebP", assertEqual(library.uploads.map((image) => [image.src, image.width, image.height]), [[samPhoto, 2400, 1200]]) && library.uploads[0].bytes < 2_000_000, library.uploads);
  const staged = await page.evaluate(async (url) => { const response = await fetch(url); const bytes = new Uint8Array(await response.arrayBuffer()); return { status: response.status, type: response.headers.get("content-type"), from: response.headers.get("x-vibe-cms-upload"), head: String.fromCharCode(...bytes.slice(0, 4), ...bytes.slice(8, 12)) }; }, samPhoto);
  check("upload: served from staging before it is published", assertEqual(staged, { status: 200, type: "image/webp", from: "staging", head: "RIFFWEBP" }), staged);
  check("image card (M5): the upload's name · 2400 × 1200 · KB · Replace", (await field("photo").locator(".vc-image-name").getAttribute("title")) === "Sam at the desk.webp" && /^2400 × 1200 · \d+ KB$/.test(await field("photo").locator(".vc-image-details").textContent()) && await field("photo").locator(".vc-image-replace").isVisible(), { name: await field("photo").locator(".vc-image-name").getAttribute("title"), details: await field("photo").locator(".vc-image-details").textContent() });
  // M5 (Mr Spa): Adjust — Square around the focus point; a NEW image made by the browser's canvas; the sheet then offers it.
  const originalPhoto = samPhoto;
  await field("photo").locator(".vc-image-frame").hover();
  await field("photo").getByRole("button", { name: "Adjust Photo" }).click();
  const adjustDialog = page.getByRole("alertdialog", { name: "Adjust image" });
  check("adjust (M5): Shape, the focus point, the original stays", /Create a new copy for this image area\. Your original image will stay unchanged\.[\s\S]*Shape[\s\S]*Original[\s\S]*Square[\s\S]*Landscape[\s\S]*Portrait[\s\S]*Horizontal focus 50%[\s\S]*Vertical focus 50%/.test(await adjustDialog.innerText()), await adjustDialog.innerText());
  await adjustDialog.getByLabel("Square").check();
  await shot("m5-adjust");
  await adjustDialog.getByRole("button", { name: "Create adjusted copy" }).click();
  const copySheet = sheetFor("Photo");
  await copySheet.locator('.vc-sheet-tile[aria-selected="true"]').waitFor({ timeout: 20_000 });
  await copySheet.getByRole("button", { name: "Use image" }).click();
  await copySheet.waitFor({ state: "detached" });
  samPhoto = await shownImage("photo");
  check("adjust: the new copy is offered and chosen, named after the original and the shape", /^\/assets\/uploads\/20\d\d\/\d\d\/sam-at-the-desk-square-[0-9a-f]{8}\.webp$/.test(samPhoto), samPhoto);
  const decoded = await page.evaluate(async (url) => { const bitmap = await createImageBitmap(await (await fetch(url)).blob()); return [bitmap.width, bitmap.height]; }, samPhoto);
  const libraryAfter = await api("/api/cms/media");
  check("adjust: the copy really is 1200 × 1200 (decoded); the original is still in the library at 2400 × 1200", assertEqual(decoded, [1200, 1200]) && libraryAfter.uploads.some((image) => image.src === originalPhoto && image.width === 2400 && image.height === 1200), { decoded, uploads: libraryAfter.uploads });
  await shot("p10-picked");
  await input("specialty").selectOption("classic-manicure");
  await save();
  const sam = await api("/api/cms/collections/team/items/sam");
  check("team: an image written as a plain path stays a path", assertEqual(sam.draft?.content, { ...team[1], photo: samPhoto, specialty: "classic-manicure" }), sam.draft);

  // ---------------------------------------------------------------- owner: a Markdown post (status, list, body)
  await open("/admin/catalog/posts/welcome");
  // M10: the Mr Spa CMS's Blog post — the paper and Post details / In Google / Ready to publish.
  check("document (M10): the paper (bar, cover, title, text), Post details · In Google · Ready to publish",
    assertEqual(await page.locator(".vc-doc-paper .vc-form > .vc-field").evaluateAll((boxes) => boxes.map((box) => box.dataset.path)), ["cover", "title", "body"])
    && (await page.locator(".vc-doc-paper > .vc-rich-toolbar").count()) === 1
    && assertEqual(await page.locator(".vc-record-side-card h2").allTextContents(), ["On the website", "Post details", "In Google", "Ready to publish"])
    && (await page.locator(".vc-doc-google-path").textContent()) === "demo.example › blog › welcome",
  { cards: await page.locator(".vc-record-side-card h2").allTextContents() });
  await shot("m10-document");
  await input("title").fill("Welcome!");
  await pickImage("cover", "Cover image", "/images/team-sam.svg");
  await button("tags", "Delete Tag 1").click();
  await confirmDelete();
  await field("tags").getByRole("button", { name: "Add tag" }).click();
  await input("tags[1]").fill("update");
  // P8d: the Markdown body in the visual editor — typed text, bold, a heading, a list, an uploaded image with alt text
  // resized by dragging its corner (ratio kept), and a second image inserted then removed. Saved as Markdown.
  await field("body").locator('.vc-rich-editor[data-mode="visual"]').waitFor();
  await rich("body").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("New ");
  await page.keyboard.press("Control+B"); await page.keyboard.type("body"); await page.keyboard.press("Control+B");
  await page.keyboard.type(" text. Meet the team");
  // M10 (Mr Spa): Add link — a page of the site; its address goes in the box.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  await tool("body", "Add link").click();
  const linkDialog = page.getByRole("alertdialog", { name: "Add link" });
  await linkDialog.getByLabel("Choose a page").selectOption("/team/");
  check("Add link (M10): a page puts its address in the box", (await linkDialog.getByLabel("Or enter a secure HTTPS URL").inputValue()) === "/team/");
  await shot("m10-add-link");
  await linkDialog.getByRole("button", { name: "Insert link" }).click();
  await linkDialog.waitFor({ state: "detached" });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await tool("body", "Heading 2").click();
  await page.keyboard.type("Opening hours");
  await page.keyboard.press("Enter");
  await tool("body", "Bulleted list").click();
  await page.keyboard.type("Mon to Fri"); await page.keyboard.press("Enter");
  await page.keyboard.type("Sat"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await tool("body", "Insert image").click();
  const postSheet = sheetFor();
  await postSheet.locator(".vc-sheet-tile").first().waitFor();
  await postSheet.getByRole("tab", { name: "Upload" }).click();
  await postSheet.locator("input[type=file]").setInputFiles({ name: "Post chair.png", mimeType: "image/png", buffer: Buffer.from(tinyPng(1600, 1200)) });
  await postSheet.locator(".vc-sheet-upload-status", { hasText: "Uploaded." }).waitFor({ state: "attached", timeout: 20_000 });
  await postSheet.getByRole("button", { name: "Use image" }).click();
  await postSheet.waitFor({ state: "detached", timeout: 20_000 });
  const postImage = rich("body").locator("img");
  const postImageSrc = await postImage.getAttribute("src");
  check("editor: the uploaded image is in the text, selected, alt asked for", /^\/assets\/uploads\/20\d\d\/\d\d\/post-chair-[0-9a-f]{8}\.webp$/.test(postImageSrc ?? "") && await field("body").getByLabel("Alt text").evaluate((element) => element === document.activeElement), postImageSrc);
  await field("body").getByLabel("Alt text").fill("A pedicure chair");
  // Measure once the picture has loaded (its size, and the corner handle placed on it), not while it is still coming.
  await postImage.evaluate((image) => (image.complete && image.naturalWidth > 0 ? null : new Promise((resolve) => image.addEventListener("load", resolve, { once: true }))));
  await field("body").locator(".vc-rich-handle").waitFor({ state: "visible" });
  // The inspector is narrow (360 px): bring the picture and its corner handle into the middle of the window first.
  await postImage.evaluate((image) => image.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
  const before = await postImage.boundingBox();
  const handle = await field("body").locator(".vc-rich-handle").boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 8 - 200, handle.y + 8 + 40, { steps: 10 });
  await page.mouse.up();
  // The drawn size follows the width written on the image; measure once both agree (slower machines draw later).
  await postImage.evaluate((image) => new Promise((resolve) => { const started = Date.now(); const tick = () => (Math.abs(image.getBoundingClientRect().width - Number(image.getAttribute("width"))) <= 1 || Date.now() - started > 3000 ? resolve(null) : requestAnimationFrame(tick)); tick(); }));
  const after = await postImage.boundingBox();
  const postWidth = Number(await postImage.getAttribute("width"));
  check("editor: dragging the corner resizes the image, ratio kept, width written", Math.abs(postWidth - (before.width - 200)) <= 2 && Math.abs(after.width - postWidth) <= 1 && Math.abs(after.height / after.width - 0.75) < 0.01 && !(await postImage.getAttribute("height")), { before, after, postWidth });
  await shot("p8d-editor");
  await tool("body", "Insert image").click();
  const insertSheet = sheetFor();
  await insertSheet.locator('.vc-sheet-tile[data-src="/images/hero.svg"]').click();
  await insertSheet.getByRole("button", { name: "Use image" }).click();
  check("editor: a library image is inserted", (await rich("body").locator("img").count()) === 2);
  await field("body").getByRole("button", { name: "Remove image" }).click();
  check("editor: Remove image takes it out", (await rich("body").locator("img").count()) === 1 && (await rich("body").locator('img[src="/images/hero.svg"]').count()) === 0);
  check("In Google (M10): the title and the first lines follow the paper", (await page.locator(".vc-doc-google-title").textContent()) === "Welcome! | Demo Salon" && (await page.locator(".vc-doc-google-text").textContent()).startsWith("New body text. Meet the team Opening hours"), await page.locator(".vc-doc-google").innerText());
  await save();
  const post = await api("/api/cms/collections/posts/items/welcome");
  const postBody = `New **body** text. Meet the [team](/team/)\n\n## Opening hours\n\n- Mon to Fri\n- Sat\n\n<img src="${postImageSrc}" alt="A pedicure chair" width="${postWidth}">\n`;
  check("post: front matter fields + Markdown body written by the visual editor", assertEqual(post.draft?.content, { slug: "welcome", title: "Welcome!", status: "published", cover: "/images/team-sam.svg", tags: ["demo", "update"], body: postBody }), post.draft);

  // M10 (the Mr Spa CMS's Policy page): plain text on the paper, the sections stay as they are, the word count.
  await open("/admin/pages/privacy");
  const privacyText = data("src/data/privacy.json");
  const privacyWords = [privacyText.title, ...privacyText.sections.flatMap((section) => [section.heading, ...section.paragraphs])].join(" ").split(/\s+/).filter(Boolean).length;
  check("policy (M10): plain text, no formatting bar, “Plain text · the sections stay as they are” and the word count",
    (await page.locator(".vc-doc-paper.is-plain .vc-rich-toolbar").count()) === 0
    && (await page.locator(".vc-doc-bar > span").first().textContent()) === "Plain text · the sections stay as they are"
    && (await page.locator(".vc-doc-count").textContent()) === `${privacyWords} words`
    && (await page.locator(".vc-doc-google-title").textContent()) === "Privacy policy | Demo Salon",
  { bar: await page.locator(".vc-doc-bar").innerText() });
  await shot("m10-policy");

  // Discard a draft (confirm), then the live content again.
  await open("/admin/catalog/posts/spring-colours");
  await input("title").fill("Spring colours");
  await save();
  // M6 (Mr Spa): Publish = "Review changes" (by section, the changed words marked) → "Publish {name}"; Cancel leaves it a draft.
  await page.locator('[data-action="publish"]').click();
  const reviewDialog = page.getByRole("alertdialog", { name: "Review changes" });
  const editorReview = await reviewDialog.innerText();
  await shot("m6-review-changes");
  check("review changes (M6): the record's changes, before → after, the changed words marked", /Review the changes to Spring colours before publishing\./.test(editorReview) && /Changed: Status\s+draft\s*→\s*published/.test(editorReview) && /Changed: Title/.test(editorReview) && /Spring colours \(draft\)\s*→\s*Spring colours/.test(editorReview) && assertEqual((await reviewDialog.locator(".vc-review-value.is-before mark").allTextContents()).map((text) => text.trim()), ["draft", "(draft)"]), editorReview);
  await reviewDialog.getByRole("button", { name: "Continue to publish" }).click();
  const publishDialog = page.getByRole("alertdialog", { name: "Publish Spring colours" });
  check("publish (M6): “This will publish to demo.example.” · Cancel · Publish", /This will publish to demo\.example\./.test(await publishDialog.innerText()) && await publishDialog.getByRole("button", { name: "Publish", exact: true }).isVisible(), await publishDialog.innerText());
  await publishDialog.getByRole("button", { name: "Cancel" }).click();
  // U3: the CMS dialog, not the browser's confirm().
  await page.locator('[data-action="discard"]').click();
  const discardDialog = page.getByRole("alertdialog", { name: "Discard your draft?" });
  check("discard: asks in the CMS dialog, the red button discards", /The website stays as it is./.test(await discardDialog.innerText()) && await discardDialog.getByRole("button", { name: "Discard draft" }).evaluate((button) => button.classList.contains("vc-danger-fill")));
  await discardDialog.getByRole("button", { name: "Discard draft" }).click();
  await page.waitForFunction(() => document.querySelector(".vc-state-long")?.textContent === "No changes");
  check("discard: the draft is gone, the live title is back", (await api("/api/cms/collections/posts/items/spring-colours")).draft === null && (await input("title").inputValue()) === "Spring colours (draft)");

  // Leaving with unsaved changes asks first.
  await open("/admin/catalog/services/classic-manicure");
  await input("name").fill("Classic Manicure (changed)");
  await page.locator(".vc-nav-list").getByRole("link", { name: "Team" }).click();
  const leaveDialog = page.getByRole("alertdialog", { name: "Leave without saving?" });
  const asked = await leaveDialog.innerText();
  await leaveDialog.getByRole("button", { name: "Keep editing" }).click();
  await page.waitForFunction(() => location.pathname === "/admin/catalog/services/classic-manicure");
  check("unsaved changes: leaving asks, staying keeps them", /You have 1 unsaved change on /.test(asked) && page.url().endsWith("/admin/catalog/services/classic-manicure") && (await input("name").inputValue()) === "Classic Manicure (changed)", { asked, url: page.url() });
  await page.locator(".vc-nav-list").getByRole("link", { name: "Team" }).click();
  await page.getByRole("alertdialog", { name: "Leave without saving?" }).getByRole("button", { name: "Discard changes" }).click();
  await page.locator(".vc-list-table").waitFor();

  // ---------------------------------------------------------------- P8: review every draft, publish them in one commit
  check("navigation counts my drafts", (await page.locator(".vc-badge").textContent()) === "6");
  await page.locator(".vc-nav-list").getByRole("link", { name: /Drafts/ }).click();
  // U4: Drafts lists them (what changes, when); "Review & publish all" opens the review of all of them.
  await page.locator(".vc-drafts-card").first().waitFor();
  check("drafts (M11): one card per draft — its kind, what it changes, Saved …, Live / Draft", (await page.locator(".vc-drafts-card").count()) === 6 && /\d+ changes?: /.test(await page.locator(".vc-drafts-card .vc-draft-changes").first().innerText()) && /^Saved /.test(await page.locator(".vc-drafts-saved").first().innerText()) && (await page.locator(".vc-drafts-status").first().innerText()).replace(/\s+/g, " ").trim().length > 0);
  await page.locator('.vc-drafts-card [data-action="see-changes"]').first().click();
  const changesDialog = page.getByRole("alertdialog", { name: "Changes in this draft" });
  check("drafts (M11): See changes is the review, read-only (Close)", /saved draft compared with the website\./.test(await changesDialog.innerText()) && assertEqual(await changesDialog.locator(".vc-dialog-actions button").allTextContents(), ["Close"]));
  await changesDialog.getByRole("button", { name: "Close" }).click();
  await shot("u4-drafts");
  // M11: Media — the uploads (not published yet, used by a draft), the detail panel.
  await page.locator(".vc-nav-list").getByRole("link", { name: "Media" }).click();
  await page.locator(".vc-media-library .vc-sheet-tile").first().waitFor();
  await page.locator(".vc-media-library .vc-sheet-tile").first().click();
  await page.locator(".vc-media-panel-state", { hasText: "Not published yet" }).waitFor();
  const mediaPanel = await page.locator(".vc-media-panel").innerText();
  check("media (M11): an upload not published yet, used by a saved draft — the panel says so; no Remove", /Image details/.test(mediaPanel) && /Not published yet/.test(mediaPanel) && /Saved draft, not published yet/.test(mediaPanel) && /Replace it there first to remove or archive it\./.test(mediaPanel) && (await page.locator(".vc-media-panel").getByRole("button", { name: "Remove image" }).count()) === 0, mediaPanel);
  await shot("m11-media");
  await page.locator(".vc-nav-list").getByRole("link", { name: /Drafts/ }).click();
  await page.locator(".vc-drafts-card").first().waitFor();
  await page.getByRole("link", { name: "Review & publish all" }).click();
  await page.locator(".vc-review-card").first().waitFor();
  const reviewText = await page.locator(".vc-review-list").innerText();
  await shot("p8-review");
  check("review: 6 drafts, all ticked", (await page.locator(".vc-review-card").count()) === 6 && (await page.locator(".vc-pick:checked").count()) === 6);
  for (const line of ["Salon name: Demo Salon → Demo Salon & Spa", "Phone (admin only): (555) 010-0000 → (555) 010-0001", "Featured services: removed Spa Pedicure", "Price (admin only): $35 → $40", "New service: Gel Removal", "Specialty: Nail Art → Spa Pedicure", "Text: This post is invented. It exists so the CMS has a Markdown record to edit. → New body text. Meet the team Opening hours Mon to Fri Sat", "Text › image: added /assets/uploads/"]) {
    check(`review says “${line}”`, reviewText.replace(/\s+/g, " ").includes(line), reviewText.slice(0, 2500));
  }
  const head = github.head();
  const filesBefore = github.files();
  await page.getByRole("button", { name: "Publish 6 drafts" }).click();
  await page.getByRole("heading", { name: "Published" }).waitFor({ timeout: 20_000 });
  await shot("p8-published");
  check("publish: exactly one commit on the branch", github.commitsSince(head).length === 1, github.commitsSince(head));
  const published = github.files();
  check("published salon info = the draft", assertEqual(JSON.parse(published["src/data/site.json"]), siteDraft.draft.content));
  const servicesAfter = JSON.parse(published["src/data/services.json"]);
  check("published services: Spa Pedicure changed, Gel Removal added, the others untouched", assertEqual(servicesAfter.find((item) => item.id === "spa-pedicure"), spa.draft.content) && assertEqual(servicesAfter.find((item) => item.id === "gel-removal"), gel.draft.content) && assertEqual(servicesAfter.find((item) => item.id === "classic-manicure"), services[0]));
  const servicesDiff = lineDiff(filesBefore["src/data/services.json"], published["src/data/services.json"]);
  check("services.json: only the changed / added lines move", servicesDiff.removed.length <= 2 && servicesDiff.added.length <= 3, servicesDiff);
  check("published team = the drafts", assertEqual(JSON.parse(published["src/data/team.json"]), [alex.draft.content, sam.draft.content]));
  const committedImage = github.bytes(`public${samPhoto}`);
  check("P12f: the original upload nobody uses is not committed", !github.changedPaths(head).includes(`public${originalPhoto}`), github.changedPaths(head));
  check("P10: the uploaded image is in the same commit, exact bytes (WebP)", committedImage && committedImage.subarray(0, 4).toString("latin1") === "RIFF" && committedImage.subarray(8, 12).toString("latin1") === "WEBP" && github.changedPaths(head).includes(`public${samPhoto}`), github.changedPaths(head));
  check("published post: front matter + body", /title: Welcome!/.test(published["src/content/posts/welcome.md"]) && published["src/content/posts/welcome.md"].endsWith(postBody));
  check("P8d: the image in the post body is in the same commit", github.bytes(`public${postImageSrc}`)?.subarray(8, 12).toString("latin1") === "WEBP");
  check("commit message names the owner's internal id, no email", /usr_[a-z2-7]{16}/.test(github.commit().message) && !github.commit().message.includes("@"));
  // The count follows the drafts reload: wait for it (a slow machine draws later).
  const noDrafts = await page.waitForFunction(() => document.querySelector(".vc-badge")?.hidden ?? true, null, { timeout: 10_000 }).then(() => true, () => false);
  check("after publishing: no drafts left", noDrafts, { badge: await page.locator(".vc-badge").textContent().catch(() => null) });

  // ---------------------------------------------------------------- P12c: History of the salon info (owner), from the fake GitHub's commits
  await open("/admin/pages/site");
  // M1 (Mr Spa): the record's save state follows the publish until the site serves it (this Worker is not rebuilt).
  check("after publishing: the salon info says 'Publishing…' until the site serves it", (await saveState()) === "Publishing… this usually takes a few minutes", await saveState());
  // M12 (Mr Spa): Version history is a dialog over the editor.
  await page.locator('[data-action="history"]').click();
  const historyDialog = page.locator(".vc-history-dialog");
  await historyDialog.locator(".vc-history-status", { hasText: /^\d+ published versions?\.$/ }).waitFor();
  const versions = await historyDialog.locator(".vc-history-entry").allInnerTexts();
  check("history: a dialog with the publish and the first version, newest first", versions.length === 2 && (await historyDialog.locator(".vc-history-status").textContent()) === "2 published versions." && /by /.test(versions[0]), versions);
  // This Worker is not rebuilt after the publish, so the website still shows the first version: the published one
  // says what restoring it changes; the first one is "what the website shows now".
  const summaries = await historyDialog.locator(".vc-history-entry p").allTextContents();
  check("history: what restoring each version would change", /^(Changed|Added|Removed): /.test(summaries[0]) && summaries[1] === "Nothing is different from what the website shows now.", summaries);
  await shot("m12-version-history");
  await historyDialog.getByRole("button", { name: "Close" }).click();
  await historyDialog.waitFor({ state: "detached" });

  // ---------------------------------------------------------------- P8b / M12: the owner adds an editor on the People screen (Mr Spa)
  await page.locator(".vc-rail-bottom").getByRole("link", { name: "Users" }).click();
  await page.locator("form.vc-user-form").waitFor();
  await page.getByLabel("Username", { exact: true }).fill("editor1");
  await page.locator(".vc-people-role", { hasText: "Editor" }).click();
  const created = { temporaryPassword: await page.getByLabel("Temporary password").inputValue() };
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator('tr[data-user="editor1"]').waitFor();
  await shot("p8b-people");
  check("People: a temporary password is filled in, and the new editor is listed", /^([A-Za-z2-9]{4}-){3}[A-Za-z2-9]{4}$/.test(created.temporaryPassword) && /Editor\s+Active\s+Not yet/.test(await page.locator('tr[data-user="editor1"]').innerText()));
  check("People: the add form posts", (await page.locator("form.vc-user-form").getAttribute("method")) === "post");
  await page.getByRole("link", { name: "Activity" }).click();
  await page.locator(".vc-users-status", { hasText: /From the last \d+ events?\./ }).waitFor();
  const filters = (await page.locator(".vc-activity-filter").allTextContents()).join(" ");
  check("Activity: the filters and the last events (Mr Spa)", filters === "All Publishing Sign-ins Failed" && (await page.locator(".vc-users-table tbody tr").count()) > 1, filters);
  await page.locator(".vc-avatar").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.locator("form#login").waitFor();

  // ---------------------------------------------------------------- editor: locked fields shown, not editable
  await signIn("editor1", created.temporaryPassword, EDITOR_PASSWORD);
  await open("/admin/pages/site");
  await section("contact");
  const lockedDisabled = await Promise.all(["phone", "email", "address.street", "address.city"].map((path) => input(path).isDisabled()));
  check("editor: phone, email, address are shown but disabled", lockedDisabled.every(Boolean) && (await input("phone").inputValue()) === siteBefore.phone, lockedDisabled);
  check("editor: hours disabled (days, times, add row)", await field("hours[0]").getByLabel("Monday").isDisabled() && await field("hours").getByRole("button", { name: "Add a row" }).isDisabled());
  check("editor: the lock says why", (await field("phone").innerText()).includes("Only an admin can change this."));
  await section("home");
  check("editor: other fields are editable", !(await input("tagline").isDisabled()) && !(await input("hero.title").isDisabled()));
  await input("tagline").fill("Edited by the editor.");
  await save();
  check("editor saves an unlocked field", (await api("/api/cms/files/site")).draft?.content.tagline === "Edited by the editor.");
  // P8c: unsafe HTML typed into rich text never reaches a draft.
  // (Set straight into the editable area, as a drop or an extension could; a mouse handler, so nothing runs here.)
  await rich("hero.text").evaluate((area) => { area.innerHTML = '<p>Hi</p><img src="x" onmouseover="alert(1)"><script>alert(2)</script>'; area.dispatchEvent(new Event("input", { bubbles: true })); });
  await save();
  const cleanedText = (await api("/api/cms/files/site")).draft?.content.hero.text;
  check("rich text: a script and a handler never reach the draft", /^<p>Hi<\/p>/.test(cleanedText ?? "") && !/script|onmouseover/i.test(cleanedText ?? "script"), cleanedText);
  await open("/admin/catalog/services/nail-art");
  check("editor: price disabled on a service", await input("price").isDisabled());
  await open("/admin/catalog/services/new");
  await input("name").fill("Editor Special");
  check("editor: a new service's price stays empty and disabled", await input("price").isDisabled() && (await input("price").inputValue()) === "");
  await save();
  check("editor adds a service with the price left for the owner (rule 2)", (await api("/api/cms/collections/services/items/editor-special")).draft?.content.name === "Editor Special");
  check("editor: no Users in the navigation", !(await page.locator(".vc-rail").innerText()).includes("Users"));
  // M2 (Mr Spa): account menu → Change password — a dialog; the editor changes their own password and stays signed in.
  await page.locator(".vc-avatar").click();
  check("account menu: name, Editor, Change password, Sign out", /Editor\s+Change password\s+Sign out/.test(await page.locator(".vc-user .vc-menu").innerText()), await page.locator(".vc-user .vc-menu").innerText());
  await page.getByRole("menuitem", { name: "Change password" }).click();
  const passwordDialog = page.getByRole("alertdialog", { name: "Change your password" });
  await passwordDialog.getByLabel("Current password").fill(EDITOR_PASSWORD);
  await passwordDialog.getByLabel("New password", { exact: true }).fill("editor-e2e-password-3");
  await passwordDialog.getByLabel("Confirm new password").fill("editor-e2e-password-3");
  await passwordDialog.getByRole("button", { name: "Save password" }).click();
  await passwordDialog.getByText("Password changed successfully.").waitFor();
  await passwordDialog.waitFor({ state: "detached" });
  check("Change password: saved, and this session stays signed in", (await api("/api/auth/me")).user?.username === "editor1");

  check("no script errors, no 5xx", problems.length === 0, problems);
  const failed = checks.filter((entry) => !entry.ok);
  assert.deepEqual(failed, [], "every e2e check passes");
  console.log(`E2E (headless Chrome, wrangler dev --local, D1 + KV + R2 + rate limits, fake GitHub) OK: ${checks.length} checks passed — every demo field edited through /admin, reviewed and published in one commit; editor locks shown.`);
} finally {
  await browser.close();
  server.stop();
  await github.close();
}
process.exit(0);

function assertEqual(actual, expected) { try { assert.deepStrictEqual(actual, expected); return true; } catch { return false; } }
