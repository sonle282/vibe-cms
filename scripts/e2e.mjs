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
// Then the editor signs in: locked fields are shown but disabled, other fields save; they change their own password on
// My account. Nothing remote; test values only.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`); });
  page.on("response", (response) => { if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${response.url()}`); });

  const field = (path) => page.locator(`[data-path=${JSON.stringify(path)}]`);
  const input = (path) => field(path).locator("input, textarea, select").first();
  const button = (path, name) => field(path).getByRole("button", { name, exact: true });
  // P8d: the visual editor — its editable area, a toolbar button, and its source view ("Edit HTML" / "Edit Markdown").
  const rich = (path) => field(path).locator(".vc-rich-area");
  const tool = (path, name) => field(path).locator(".vc-rich-toolbar").getByRole("button", { name, exact: true });
  const richSource = async (path) => {
    const toggle = field(path).locator(".vc-tool-source");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    return field(path).locator("textarea.vc-rich-source");
  };
  const saveState = () => page.locator(".vc-save-state").textContent();
  // E2E_SCREENSHOTS=<folder>: keep pictures of the image sheet, the review and published screens (local look only; CI leaves it unset).
  const shot = async (name) => { if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: join(process.env.E2E_SCREENSHOTS, `${name}.png`), fullPage: true }); };
  const api = (path) => page.evaluate(async (url) => (await fetch(url)).json(), path);
  const open = async (hash) => { await page.goto(`${base}/admin${hash}`); await page.locator(".vc-form, .vc-table, .vc-cards").first().waitFor(); };
  const save = async () => {
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForFunction(() => document.querySelector(".vc-save-state")?.textContent === "Draft saved · not live yet", null, { timeout: 10_000 });
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
    await page.locator(".vc-cards").waitFor();
  };

  // ---------------------------------------------------------------- owner: sign in, overview
  const adminResponse = await page.goto(`${base}/admin`);
  check("/admin: no framing, no caching", adminResponse.headers()["x-frame-options"] === "DENY" && /no-store/.test(adminResponse.headers()["cache-control"] ?? ""), adminResponse.headers());
  check("signed out → the sign-in form posts", (await page.locator("form#login").getAttribute("method")) === "post");
  await signIn(BOOT.username, BOOT.password, OWNER_PASSWORD);
  const navText = await page.locator(".vc-nav-list").innerText();
  check("shell: navigation lists every file and collection", ["Overview", "Salon info", "Services", "Team", "Blog"].every((label) => navText.includes(label)), navText);
  check("overview: counts from the API", /3 services/.test(await page.locator(".vc-cards").innerText()));

  // ---------------------------------------------------------------- owner: every field of the salon info
  const siteBefore = data("src/data/site.json");
  await open("#/files/site");
  check("salon info: nothing changed yet", (await saveState()) === "No changes" && await page.getByRole("button", { name: "Save draft" }).isDisabled());
  await input("name").fill("Demo Salon & Spa");
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
  await input("tagline").fill("Invented, and proud of it.");
  await input("hero.title").fill("Hello from Demo Salon");
  await (await richSource("hero.text")).fill("<p>Everything here is <em>invented</em>.</p>");
  await field("hero.image").getByLabel("Image address").fill("/images/team-sam.svg");
  await field("hero.image").getByLabel("Alt text (describes the image)").fill("A blue square");
  await field("highlights").locator("select").selectOption("nail-art");
  await button("highlights", "Move Classic Manicure up").click();
  await button("highlights", "Remove Spa Pedicure").click();
  await input("footerLinks[0].title").fill("Visit us");
  await field("footerLinks[0].links").getByRole("button", { name: "Add link" }).click();
  await input("footerLinks[0].links[2].label").fill("Blog");
  await input("footerLinks[0].links[2].href").fill("/blog/");
  await button("footerLinks[0].links", "Move Link 3 up").click();
  await button("footerLinks[0].links", "Delete Link 1").click();
  await field("footerLinks").getByRole("button", { name: "Add group" }).click();
  await input("footerLinks[1].title").fill("Legal");
  await field("footerLinks[1].links").getByRole("button", { name: "Add link" }).click();
  await input("footerLinks[1].links[0].label").fill("Privacy");
  await input("footerLinks[1].links[0].href").fill("/privacy/");
  await input("seo.title").fill("Demo Salon");
  await input("seo.description").fill("Invented salon.\nSecond line.");
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
  };
  const siteDraft = await api("/api/cms/files/site");
  check("salon info: every field edited in the form is in the saved draft (P5 API)", JSON.stringify(siteDraft.draft?.content) && assertEqual(siteDraft.draft.content, siteExpected), { draft: siteDraft.draft?.content, expected: siteExpected });
  check("salon info: unchanged keys keep their order", JSON.stringify(Object.keys(siteDraft.draft.content)) === JSON.stringify(Object.keys(siteBefore)) && JSON.stringify(Object.keys(siteDraft.draft.content.hours[2])) === JSON.stringify(Object.keys(siteBefore.hours[1])));
  await page.reload();
  await page.locator(".vc-form").waitFor();
  check("reopening shows the draft", (await input("tagline").inputValue()) === "Invented, and proud of it." && (await saveState()) === "Draft saved · not live yet");

  // ---------------------------------------------------------------- owner: a service (text, locked price, select, ordered list)
  const services = data("src/data/services.json");
  await open("#/collections/services/items/spa-pedicure");
  check("record id is shown but fixed", await input("id").isDisabled());
  await input("name").fill("Spa Pedicure Deluxe");
  await input("price").fill("$40");
  await input("category").selectOption("Nails");
  await button("extras", "Move Extra 2 up").click();
  await field("extras").getByRole("button", { name: "Add extra" }).click();
  await input("extras[2]").fill("Foot mask");
  await button("extras", "Delete Extra 2").click();
  await input("description").fill("Warm soak and massage.");
  await save();
  const spa = await api("/api/cms/collections/services/items/spa-pedicure");
  check("service: every field in the draft", assertEqual(spa.draft?.content, { ...services[1], name: "Spa Pedicure Deluxe", price: "$40", category: "Nails", extras: ["Paraffin", "Foot mask"], description: "Warm soak and massage." }), spa.draft);

  // A new service: the id follows the name until edited.
  await open("#/collections/services");
  await page.getByRole("link", { name: "Add service" }).click();
  await page.locator(".vc-form").waitFor();
  await input("name").fill("Gel Removal");
  check("new record: id filled from the name", (await input("id").inputValue()) === "gel-removal");
  await input("price").fill("$10");
  await input("category").selectOption("Nails");
  await field("extras").getByRole("button", { name: "Add extra" }).click();
  await input("extras[0]").fill("Cuticle oil");
  await save();
  await page.waitForURL(/#\/collections\/services\/items\/gel-removal$/);
  const gel = await api("/api/cms/collections/services/items/gel-removal");
  check("new service saved as a draft (expectedRevision 0, version new)", assertEqual(gel.draft?.content, { id: "gel-removal", name: "Gel Removal", price: "$10", category: "Nails", extras: ["Cuticle oil"] }) && gel.version === "new", gel);
  await open("#/collections/services");
  const listText = await page.locator(".vc-table").innerText();
  check("list: draft badges + new record", /Spa Pedicure[\s\S]*Draft saved/.test(listText) && /gel-removal[\s\S]*New · not published/.test(listText), listText);
  await page.getByRole("searchbox").fill("gel");
  check("list: search filters", (await page.locator(".vc-table tbody tr").count()) === 1 && /1 of 4 services/.test(await page.locator(".vc-count").innerText()));

  // ---------------------------------------------------------------- owner: team (image, references)
  const team = data("src/data/team.json");
  await open("#/collections/team/items/alex");
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
  await open("#/collections/team/items/sam");
  await field("photo").getByRole("button", { name: "Choose the image for Photo" }).click();
  const sheet = page.getByRole("dialog", { name: "Choose an image" });
  await sheet.locator('.vc-tile[data-src="/images/team-alex.svg"]').waitFor();
  check("image sheet: the site's own images are in the library", (await sheet.locator(".vc-tile").count()) === 3);
  await shot("p10-image-sheet");
  await sheet.locator("input[type=file]").setInputFiles({ name: "Sam at the desk.png", mimeType: "image/png", buffer: Buffer.from(tinyPng(2600, 1300)) });
  await sheet.waitFor({ state: "detached", timeout: 20_000 });
  const samPhoto = await field("photo").getByLabel("Image address").inputValue();
  check("upload: picked at its final address (month folder, name, hash, .webp)", /^\/assets\/uploads\/20\d\d\/\d\d\/sam-at-the-desk-[0-9a-f]{8}\.webp$/.test(samPhoto), samPhoto);
  const library = await api("/api/cms/media");
  check("upload: resized in the browser to 2400 px wide, WebP", assertEqual(library.uploads.map((image) => [image.src, image.width, image.height]), [[samPhoto, 2400, 1200]]) && library.uploads[0].bytes < 2_000_000, library.uploads);
  const staged = await page.evaluate(async (url) => { const response = await fetch(url); const bytes = new Uint8Array(await response.arrayBuffer()); return { status: response.status, type: response.headers.get("content-type"), from: response.headers.get("x-vibe-cms-upload"), head: String.fromCharCode(...bytes.slice(0, 4), ...bytes.slice(8, 12)) }; }, samPhoto);
  check("upload: served from staging before it is published", assertEqual(staged, { status: 200, type: "image/webp", from: "staging", head: "RIFFWEBP" }), staged);
  check("upload: the thumbnail shows it", (await field("photo").locator(".vc-thumb").getAttribute("src")) === samPhoto);
  await shot("p10-picked");
  await input("specialty").selectOption("classic-manicure");
  await save();
  const sam = await api("/api/cms/collections/team/items/sam");
  check("team: an image written as a plain path stays a path", assertEqual(sam.draft?.content, { ...team[1], photo: samPhoto, specialty: "classic-manicure" }), sam.draft);

  // ---------------------------------------------------------------- owner: a Markdown post (status, list, body)
  await open("#/collections/posts/items/welcome");
  await input("title").fill("Welcome!");
  await input("status").selectOption("draft");
  await field("cover").getByLabel("Image address").fill("/images/team-sam.svg");
  await button("tags", "Delete Tag 1").click();
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
  const before = await postImage.boundingBox();
  const handle = await field("body").locator(".vc-rich-handle").boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 8 - 200, handle.y + 8 + 40, { steps: 10 });
  await page.mouse.up();
  const after = await postImage.boundingBox();
  const postWidth = Number(await postImage.getAttribute("width"));
  check("editor: dragging the corner resizes the image, ratio kept, width written", Math.abs(postWidth - (before.width - 200)) <= 2 && Math.abs(after.width - postWidth) <= 1 && Math.abs(after.height / after.width - 0.75) < 0.01 && !(await postImage.getAttribute("height")), { before, after, postWidth });
  await shot("p8d-editor");
  await tool("body", "Insert an image").click();
  await page.getByRole("dialog", { name: "Choose an image" }).locator('.vc-tile[data-src="/images/hero.svg"]').click();
  check("editor: a library image is inserted", (await rich("body").locator("img").count()) === 2);
  await field("body").getByRole("button", { name: "Remove image" }).click();
  check("editor: Remove image takes it out", (await rich("body").locator("img").count()) === 1 && (await rich("body").locator('img[src="/images/hero.svg"]').count()) === 0);
  await save();
  const post = await api("/api/cms/collections/posts/items/welcome");
  const postBody = `New **body** text.\n\n## Opening hours\n\n- Mon to Fri\n- Sat\n\n<img src="${postImageSrc}" alt="A pedicure chair" width="${postWidth}">\n`;
  check("post: front matter fields + Markdown body written by the visual editor", assertEqual(post.draft?.content, { slug: "welcome", title: "Welcome!", status: "draft", cover: "/images/team-sam.svg", tags: ["demo", "update"], body: postBody }), post.draft);
  check("editor: Edit Markdown shows the same text", (await (await richSource("body")).inputValue()) === postBody);

  // Discard a draft (confirm), then the live content again.
  await open("#/collections/posts/items/spring-colours");
  await input("title").fill("Spring colours");
  await save();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await page.waitForFunction(() => document.querySelector(".vc-save-state")?.textContent === "No changes");
  check("discard: the draft is gone, the live title is back", (await api("/api/cms/collections/posts/items/spring-colours")).draft === null && (await input("title").inputValue()) === "Spring colours (draft)");

  // Leaving with unsaved changes asks first.
  await open("#/collections/services/items/classic-manicure");
  await input("name").fill("Classic Manicure (changed)");
  let asked = "";
  page.once("dialog", (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
  await page.locator(".vc-nav-list").getByRole("link", { name: "Team" }).click();
  await page.waitForTimeout(300);
  check("unsaved changes: leaving asks, staying keeps them", /Leave without saving\?/.test(asked) && page.url().endsWith("#/collections/services/items/classic-manicure") && (await input("name").inputValue()) === "Classic Manicure (changed)", { asked, url: page.url() });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".vc-nav-list").getByRole("link", { name: "Team" }).click();
  await page.locator(".vc-table").waitFor();

  // ---------------------------------------------------------------- P8: review every draft, publish them in one commit
  check("navigation counts my drafts", (await page.locator(".vc-badge").textContent()) === "6");
  await page.locator(".vc-nav-list").getByRole("link", { name: /Review & publish/ }).click();
  await page.locator(".vc-review-card").first().waitFor();
  const reviewText = await page.locator(".vc-review-list").innerText();
  await shot("p8-review");
  check("review: 6 drafts, all ticked", (await page.locator(".vc-review-card").count()) === 6 && (await page.locator(".vc-pick:checked").count()) === 6);
  for (const line of ["Salon name: Demo Salon → Demo Salon & Spa", "Phone (owner only): (555) 010-0000 → (555) 010-0001", "Featured services: removed Spa Pedicure", "Price (owner only): $35 → $40", "New service: Gel Removal", "Specialty: Nail Art → Spa Pedicure", "Status: published → draft", "Text: This post is invented. It exists so the CMS has a Markdown record to edit. → New body text. Opening hours Mon to Fri Sat", "Text › image: added /assets/uploads/"]) {
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
  check("P10: the uploaded image is in the same commit, exact bytes (WebP)", committedImage && committedImage.subarray(0, 4).toString("latin1") === "RIFF" && committedImage.subarray(8, 12).toString("latin1") === "WEBP" && github.changedPaths(head).includes(`public${samPhoto}`), github.changedPaths(head));
  check("published post: front matter + body", /title: Welcome!/.test(published["src/content/posts/welcome.md"]) && published["src/content/posts/welcome.md"].endsWith(postBody));
  check("P8d: the image in the post body is in the same commit", github.bytes(`public${postImageSrc}`)?.subarray(8, 12).toString("latin1") === "WEBP");
  check("commit message names the owner's internal id, no email", /usr_[a-z2-7]{16}/.test(github.commit().message) && !github.commit().message.includes("@"));
  check("after publishing: 'Publishing…' until the site serves it; no drafts left", /Publishing… started/.test(await page.locator(".vc-live").innerText()) && await page.locator(".vc-badge").isHidden());

  // ---------------------------------------------------------------- P8b: the owner adds an editor on the People screen
  await page.locator(".vc-nav-list").getByRole("link", { name: "People" }).click();
  await page.locator("form.vc-people-add").waitFor();
  await page.getByLabel("Username", { exact: true }).fill("editor1");
  await page.getByLabel("Name (optional)").fill("Editor One");
  await page.getByLabel("Role", { exact: true }).selectOption("editor");
  await page.getByRole("button", { name: "Add person" }).click();
  await page.locator(".vc-secret-value").waitFor();
  const created = { temporaryPassword: (await page.locator(".vc-secret-value").textContent()) ?? "" };
  await shot("p8b-people");
  check("People: the new editor's temporary password is shown once", /^[A-Za-z2-9]{20}$/.test(created.temporaryPassword) && /Must choose a password/.test(await page.locator('tr[data-user="editor1"]').innerText()));
  check("People: the add form posts", (await page.locator("form.vc-people-add").getAttribute("method")) === "post");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator("form#login").waitFor();

  // ---------------------------------------------------------------- editor: locked fields shown, not editable
  await signIn("editor1", created.temporaryPassword, EDITOR_PASSWORD);
  await open("#/files/site");
  const lockedDisabled = await Promise.all(["phone", "email", "address.street", "address.city"].map((path) => input(path).isDisabled()));
  check("editor: phone, email, address are shown but disabled", lockedDisabled.every(Boolean) && (await input("phone").inputValue()) === siteBefore.phone, lockedDisabled);
  check("editor: hours disabled (days, times, add row)", await field("hours[0]").getByLabel("Monday").isDisabled() && await field("hours").getByRole("button", { name: "Add a row" }).isDisabled());
  check("editor: the lock says why", (await field("phone").innerText()).includes("Only the owner can change this."));
  check("editor: other fields are editable", !(await input("tagline").isDisabled()) && !(await input("hero.title").isDisabled()));
  await input("tagline").fill("Edited by the editor.");
  await save();
  check("editor saves an unlocked field", (await api("/api/cms/files/site")).draft?.content.tagline === "Edited by the editor.");
  // P8c: unsafe HTML typed into rich text never reaches a draft.
  await (await richSource("hero.text")).fill('<p>Hi</p><img src="x" onerror="alert(1)"><script>alert(2)</script>');
  await save();
  check("rich text: the script and the onerror are removed on save, and the editor is told", (await (await richSource("hero.text")).inputValue()) === '<p>Hi</p><img src="x">' && /removed for safety/.test(await page.locator(".vc-banner").innerText()) && (await api("/api/cms/files/site")).draft?.content.hero.text === '<p>Hi</p><img src="x">');
  await open("#/collections/services/items/nail-art");
  check("editor: price disabled on a service", await input("price").isDisabled());
  await open("#/collections/services/new");
  await input("name").fill("Editor Special");
  check("editor: a new service's price stays empty and disabled", await input("price").isDisabled() && (await input("price").inputValue()) === "");
  await save();
  check("editor adds a service with the price left for the owner (rule 2)", (await api("/api/cms/collections/services/items/editor-special")).draft?.content.name === "Editor Special");
  check("editor: no People in the navigation", !(await page.locator(".vc-nav-list").innerText()).includes("People"));
  // P8b: My account — the editor changes their own password and stays signed in.
  await page.locator(".vc-user-name").click();
  await page.locator("form.vc-account").waitFor();
  await page.getByLabel("Current password").fill(EDITOR_PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill("editor-e2e-password-3");
  await page.getByLabel("New password again").fill("editor-e2e-password-3");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Password changed.").waitFor();
  check("My account: the password change keeps this session", (await api("/api/auth/me")).user?.username === "editor1");

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
