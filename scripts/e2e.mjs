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
  // M3: deleting a list item asks first (the CMS dialog, red Delete).
  const confirmDelete = async () => { const dialog = page.getByRole("alertdialog", { name: /^Delete / }); await dialog.getByRole("button", { name: "Delete", exact: true }).click(); await dialog.waitFor({ state: "detached" }); };
  // P8d: the visual editor — its editable area, a toolbar button, and its source view ("Edit HTML" / "Edit Markdown").
  const rich = (path) => field(path).locator(".vc-rich-area");
  const tool = (path, name) => field(path).locator(".vc-rich-toolbar").getByRole("button", { name, exact: true });
  // P9: the preview pane (the real page in a same-origin iframe) and what it shows.
  const preview = page.frameLocator(".vc-preview-frame");
  const previewReady = () => page.locator('.vc-preview[data-state="ready"]').waitFor({ timeout: 20_000 });
  const previewWindow = () => page.frames().find((frame) => frame.url().includes("cmsPreview=1"));
  const richSource = async (path) => {
    const toggle = field(path).locator(".vc-tool-source");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    return field(path).locator("textarea.vc-rich-source");
  };
  const saveState = () => page.locator(".vc-state-long").textContent();
  // E2E_SCREENSHOTS=<folder>: keep pictures of the image sheet, the review and published screens (local look only; CI leaves it unset).
  const shot = async (name) => { if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: join(process.env.E2E_SCREENSHOTS, `${name}.png`) }); };
  const api = (path) => page.evaluate(async (url) => (await fetch(url)).json(), path);
  const open = async (path) => { await page.goto(`${base}${path}`); await page.locator(".vc-inspector, .vc-form, .vc-table, .vc-rows, .vc-empty-state").first().waitFor(); };
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
  await signIn(BOOT.username, BOOT.password, OWNER_PASSWORD);
  // U4: smaller than 900 px, the editor asks for a laptop (Mr Spa 24).
  await page.setViewportSize({ width: 800, height: 900 });
  check("small screen: Open on a laptop, the editor hidden", await page.locator(".vc-small-screen").isVisible() && !(await page.locator(".vc-rail").isVisible()) && /Open on a laptop/.test(await page.locator(".vc-small-screen").innerText()));
  await page.setViewportSize({ width: 1280, height: 900 });
  // M1 (Mr Spa): /admin opens the first page's editor, at its own address.
  await page.locator(".vc-inspector").waitFor();
  check("/admin opens the first page's editor (M1)", new URL(page.url()).pathname === "/admin/pages/site", page.url());
  await open("/admin/pages");
  const navText = await page.locator(".vc-rail").innerText();
  check("shell: the rail has Pages, every collection and Drafts", ["Pages", "Services", "Team", "Blog", "Drafts"].every((label) => navText.includes(label)), navText);
  check("shell: Pages lists every file, with its address and status", /Salon info\s+demo\.example\/\s+Live/.test(await page.locator(".vc-rows").innerText()) && (await page.locator(".vc-count").textContent()) === "1 page", await page.locator(".vc-rows").innerText());
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
  check("inspector level 1: Pages / Salon info, the tip, the sections in page order", (await page.locator(".vc-inspector-crumb").textContent()) === "Pages" && (await page.locator(".vc-inspector-title").textContent()) === "Salon info" && /Click any part of the page, or pick a section below\./.test(await page.locator(".vc-tip").innerText()) && assertEqual(levelOne, ["Homepage", "Contact & hours", "Footer & search"]), levelOne);
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
  check("save state counts unsaved changes", (await saveState()) === "4 unsaved changes", await saveState());
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
  await (await richSource("hero.text")).fill("<p>Everything here is <em>invented</em>.</p>");
  await field("hero.image").getByLabel("Image address").fill("/images/team-sam.svg");
  await field("hero.image").getByLabel("Alt text (describes the image)").fill("A blue square");
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
    && assertEqual(await teamLink.locator("select option").allTextContents(), ["Salon info — /", "Services — /services/", "Team — /team/"])
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
  check("preview: rich text, image and list items (added, moved, removed) follow the form", assertEqual(footerShown, [["Visit us", ["Blog /blog/", "Team /team/"]], ["Legal", ["Privacy /privacy/"]]]) && (await preview.locator('[data-cms-field="site.hero.text"]').innerHTML()) === "<p>Everything here is <em>invented</em>.</p>" && (await preview.locator("img[data-cms-field]").getAttribute("src")) === "/images/team-sam.svg" && (await preview.locator('[data-cms-field="site.highlights"] li').allTextContents()).join(", ") === "Classic Manicure, Nail Art", footerShown);
  await shot("p9-preview");
  await save();
  const siteExpected = {
    ...siteBefore, name: "Demo Salon & Spa", phone: "(555) 010-0001", email: "hi@demo.example", address: { ...siteBefore.address, street: "2 Example Street" },
    hours: [
      { ...siteBefore.hours[0], close: "18:30" },
      { days: [0], label: "Sunday", open: "10:00", close: "16:00" },
      { ...siteBefore.hours[1], label: "Sat" },
    ],
    tagline: "Invented, and proud of it.",
    hero: { title: "Hello from Demo Salon", text: "<p>Everything here is <em>invented</em>.</p>", image: { src: "/images/team-sam.svg", alt: "A blue square" } },
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
  await input("price").fill("40");
  await page.getByRole("button", { name: "Save draft" }).click();
  const ruleShown = await page.waitForFunction(() => /a price starts with \$/.test(document.querySelector(".vc-form")?.textContent ?? ""), null, { timeout: 10_000 }).then(() => true, () => false);
  check("rules: the site's own rule refuses a price without $ (in the Worker), next to the field", ruleShown && /a price starts with \$/.test(await field("price").innerText()), await field("price").innerText());
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
  await page.getByRole("link", { name: "New service" }).click();
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
  const listText = await page.locator(".vc-table").innerText();
  check("list: draft badges + new record", /Spa Pedicure[\s\S]*Draft saved/.test(listText) && /gel-removal[\s\S]*New · not published/.test(listText), listText);
  await page.getByRole("searchbox").fill("gel");
  check("list: search filters", (await page.locator(".vc-table tbody tr").count()) === 1 && /1 of 4 services/.test(await page.locator(".vc-count").innerText()));

  // ---------------------------------------------------------------- owner: team (image, references)
  const team = data("src/data/team.json");
  await open("/admin/catalog/team/alex");
  await field("photo").getByLabel("Image address").fill("/images/hero.svg");
  await field("photo").getByLabel("Alt text (describes the image)").fill("Alex at work");
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
  await field("photo").getByRole("button", { name: "Choose the image for Photo" }).click();
  const sheet = page.getByRole("dialog", { name: "Choose image for Photo" });
  await sheet.locator('.vc-tile[data-src="/images/team-alex.svg"]').waitFor();
  check("image sheet: the site's own images are in the library", (await sheet.locator(".vc-tile").count()) === 3);
  await shot("p10-image-sheet");
  await sheet.locator("input[type=file]").setInputFiles({ name: "Sam at the desk.png", mimeType: "image/png", buffer: Buffer.from(tinyPng(2600, 1300)) });
  await sheet.waitFor({ state: "detached", timeout: 20_000 });
  let samPhoto = await field("photo").getByLabel("Image address").inputValue();
  check("upload: picked at its final address (month folder, name, hash, .webp)", /^\/assets\/uploads\/20\d\d\/\d\d\/sam-at-the-desk-[0-9a-f]{8}\.webp$/.test(samPhoto), samPhoto);
  const library = await api("/api/cms/media");
  check("upload: resized in the browser to 2400 px wide, WebP", assertEqual(library.uploads.map((image) => [image.src, image.width, image.height]), [[samPhoto, 2400, 1200]]) && library.uploads[0].bytes < 2_000_000, library.uploads);
  const staged = await page.evaluate(async (url) => { const response = await fetch(url); const bytes = new Uint8Array(await response.arrayBuffer()); return { status: response.status, type: response.headers.get("content-type"), from: response.headers.get("x-vibe-cms-upload"), head: String.fromCharCode(...bytes.slice(0, 4), ...bytes.slice(8, 12)) }; }, samPhoto);
  check("upload: served from staging before it is published", assertEqual(staged, { status: 200, type: "image/webp", from: "staging", head: "RIFFWEBP" }), staged);
  check("upload: the thumbnail shows it", (await field("photo").locator(".vc-thumb").getAttribute("src")) === samPhoto);
  // P12f: crop the upload to a square — a NEW image made by the browser's canvas, uploaded and chosen; the original stays.
  const originalPhoto = samPhoto;
  await field("photo").getByRole("button", { name: "Choose the image for Photo" }).click();
  const adjustSheet = page.getByRole("dialog", { name: "Choose image for Photo" });
  // U3: select the image, then Crop / resize in the footer.
  await adjustSheet.locator(`.vc-tile[data-src="${originalPhoto}"]`).click();
  await adjustSheet.locator(".vc-sheet-adjust").click();
  await adjustSheet.getByRole("button", { name: "Square" }).click();
  check("crop: Square on a 2400 × 1200 photo makes 1200 × 1200, the original stays", /Makes a new image of 1200 × 1200 px\. The original stays as it is\./.test(await adjustSheet.locator(".vc-adjust").innerText()));
  await adjustSheet.getByRole("button", { name: "Save as a new image" }).click();
  await adjustSheet.waitFor({ state: "detached", timeout: 20_000 });
  samPhoto = await field("photo").getByLabel("Image address").inputValue();
  check("crop: the new copy is chosen, named after the original", /^\/assets\/uploads\/20\d\d\/\d\d\/sam-at-the-desk-1200x1200-[0-9a-f]{8}\.webp$/.test(samPhoto), samPhoto);
  const decoded = await page.evaluate(async (url) => { const bitmap = await createImageBitmap(await (await fetch(url)).blob()); return [bitmap.width, bitmap.height]; }, samPhoto);
  const libraryAfter = await api("/api/cms/media");
  check("crop: the copy really is 1200 × 1200 (decoded); the original is still in the library at 2400 × 1200", assertEqual(decoded, [1200, 1200]) && libraryAfter.uploads.some((image) => image.src === originalPhoto && image.width === 2400 && image.height === 1200), { decoded, uploads: libraryAfter.uploads });
  await shot("p10-picked");
  await input("specialty").selectOption("classic-manicure");
  await save();
  const sam = await api("/api/cms/collections/team/items/sam");
  check("team: an image written as a plain path stays a path", assertEqual(sam.draft?.content, { ...team[1], photo: samPhoto, specialty: "classic-manicure" }), sam.draft);

  // ---------------------------------------------------------------- owner: a Markdown post (status, list, body)
  await open("/admin/catalog/posts/welcome");
  await input("title").fill("Welcome!");
  await input("status").selectOption("draft");
  await field("cover").getByLabel("Image address").fill("/images/team-sam.svg");
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
  await page.keyboard.type(" text.");
  await page.keyboard.press("Enter");
  await tool("body", "Heading").click();
  await page.keyboard.type("Opening hours");
  await page.keyboard.press("Enter");
  await tool("body", "Bulleted list").click();
  await page.keyboard.type("Mon to Fri"); await page.keyboard.press("Enter");
  await page.keyboard.type("Sat"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await tool("body", "Insert an image").click();
  const postSheet = page.getByRole("dialog", { name: "Choose an image" });
  await postSheet.locator(".vc-tile").first().waitFor();
  await postSheet.locator("input[type=file]").setInputFiles({ name: "Post chair.png", mimeType: "image/png", buffer: Buffer.from(tinyPng(1600, 1200)) });
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
  await tool("body", "Insert an image").click();
  const insertSheet = page.getByRole("dialog", { name: "Choose an image" });
  await insertSheet.locator('.vc-tile[data-src="/images/hero.svg"]').click();
  await insertSheet.getByRole("button", { name: "Use image" }).click();
  check("editor: a library image is inserted", (await rich("body").locator("img").count()) === 2);
  await field("body").getByRole("button", { name: "Remove image" }).click();
  check("editor: Remove image takes it out", (await rich("body").locator("img").count()) === 1 && (await rich("body").locator('img[src="/images/hero.svg"]').count()) === 0);
  await previewReady();
  const postShown = await preview.locator('[data-cms-field="body"]').innerHTML();
  check("preview: the post's own page shows the body as written (Markdown → HTML, the resized image)", /<p>New <strong>body<\/strong> text\.<\/p>\s*<h2>Opening hours<\/h2>/.test(postShown) && postShown.includes(`<img src="${postImageSrc}" alt="A pedicure chair" width="${postWidth}">`) && (await preview.locator("h1").textContent()) === "Welcome!", postShown);
  await save();
  const post = await api("/api/cms/collections/posts/items/welcome");
  const postBody = `New **body** text.\n\n## Opening hours\n\n- Mon to Fri\n- Sat\n\n<img src="${postImageSrc}" alt="A pedicure chair" width="${postWidth}">\n`;
  check("post: front matter fields + Markdown body written by the visual editor", assertEqual(post.draft?.content, { slug: "welcome", title: "Welcome!", status: "draft", cover: "/images/team-sam.svg", tags: ["demo", "update"], body: postBody }), post.draft);
  check("editor: Edit Markdown shows the same text", (await (await richSource("body")).inputValue()) === postBody);

  // Discard a draft (confirm), then the live content again.
  await open("/admin/catalog/posts/spring-colours");
  await input("title").fill("Spring colours");
  await save();
  // U3: the editor's Publish opens the review dialog of this draft (what changes); Cancel leaves it a draft.
  await page.locator('[data-action="publish"]').click();
  const publishDialog = page.getByRole("alertdialog", { name: /^Publish .+\?$/ });
  const publishText = await publishDialog.innerText();
  await shot("u3-publish-dialog");
  check("publish dialog: lists this draft's change and publishes to the website", /These changes go live on .+ in a few minutes/.test(publishText) && /Title: Spring colours \(draft\)\s*→\s*Spring colours/.test(publishText) && await publishDialog.getByRole("button", { name: "Publish to website" }).isVisible(), publishText);
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
  await page.locator(".vc-table").waitFor();

  // ---------------------------------------------------------------- P8: review every draft, publish them in one commit
  check("navigation counts my drafts", (await page.locator(".vc-badge").textContent()) === "6");
  await page.locator(".vc-nav-list").getByRole("link", { name: /Drafts/ }).click();
  // U4: Drafts lists them (what changes, when); "Review & publish all" opens the review of all of them.
  await page.locator(".vc-draft-row").first().waitFor();
  check("drafts: one row per draft with what it changes", (await page.locator(".vc-draft-row").count()) === 6 && /\d+ changes?: /.test(await page.locator(".vc-draft-row .vc-row-what").first().innerText()));
  await shot("u4-drafts");
  await page.getByRole("link", { name: "Review & publish all" }).click();
  await page.locator(".vc-review-card").first().waitFor();
  const reviewText = await page.locator(".vc-review-list").innerText();
  await shot("p8-review");
  check("review: 6 drafts, all ticked", (await page.locator(".vc-review-card").count()) === 6 && (await page.locator(".vc-pick:checked").count()) === 6);
  for (const line of ["Salon name: Demo Salon → Demo Salon & Spa", "Phone (admin only): (555) 010-0000 → (555) 010-0001", "Featured services: removed Spa Pedicure", "Price (admin only): $35 → $40", "New service: Gel Removal", "Specialty: Nail Art → Spa Pedicure", "Status: published → draft", "Text: This post is invented. It exists so the CMS has a Markdown record to edit. → New body text. Opening hours Mon to Fri Sat", "Text › image: added /assets/uploads/"]) {
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
  await page.locator('[data-action="history"]').click();
  await page.locator(".vc-history-item").first().waitFor();
  const versions = await page.locator(".vc-history-item").allInnerTexts();
  check("history: the publish and the first version, newest first", versions.length === 2 && /Published in the CMS · newest/.test(versions[0]) && /Changed in the website's code/.test(versions[1]), versions);
  // This Worker is not rebuilt after the publish, so the website still shows the first version: comparing the
  // published one lists what it changes; the first one is "what the website shows now".
  const compareText = async (index) => {
    const item = page.locator(".vc-history-item").nth(index);
    await item.getByRole("button", { name: "Compare" }).click();
    await item.locator(".vc-history-changes:not([hidden])").waitFor();
    return { text: await item.locator(".vc-history-changes").innerText(), lines: await item.locator(".vc-changes li").count() };
  };
  const newest = await compareText(0); const oldest = await compareText(1);
  check("history: compare lists what the published version changes on the website", /Restoring it would change:/.test(newest.text) && newest.lines > 0, newest);
  check("history: the first version is what the website shows now", /This is what the website shows now/.test(oldest.text), oldest);

  // ---------------------------------------------------------------- P8b: the owner adds an editor on the People screen
  await page.locator(".vc-rail-bottom").getByRole("link", { name: "Users" }).click();
  await page.locator("form.vc-people-add").waitFor();
  await page.getByLabel("Username", { exact: true }).fill("editor1");
  await page.getByLabel("Name (optional)").fill("Editor One");
  await page.locator('#vc-new-role input[value="editor"]').check();
  await page.getByRole("button", { name: "Add person" }).click();
  await page.locator(".vc-secret-value").waitFor();
  const created = { temporaryPassword: (await page.locator(".vc-secret-value").textContent()) ?? "" };
  await shot("p8b-people");
  check("People: the new editor's temporary password is shown once", /^[A-Za-z2-9]{20}$/.test(created.temporaryPassword) && /Must choose a password/.test(await page.locator('tr[data-user="editor1"]').innerText()));
  check("People: the add form posts", (await page.locator("form.vc-people-add").getAttribute("method")) === "post");
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
  await (await richSource("hero.text")).fill('<p>Hi</p><img src="x" onerror="alert(1)"><script>alert(2)</script>');
  await save();
  check("rich text: the script and the onerror are removed on save, and the editor is told", (await (await richSource("hero.text")).inputValue()) === '<p>Hi</p><img src="x">' && /removed for safety/.test(await page.locator(".vc-banner").innerText()) && (await api("/api/cms/files/site")).draft?.content.hero.text === '<p>Hi</p><img src="x">');
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
