// P7: the admin form and shell on a fake DOM (happy-dom) — every field type of the demo site renders, edits and keeps
// what it does not touch; locks for editors; error placement; and the shell saving drafts through the REAL CMS API
// (createCmsApi with in-memory stores) behind a fake fetch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f, loadCmsConfig } from "../dist/index.js";
import { lineDiff } from "./helpers/diff.mjs";
import { startFakeGitHub } from "./helpers/fake-github.mjs";
import { adminBoot, bootJson, countChanges, createForm, holdsLockedValue, LOCK_HELP, pathText, same, setAt, slugify, startAdmin } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files; let site; let services; let team;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
  site = JSON.parse(files["src/data/site.json"]);
  services = JSON.parse(files["src/data/services.json"]);
  team = JSON.parse(files["src/data/team.json"]);
});

const dom = () => { const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } }); return { window, document: window.document }; };
const type = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const choose = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const toggle = (window, element, checked) => { element.checked = checked; element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const references = () => ({ services: { label: "Services", itemLabel: "Service", items: services.map((item) => ({ id: item.id, label: item.name })) } });
const siteForm = (document, role = "owner", onChange) => createForm({ doc: document, fields: config.files[0].fields, sections: config.files[0].sections, value: site, role, references: references(), onChange });
const at = (form, path) => form.element.querySelector(`[data-path=${JSON.stringify(path)}]`);
// The field's main control: a visual editor's area (P8d) or the first input.
const control = (form, path) => at(form, path).querySelector("[data-vc-primary]:not([hidden])") ?? at(form, path).querySelector("input, textarea, select");
/** Type into a visual editor's area (happy-dom has no editing commands: set the HTML, fire input). */
const edit = (window, area, html) => { area.innerHTML = html; area.dispatchEvent(new window.Event("input", { bubbles: true })); };
const press = (form, path, label) => { const button = [...at(form, path).querySelectorAll("button")].find((entry) => entry.getAttribute("aria-label") === label); assert.ok(button, `button "${label}" in ${path}`); assert.equal(button.disabled, false, `"${label}" is enabled`); button.click(); };

// ------------------------------------------------------------------ values

test("values: readable paths, key order kept when setting, a re-order counts as one change, slugs", () => {
  assert.equal(pathText(["footerLinks", 0, "links", 2, "href"]), "footerLinks[0].links[2].href");
  assert.equal(pathText(["odd key"]), '["odd key"]');
  const value = { a: 1, b: { c: 2 } };
  setAt(value, ["seo", "title"], "T"); setAt(value, ["a"], 3);
  assert.deepEqual(Object.keys(value), ["a", "b", "seo"]);
  setAt(value, ["b", "c"], undefined);
  assert.deepEqual(value, { a: 3, b: {}, seo: { title: "T" } });
  assert.equal(countChanges(["x", "y", "z"], ["z", "x", "y"]), 1, "moving items is one change");
  assert.equal(countChanges({ a: "1", list: ["x"] }, { a: "2", list: ["x", "y"] }), 2);
  assert.equal(countChanges({ a: undefined }, { a: "" }), 0, "empty and missing are the same");
  assert.equal(slugify("Spa Pedicure — Deluxe!"), "spa-pedicure-deluxe");
  assert.equal(slugify("Gội đầu dưỡng sinh"), "goi-dau-duong-sinh");
  assert.equal(holdsLockedValue(f.object({ label: "S", fields: { price: f.text({ label: "Price", locked: "admin" }), name: f.text({ label: "N" }) } }), { name: "x", price: "" }), false);
  assert.equal(holdsLockedValue(f.object({ label: "S", fields: { price: f.text({ label: "Price", locked: "admin" }) } }), { price: "$5" }), true);
});

test("boot data for the page: only the editable config + who is signed in, safe inside a script tag", () => {
  const boot = adminBoot({ ...config, site: { ...config.site, name: "</script><script>alert(1)</script>" } }, { id: "usr_a", username: "a", displayName: "A", role: "editor" });
  assert.deepEqual(boot.collections.map((collection) => [collection.key, collection.idField, collection.markdown]), [["services", "id", false], ["team", "id", false], ["posts", "slug", true]]);
  assert.ok(!("repo" in boot) && !JSON.stringify(boot).includes("vibe-cms-demo"), "no repository details");
  const json = bootJson(boot);
  assert.ok(!json.includes("</script>") && !json.includes("<"));
  assert.equal(JSON.parse(json).site.name, "</script><script>alert(1)</script>");
});

// ------------------------------------------------------------------ the form: every field type

test("form: every field of the demo's salon info renders with the right control, in its section", () => {
  const { document } = dom();
  const form = siteForm(document);
  assert.deepEqual([...form.element.querySelectorAll("section h2")].map((node) => node.textContent), ["Contact & hours", "Homepage", "Footer & search"]);
  const expected = { name: "INPUT", phone: "INPUT", email: "INPUT", "address.street": "INPUT", tagline: "INPUT", "hero.title": "INPUT", "hero.text": "DIV", "seo.title": "INPUT", "seo.description": "TEXTAREA" };
  for (const [path, tag] of Object.entries(expected)) assert.equal(control(form, path)?.tagName, tag, path);
  assert.equal(at(form, "hours").querySelectorAll(".vc-hours-row").length, 3);
  // M5 (Mr Spa): the image card, then only the image description (no address box under it).
  assert.ok(at(form, "hero.image").querySelector(".vc-image-card .vc-image-thumb img"), "image: the card");
  assert.deepEqual([...at(form, "hero.image").querySelectorAll("input")].map((input) => input.closest(".vc-subfield")?.querySelector("label").textContent), ["Image description"]);
  assert.deepEqual([...at(form, "highlights").querySelectorAll(".vc-chosen-label")].map((node) => node.textContent), ["Spa Pedicure", "Classic Manicure"]);
  assert.equal(at(form, "footerLinks[0].links[1].href").querySelector("input").value, "/team/");
  // M3 (Mr Spa): no counter; the input holds at most maxLength.
  assert.equal(at(form, "name").querySelector(".vc-counter"), null);
  assert.equal(control(form, "name").getAttribute("maxlength"), "60");
  assert.match(at(form, "name").querySelector("label").textContent, /Salon name \* \(required\)/);
  for (const input of form.element.querySelectorAll("input, textarea, select")) assert.ok(input.id ? form.element.querySelector(`label[for="${input.id}"]`) || input.getAttribute("aria-label") : input.getAttribute("aria-label"), `every input has a label (${input.outerHTML.slice(0, 80)})`);
});

test("form: untouched → the same value, same key order; unknown keys are kept", () => {
  const { document } = dom();
  const form = createForm({ doc: document, fields: config.files[0].fields, value: { ...site, extraFromCode: { keep: true } }, role: "owner", references: references() });
  const value = form.value();
  assert.deepEqual(value, { ...site, extraFromCode: { keep: true } });
  assert.equal(JSON.stringify(value), JSON.stringify({ ...site, extraFromCode: { keep: true } }), "byte-identical JSON");
});

test("form: text, select, image, rich text, dotted keys — edits land at the right path, nothing else moves", () => {
  const { window, document } = dom();
  const changes = [];
  const form = siteForm(document, "owner", (_value, path) => changes.push(path.join(".")));
  type(window, control(form, "tagline"), "New tagline");
  type(window, control(form, "seo.title"), "Search title");
  edit(window, control(form, "hero.text"), "<p>Hi</p>");
  type(window, at(form, "hero.image").querySelector(".vc-image-alt input"), "");
  const value = form.value();
  assert.deepEqual(value, { ...site, tagline: "New tagline", seo: { ...site.seo, title: "Search title" }, hero: { ...site.hero, text: "<p>Hi</p>", image: { ...site.hero.image, alt: "" } } });
  assert.deepEqual(Object.keys(value), Object.keys(site));
  assert.ok(changes.includes("tagline") && changes.includes("seo.title"));


  // An image written as a path stays a path (a new one is chosen in the sheet); adding alt makes it { src, alt }.
  const teamForm = createForm({ doc: document, fields: config.collections[1].fields, value: team[1], role: "owner", references: references(), pickImage: (_current, done) => done({ src: "/images/other.svg" }) });
  at(teamForm, "photo").querySelector(".vc-image-replace").click();
  assert.equal(teamForm.value().photo, "/images/other.svg");
  type(window, at(teamForm, "photo").querySelector(".vc-image-alt input"), "Sam");
  assert.deepEqual(teamForm.value().photo, { src: "/images/other.svg", alt: "Sam" });
  // A select / single reference that was missing stays missing when set back to empty.
  choose(window, control(teamForm, "specialty"), "nail-art");
  choose(window, control(teamForm, "specialty"), "");
  assert.ok(!("specialty" in teamForm.value()));
});

test("form: hours — days, closed, times, label, order", () => {
  const { window, document } = dom();
  const form = siteForm(document);
  const row = (index) => at(form, `hours[${index}]`);
  toggle(window, row(0).querySelector('input[aria-label="Friday"]'), false);
  toggle(window, row(1).querySelector('input[aria-label="Friday"]'), true);
  const sunday = row(2).querySelector('input[type="checkbox"]:not([aria-label])');
  toggle(window, sunday, false);
  const times = row(2).querySelectorAll('input[type="time"]');
  assert.equal(times[0].disabled, false, "times open up when the day is no longer closed");
  type(window, times[0], "10:00");
  press(form, "hours", "Move Row 3 up");
  assert.deepEqual(form.value().hours, [
    { days: [1, 2, 3, 4], label: "Monday – Friday", open: "09:00", close: "19:00" },
    { days: [0], label: "Sunday", open: "10:00", close: "17:00" },
    { days: [5, 6], label: "Saturday", open: "09:00", close: "17:00" },
  ]);
  at(form, "hours").querySelector(".vc-add").click();
  assert.deepEqual(form.value().hours[3], { days: [], open: "09:00", close: "17:00" });
});

test("form: lists — add, move, delete, max; nested lists of objects", () => {
  const { window, document } = dom();
  const form = siteForm(document);
  press(form, "footerLinks[0].links", "Move Link 2 up");
  at(form, "footerLinks[0].links").querySelector(".vc-add").click();
  type(window, control(form, "footerLinks[0].links[2].label"), "Blog");
  // M4: a link — Web address, then the address.
  at(form, "footerLinks[0].links[2].href").querySelector('[data-link-kind="url"]').click();
  type(window, at(form, "footerLinks[0].links[2].href").querySelector("input.vc-link-text"), "/blog/");
  press(form, "footerLinks[0].links", "Delete Link 1");
  assert.deepEqual(form.value().footerLinks[0].links, [{ label: "Services", href: "/services/" }, { label: "Blog", href: "/blog/" }]);
  const groups = at(form, "footerLinks");
  groups.querySelector(":scope > .vc-list > .vc-add").click();
  groups.querySelector(":scope > .vc-list > .vc-add").click();
  assert.equal(form.value().footerLinks.length, 3);
  assert.equal(groups.querySelector(":scope > .vc-list > .vc-add").disabled, true, "max 3 groups");
  assert.match(groups.querySelector(".vc-note").textContent, /3 of 3 allowed/);

  const serviceForm = createForm({ doc: document, fields: config.collections[0].fields, value: services[1], role: "owner" });
  press(serviceForm, "extras", "Move Extra 2 up");
  assert.deepEqual(serviceForm.value().extras, ["Paraffin", "Hot stones"]);
  const limited = createForm({ doc: document, fields: { tags: f.list(f.text({ label: "Tag" }), { label: "Tags", min: 1, itemLabel: "Tag" }) }, value: { tags: ["only"] }, role: "owner" });
  assert.equal(at(limited, "tags").querySelector('[aria-label="Delete Tag 1"]').disabled, true, "min 1: the last item cannot be deleted");
  assert.equal(at(limited, "tags").querySelector('[aria-label="Move Tag 1 up"]'), null, "an unordered list has no move buttons");
});

test("form: references — one, many, ordered; unknown ids are shown", () => {
  const { window, document } = dom();
  const form = siteForm(document);
  const picker = at(form, "highlights").querySelector("select");
  assert.deepEqual([...picker.options].map((option) => option.value), ["", "nail-art"], "only services not chosen yet");
  choose(window, picker, "nail-art");
  press(form, "highlights", "Move Nail Art up");
  press(form, "highlights", "Remove Spa Pedicure");
  assert.deepEqual(form.value().highlights, ["nail-art", "classic-manicure"]);
  const odd = createForm({ doc: document, fields: config.collections[1].fields, value: { ...team[0], specialty: "gone" }, role: "owner", references: references() });
  assert.match(control(odd, "specialty").selectedOptions[0].textContent, /gone \(not found\)/);
});

test("form: an editor sees locked fields disabled (any depth) and cannot delete items holding owner-only values; the owner can", () => {
  const { document } = dom();
  const editor = siteForm(document, "editor");
  for (const path of ["phone", "email", "address.street", "address.city"]) assert.equal(control(editor, path).disabled, true, path);
  assert.equal(at(editor, "address").disabled, true, "the locked object is disabled as a whole");
  assert.ok([...at(editor, "hours").querySelectorAll("input, button")].every((element) => element.disabled), "hours: every input and button");
  assert.match(at(editor, "phone").textContent, new RegExp(LOCK_HELP.replace(".", "\\.")));
  assert.ok(at(editor, "phone").querySelector(".vc-lock"), "a lock icon");
  assert.equal(control(editor, "tagline").disabled, false);
  assert.equal(at(editor, "footerLinks").querySelector(".vc-add").disabled, false);

  const fields = { menu: f.list(f.object({ label: "Row", fields: { name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "admin" }) } }), { label: "Menu", ordered: true, itemLabel: "Row" }) };
  const value = { menu: [{ name: "Priced", price: "$5" }, { name: "Not priced yet" }] };
  const asEditor = createForm({ doc: document, fields, value, role: "editor" });
  assert.equal(at(asEditor, "menu").querySelector('[aria-label^="Only an admin can delete Row 1"]').disabled, true);
  assert.equal(at(asEditor, "menu").querySelector('[aria-label="Delete Row 2"]').disabled, false);
  assert.equal(at(asEditor, "menu").querySelector('[aria-label="Move Row 1 down"]').disabled, false, "re-ordering is allowed");
  assert.equal(control(asEditor, "menu[0].price").disabled, true);
  const asOwner = createForm({ doc: document, fields, value, role: "owner" });
  assert.equal(at(asOwner, "menu").querySelector('[aria-label="Delete Row 1"]').disabled, false);
  assert.match(at(asOwner, "menu[0].price").textContent, /Editors see this but only an admin can change it/);
  // M2: an admin sees the lock too, on "admin" (and on the old name "owner").
  assert.ok(at(asOwner, "menu[0].price").querySelector(".vc-lock"), "the lock icon for an admin");
  assert.match(at(asOwner, "menu[0].price").textContent, /\(admin only/);
  // M3b: for an admin the note is the lock's tooltip, not a line under the field.
  assert.equal(at(asOwner, "menu[0].price").querySelector(".vc-lock").dataset.tooltip, "Editors see this but only an admin can change it.");
  assert.doesNotMatch(at(asOwner, "menu[0].price").querySelector(".vc-help")?.textContent ?? "", /Editors see this/);
});

test("form: problems show next to their field (closest field for deep paths); others in a list at the top", () => {
  const { document } = dom();
  const form = siteForm(document);
  const placed = form.showErrors([{ path: "name", message: "required" }, { path: "footerLinks[0].links[1].href", message: "bad link" }, { path: "hours[1].close", message: "close after open" }, { path: "nowhere", message: "elsewhere" }]);
  assert.equal(placed, 3);
  assert.equal(at(form, "name").querySelector(".vc-error").textContent, "required");
  assert.equal(control(form, "name").getAttribute("aria-invalid"), "true");
  assert.equal(at(form, "footerLinks[0].links[1].href").querySelector(".vc-error").textContent, "bad link");
  assert.equal(at(form, "hours[1]").querySelector(".vc-error").textContent, "close after open");
  assert.match(form.element.querySelector(".vc-form-errors").textContent, /nowhere: elsewhere/);
  form.clearErrors();
  assert.equal(form.element.querySelectorAll(".vc-invalid").length, 0);
});

// ------------------------------------------------------------------ the shell, against the real API

const shell = async ({ role = "owner", confirm = () => true, content = files } = {}) => {
  const { window, document } = dom();
  const drafts = createMemoryDraftStore();
  const audit = createMemoryAuditLog();
  const user = { userId: role === "owner" ? "usr_owner" : "usr_editor", role };
  const api = createCmsApi({ config, source: createBundledSource(content), drafts, audit, identify: () => user, publisher: undefined });
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body) : undefined });
    const request = new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } });
    return api.handle(request);
  };
  const root = document.createElement("div");
  document.body.append(root);
  const boot = adminBoot(config, { id: user.userId, username: role, displayName: role === "owner" ? "Owner" : "Editor", role });
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  const app = startAdmin({ root, boot, fetch, confirm, window });
  await app.ready;
  return { window, document, root, drafts, calls, app, go, state: () => (root.querySelector(".vc-save-state").hidden ? "" : root.querySelector(".vc-state-long").textContent), button: (name) => [...root.querySelectorAll(".vc-actions button, .vc-actions a")].find((element) => element.textContent === name) };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("M7 shell: an area — “Across the whole site”, what it holds, the switch with what visitors see; Off on Pages while it is off", async () => {
  const h = await shell();
  await h.go("/admin/pages/notice");
  // No preview pane in these tests: the form has the switch; the area's head is in the inspector when the page is on the canvas.
  const box = h.root.querySelector('[data-path="enabled"] input[role="switch"]');
  const status = () => h.root.querySelector('[data-path="enabled"] .vc-switch-text span').textContent;
  assert.equal(h.root.querySelector('[data-path="enabled"] .vc-switch-text strong').textContent, "Show on website");
  assert.equal(status(), "On — visitors see this notice.");
  box.checked = false; box.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  assert.equal(status(), "Off after you publish — visitors still see it until then.");
  assert.equal(h.state(), "1 unsaved change");
  const off = await shell({ content: { ...files, "src/data/notice.json": JSON.stringify({ enabled: false, text: "Hi" }) } });
  await off.go("/admin/pages");
  assert.deepEqual([...off.root.querySelectorAll(".vc-pages-row")].map((row) => [row.querySelector("strong").textContent, row.querySelector(".vc-content-status").textContent]), [["Salon info", "Live"], ["Notice", "Off"], ["Search & sharing", "Live"]]);
  await off.go("/admin/pages/notice");
  const offBox = off.root.querySelector('[data-path="enabled"] input[role="switch"]');
  assert.equal(off.root.querySelector('[data-path="enabled"] .vc-switch-text span').textContent, "Off — visitors don’t see a notice.");
  offBox.checked = true; offBox.dispatchEvent(new off.window.Event("change", { bubbles: true }));
  assert.equal(off.root.querySelector('[data-path="enabled"] .vc-switch-text span').textContent, "On after you publish — visitors don’t see it yet.");
});

test("M7 shell: Search & sharing — Search results · Sharing image, the description's N / 160, the Google and share previews", async () => {
  const h = await shell();
  await h.go("/admin/pages/seo");
  assert.deepEqual([...h.root.querySelectorAll(".vc-seo-form .vc-section-title")].map((node) => node.textContent), ["Search results", "Sharing image"]);
  assert.deepEqual([...h.root.querySelectorAll(".vc-seo-card-help")].map((node) => node.textContent), ["Used on every page that does not set its own.", "Shown when someone shares a link on Facebook, Messenger or iMessage.", "Social apps can take a few days to show a new image."]);
  assert.equal(h.root.querySelector(".vc-preview-frame"), null, "no page on the canvas");
  const count = () => h.root.querySelector(".vc-seo-count");
  assert.equal(count().textContent, "38 / 160");
  assert.equal(h.root.querySelector(".vc-seo-google-site").textContent, "demo.example");
  assert.equal(h.root.querySelector(".vc-seo-google-title").textContent, "Demo Salon — an invented salon");
  assert.equal(h.root.querySelector(".vc-seo-share-site").textContent, "DEMO.EXAMPLE");
  assert.equal(h.root.querySelector(".vc-seo-share-image").getAttribute("src"), "/images/hero.svg");
  type(h.window, h.root.querySelector('[data-path="description"] textarea'), "x".repeat(161));
  assert.equal(count().textContent, "161 / 160");
  assert.equal(count().dataset.state, "long");
  assert.equal(h.root.querySelector(".vc-seo-google-description").textContent, "x".repeat(161), "not cut (Mr Spa)");
  type(h.window, h.root.querySelector('[data-path="title"] input'), "");
  assert.equal(h.root.querySelector(".vc-seo-google-title").textContent, "Page title");
});

test("M7 config: group / area / description / outline / toggle / layout seo", async () => {
  const { checkCmsConfig } = await import("../dist/index.js");
  const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
  const problems = (file) => checkCmsConfig({ ...base, files: [{ key: "a", label: "A", path: "src/data/a.json", format: "json", fields: { on: f.toggle({ label: "On" }), t: f.text({ label: "T" }), pic: f.image({ label: "P" }) }, ...file }] });
  const errors = (file) => problems(file).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(errors({ group: "Policies" }), []);
  assert.deepEqual(errors({ area: true, description: "Logo and menu", outline: "header", toggle: "on" }), []);
  assert.match(problems({ area: true }).warnings.map((problem) => problem.path).join(" "), /files\[0\]\.description/);
  assert.match(errors({ area: true, group: "X", description: "d" }).join("\n"), /group: an area is always under “Across the whole site”/);
  assert.match(errors({ toggle: "t" }).join("\n"), /toggle: "t" is not a toggle field of this file/);
  assert.deepEqual(errors({ layout: "seo", seo: { title: "t", description: "t", image: "pic" } }), []);
  assert.match(errors({ layout: "seo" }).join("\n"), /seo: required with layout "seo"/);
  assert.match(errors({ layout: "seo", seo: { title: "t", description: "pic" } }).join("\n"), /seo\.description: "pic" is not a text field of this file/);
  assert.match(errors({ seo: { title: "t", description: "t" } }).join("\n"), /seo: is only for layout "seo"/);
});

test("shell: Pages lists the files (U4: one row each, with its address and status); the rail marks the current place", async () => {
  const h = await shell();
  // M1 (Mr Spa): /admin opens the first page's editor.
  assert.equal(h.window.location.pathname, "/admin/pages/site");
  assert.equal(h.root.querySelector('.vc-nav-list a[aria-current="page"]').textContent, "Pages");
  await h.go("/admin/pages");
  assert.equal(h.state(), "", "no save state outside a record");
  // M7 (Mr Spa): Main pages | Across the whole site (the areas, with what they hold); Live / Off; "Find a page".
  const groups = [...h.root.querySelectorAll(".vc-pages-group")].map((group) => [group.querySelector("h2").textContent, [...group.querySelectorAll(".vc-pages-row-text")].map((row) => row.textContent)]);
  assert.deepEqual(groups, [
    ["Main pages", ["Salon info/"]],
    ["Across the whole siteChanges here show on every page", ["NoticeA short message at the top of every page", "Search & sharingHow the site looks in Google and when shared"]],
  ]);
  assert.deepEqual([...h.root.querySelectorAll(".vc-content-status")].map((pill) => pill.textContent), ["Live", "Live", "Live"]);
  assert.equal(h.root.querySelector(".vc-pages-count").textContent, "1 page · 2 site-wide areas");
  const find = h.root.querySelector('.vc-pages-search input');
  assert.equal(find.placeholder, "Find a page");
  type(h.window, find, "google");
  assert.deepEqual([...h.root.querySelectorAll(".vc-pages-group:not([hidden]) li:not([hidden]) strong")].map((node) => node.textContent), ["Search & sharing"], "matches what a row holds too; an empty group is hidden");
  type(h.window, find, "nothing like this");
  assert.equal(h.root.querySelector(".vc-pages-empty").hidden, false);
  assert.equal(h.root.querySelector(".vc-pages-empty").textContent, "No page matches that name.");
  assert.equal(h.root.querySelector("h1").textContent, "Pages");
  await h.go("/admin/catalog/services");
  assert.equal(h.root.querySelector('.vc-nav-list a[aria-current="page"]').textContent, "Services");
  assert.deepEqual([...h.root.querySelectorAll(".vc-table tbody tr")].map((row) => row.dataset.id), ["classic-manicure", "spa-pedicure", "nail-art"]);
  assert.equal(h.document.title, "Demo Salon CMS");
  // M1: the breadcrumb's parent is a button back to its screen.
  await h.go("/admin/catalog/services/spa-pedicure");
  const back = h.root.querySelector(".vc-crumb-parent");
  assert.equal(back.getAttribute("aria-label"), "Back to Services");
  back.click();
  await settle(); await h.app.idle();
  assert.equal(h.window.location.pathname, "/admin/catalog/services");
  // An address of before (#/files/site) opens the same screen at its new address.
  h.window.location.hash = "#/files/site";
  await settle(); await settle(); await h.app.idle();
  assert.equal(h.window.location.pathname, "/admin/pages/site");
  assert.equal(h.window.location.hash, "");
});

test("shell: edit → Save draft → PUT with expectedRevision / sourceVersion; the next save uses the new revision", async () => {
  const h = await shell();
  await h.go("/admin/pages/site");
  assert.equal(h.state(), "No changes");
  type(h.window, h.root.querySelector('[data-path="tagline"] input'), "First");
  assert.equal(h.state(), "1 unsaved change");
  h.button("Save draft").click();
  await settle(); await settle();
  for (let i = 0; i < 20 && h.state() !== "Draft saved · not live yet"; i += 1) await settle();
  const first = h.calls.find((call) => call.method === "PUT");
  assert.equal(first.url, "/api/cms/files/site");
  assert.equal(first.body.expectedRevision, 0);
  assert.match(first.body.sourceVersion, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(first.body.content, { ...site, tagline: "First" });
  assert.equal(h.state(), "Draft saved · not live yet");
  type(h.window, h.root.querySelector('[data-path="tagline"] input'), "Second");
  h.button("Save draft").click();
  for (let i = 0; i < 20 && h.state() !== "Draft saved · not live yet"; i += 1) await settle();
  assert.equal(h.calls.filter((call) => call.method === "PUT")[1].body.expectedRevision, 1);
  assert.equal((await h.drafts.get("usr_owner", "file:site")).content.tagline, "Second");
});

test("shell: problems are caught before saving; a save conflict (another tab) shows a reload message", async () => {
  const h = await shell();
  await h.go("/admin/pages/site");
  type(h.window, h.root.querySelector('[data-path="name"] input'), "");
  h.button("Save draft").click();
  await settle();
  assert.equal(h.calls.filter((call) => call.method === "PUT").length, 0, "not sent");
  assert.match(h.root.querySelector('[data-path="name"] .vc-error').textContent, /required/);
  assert.equal(h.state(), "1 validation error");
  assert.equal(h.root.querySelector(".vc-state-short").textContent, "Needs attention");

  type(h.window, h.root.querySelector('[data-path="name"] input'), "Demo");
  // Another tab saves first.
  await h.drafts.save({ userId: "usr_owner", resource: "file:site", content: site, sourceVersion: "sha256:" + "0".repeat(64), expectedRevision: 0 });
  h.button("Save draft").click();
  for (let i = 0; i < 20 && !/updated elsewhere/.test(h.state()); i += 1) await settle();
  // M1 (Mr Spa): the save state says so; Save is off; "Reload and keep my changes" reloads and puts my edit back.
  assert.equal(h.state(), "This page was updated elsewhere. Reload to get the latest version — your unsaved changes will be kept to re-apply.");
  assert.equal(h.button("Save draft").disabled, true);
  assert.equal(h.button("Save draft").dataset.tooltip, "Resolve conflicts or loading errors before saving.");
  const reload = h.root.querySelector('[data-action="reload-keep"]');
  assert.equal(reload.hidden, false);
  reload.click();
  for (let i = 0; i < 20 && h.state() !== "1 unsaved change"; i += 1) await settle();
  await h.app.idle();
  assert.equal(h.root.querySelector('[data-path="name"] input').value, "Demo", "my change is back");
  assert.equal(h.state(), "1 unsaved change");
  h.button("Save draft").click();
  for (let i = 0; i < 20 && h.state() !== "Draft saved · not live yet"; i += 1) await settle();
  const last = h.calls.filter((call) => call.method === "PUT").at(-1);
  assert.equal(last.body.expectedRevision, 1, "saved on top of the other tab's draft");
  assert.equal((await h.drafts.get("usr_owner", "file:site")).content.name, "Demo");
});

test("shell: a new record — id from the name, saved at its own address; an editor's locked price stays empty", async () => {
  const h = await shell({ role: "editor" });
  await h.go("/admin/catalog/services/new");
  const price = h.root.querySelector('[data-path="price"] input');
  assert.equal(price.disabled, true);
  type(h.window, h.root.querySelector('[data-path="name"] input'), "Gel Removal");
  assert.equal(h.root.querySelector('[data-path="id"] input').value, "gel-removal");
  type(h.window, h.root.querySelector('[data-path="id"] input'), "spa-pedicure");
  h.button("Save draft").click();
  await settle();
  assert.match(h.root.querySelector('[data-path="id"] .vc-error').textContent, /already uses this ID/);
  type(h.window, h.root.querySelector('[data-path="id"] input'), "gel-off");
  h.button("Save draft").click();
  for (let i = 0; i < 20 && h.state() !== "Draft saved · not live yet"; i += 1) await settle();
  await h.app.idle();
  const put = h.calls.find((call) => call.method === "PUT");
  assert.equal(put.url, "/api/cms/collections/services/items/gel-off");
  assert.deepEqual([put.body.expectedRevision, put.body.sourceVersion], [0, "new"]);
  assert.equal(h.window.location.pathname, "/admin/catalog/services/gel-off");
});

test("shell: leaving with unsaved changes asks; saying no keeps the page and the changes", async () => {
  const asked = [];
  let answer = false;
  const h = await shell({ confirm: (message) => { asked.push(message); return answer; } });
  await h.go("/admin/pages/site");
  type(h.window, h.root.querySelector('[data-path="tagline"] input'), "Unsaved");
  await h.go("/admin/catalog/team");
  assert.match(asked[0], /Leave without saving\?[\s\S]*1 unsaved change/);
  await settle();
  assert.ok(h.root.querySelector('[data-path="tagline"]'), "still on the form");
  answer = true;
  await h.go("/admin/catalog/team");
  assert.ok(h.root.querySelector(".vc-table"));
});

// ------------------------------------------------------------------ P8: review + publish + live, against the real API and a fake GitHub

const publishShell = async ({ storage = new Map(), maxWaitMs = 5_000, cfg = config, now, confirm = () => true, pollMs = 5 } = {}) => {
  const { window, document } = dom();
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files });
  const drafts = createMemoryDraftStore();
  const audit = createMemoryAuditLog();
  const publisher = createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url });
  let live = { ...files };
  const user = { userId: "usr_owner", role: "owner" };
  const build = () => createCmsApi({ config: cfg, source: createBundledSource(live), drafts, audit, publisher, identify: () => user });
  let api = build();
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const call = async (method, url, body) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const root = document.createElement("div");
  document.body.append(root);
  const store = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key), key: (index) => [...storage.keys()][index] ?? null, get length() { return storage.size; } };
  const asked = [];
  const app = startAdmin({ root, boot: adminBoot(cfg, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, confirm: (message, choice) => { asked.push(message); return confirm(message, choice); }, ...(pollMs === undefined ? {} : { pollMs }), maxWaitMs, storage: store, ...(now ? { now } : {}) });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  const until = async (test, what) => { for (let i = 0; i < 400; i += 1) { if (test()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };
  return {
    window, root, github, drafts, call, go, until, storage, asked, app,
    dialog: () => window.document.querySelector(".vc-dialog"),
    press: (text) => [...window.document.querySelectorAll(".vc-dialog button")].find((button) => button.textContent === text).click(),
    tooltip: () => root.querySelector(".vc-save-state").dataset.tooltip,
    state: () => (root.querySelector(".vc-save-state").hidden ? "" : root.querySelector(".vc-state-long").textContent),
    kind: () => root.querySelector(".vc-save-state").dataset.kind,
    badge: () => root.querySelector(".vc-badge"),
    redeploy: () => { live = { ...github.files() }; api = build(); },
    close: () => github.close(),
  };
};
const saveDraft = async (h, url, change) => {
  const current = await h.call("GET", url);
  return h.call("PUT", url, { content: change(current.content), expectedRevision: 0, sourceVersion: current.version });
};

test("U4 Drafts: one row per draft (what changes, when); Publish opens its review and publishes only it; ⋯ Discard; Recently published", async () => {
  const h = await publishShell();
  try {
    await h.go("/admin/drafts");
    assert.match(h.root.querySelector(".vc-empty-state").textContent, /No drafts/);
    await saveDraft(h, "/api/cms/files/site", (content) => ({ ...content, tagline: "Fresh tagline" }));
    await saveDraft(h, "/api/cms/collections/services/items/spa-pedicure", (content) => ({ ...content, price: "$40" }));
    await h.go("/admin/pages");
    await h.go("/admin/drafts");
    assert.equal(h.root.querySelector('.vc-nav-list a[aria-current="page"] .vc-rail-label').textContent, "Drafts");
    const row = (resource) => h.root.querySelector(`.vc-draft-row[data-resource="${resource}"]`);
    assert.match(row("file:site").textContent, /Salon info · Salon info1 change: TaglineSaved by you · /);
    assert.match(row("item:services:spa-pedicure").querySelector(".vc-row-what").textContent, /^1 change: Price$/);
    assert.ok([...h.root.querySelectorAll(".vc-actions a")].some((link) => link.textContent === "Review & publish all" && link.getAttribute("href") === "/admin/drafts/review"));
    assert.equal(h.root.querySelector('.vc-rail-item[data-rail="drafts"]').getAttribute("aria-label"), "Drafts, 2 saved");
    // Publish one row: its review dialog, then only it goes to the website.
    row("file:site").querySelector('[data-action="publish-draft"]').click();
    const dialog = () => h.window.document.querySelector(".vc-dialog");
    // M6 (Mr Spa): Review changes, then "Publish {name}" — This will publish to {host}.
    assert.equal(dialog().querySelector(".vc-dialog-title").textContent, "Review changes");
    assert.match(dialog().querySelector(".vc-review-summary").textContent, /Changed: Tagline/);
    h.press("Continue to publish");
    await h.until(() => h.asked.some((message) => message === "Publish Salon info\n\nThis will publish to demo.example."), "the confirm");
    await h.until(() => !dialog(), "the publish");
    await h.until(() => !row("file:site") && row("item:services:spa-pedicure"), "the screen again, with the other draft waiting");
    assert.match(JSON.parse(h.github.files()["src/data/site.json"]).tagline, /Fresh tagline/);
    assert.equal(h.badge().textContent, "1");
    assert.match(h.root.textContent, /Recently published.*Salon info.*Published by/s);
    // ⋯ → Discard draft (the test answers yes to the dialog).
    row("item:services:spa-pedicure").querySelector(".vc-more-button").click();
    [...row("item:services:spa-pedicure").querySelectorAll(".vc-menu-item")].find((item) => item.textContent === "Discard draft").click();
    await h.until(() => h.root.querySelector(".vc-empty-state"), "no drafts left");
    assert.ok(!(await h.drafts.get("usr_owner", "item:services:spa-pedicure")), "the draft is gone");
  } finally { h.close(); }
});

test("P8 shell: review shows what each draft changes; publishing the ticked one makes one commit; Live once the site serves it", async () => {
  const h = await publishShell();
  try {
    await saveDraft(h, "/api/cms/files/site", (content) => ({ ...content, tagline: "Fresh tagline" }));
    await saveDraft(h, "/api/cms/collections/services/items/spa-pedicure", (content) => ({ ...content, price: "$40" }));
    await h.go("/admin/drafts/review/file%3Asite");
    assert.equal(h.badge().textContent, "2");
    const cards = [...h.root.querySelectorAll(".vc-review-card")];
    assert.equal(cards.length, 2);
    const siteCard = cards.find((card) => card.dataset.resource === "file:site");
    const spaCard = cards.find((card) => card.dataset.resource === "item:services:spa-pedicure");
    assert.match(siteCard.querySelector(".vc-changes").textContent, /Tagline: A made-up salon for testing Vibe CMS\. → Fresh tagline/);
    assert.match(spaCard.textContent, /Price \(admin only\): \$35 → \$40/);
    assert.equal(siteCard.querySelector(".vc-pick").checked, true, "the draft I came from is ticked");
    assert.equal(spaCard.querySelector(".vc-pick").checked, false, "the others are not");
    const button = h.root.querySelector('[data-action="publish-now"]');
    assert.equal(button.textContent, "Publish 1 draft");

    const head = h.github.head();
    const before = h.github.files()["src/data/site.json"];
    button.click();
    await h.until(() => h.root.querySelector("h1")?.textContent === "Published", "the published screen");
    assert.equal(h.github.commitsSince(head).length, 1, "exactly one commit");
    const diff = lineDiff(before, h.github.files()["src/data/site.json"]);
    assert.deepEqual([diff.removed.length, diff.added.length], [1, 1], "one line changed");
    assert.equal(h.github.files()["src/data/services.json"], files["src/data/services.json"], "the unticked draft was not published");
    assert.ok(h.storage.get("vibe-cms:publishing"), "remembered across a reload");
    await h.until(() => h.badge().textContent === "1", "the draft count");
    // M1 (Mr Spa): the record's save state follows the publish — on its editor, also when opened later.
    await h.go("/admin/pages/site");
    assert.equal(h.kind(), "published");
    assert.equal(h.state(), "Publishing… this usually takes a few minutes");

    // Still the old content: no Live yet. The site rebuilds → Live (the record reloads quietly).
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(h.state(), "Publishing… this usually takes a few minutes");
    h.redeploy();
    await h.until(() => h.state() === "Live on demo.example", "Live");
    assert.equal(h.storage.get("vibe-cms:publishing"), undefined);
  } finally { await h.close(); }
});

test("P8 shell: someone published first → not published, the draft is named; a stale draft starts unticked", async () => {
  const h = await publishShell();
  try {
    await saveDraft(h, "/api/cms/files/site", (content) => ({ ...content, tagline: "Mine" }));
    h.github.pushOther({ "src/data/site.json": h.github.files()["src/data/site.json"].replace("Sampletown", "Othertown") });
    await h.go("/admin/drafts/review");
    h.root.querySelector('[data-action="publish-now"]').click();
    await h.until(() => !h.root.querySelector(".vc-banner").hidden, "the refusal");
    assert.match(h.root.querySelector(".vc-banner").textContent, /Not published: Salon info changed on the website after you started editing/);
    assert.ok(h.root.querySelector('[data-resource="file:site"]').classList.contains("vc-review-conflict"));
    // Once the site has rebuilt, the draft is known to be stale before trying.
    h.redeploy();
    await h.go("/admin/pages");
    await h.go("/admin/drafts/review");
    assert.equal(h.root.querySelector(".vc-pick").checked, false);
    assert.match(h.root.querySelector(".vc-review-stale").textContent, /cannot be published as it is/);
    assert.equal(h.root.querySelector('[data-action="publish-now"]').disabled, true);
  } finally { await h.close(); }
});

test("P8 shell: a publish remembered from before a reload is watched; after the wait it says it is still publishing", async () => {
  const storage = new Map([["vibe-cms:publishing", JSON.stringify({ expected: "sha256:" + "1".repeat(64), at: Date.now() - 60_000, userId: "usr_owner", labels: ["Salon info"], resources: ["file:site"] })]]);
  const h = await publishShell({ storage, maxWaitMs: 1_000 });
  try {
    // /admin opens Salon info, the record being published.
    assert.ok(["Publishing… this usually takes a few minutes", "Still publishing — check again in a few minutes"].includes(h.state()), "shown at once after the reload");
    await h.until(() => h.state() === "Still publishing — check again in a few minutes", "the late message");
    assert.equal(h.root.querySelector(".vc-state-short").textContent, "Still publishing");
    const check = h.root.querySelector('[data-action="check-again"]');
    assert.equal(check.hidden, false);
    assert.equal(check.dataset.tooltip, "Check again");
  } finally { await h.close(); }
});

test("P8 shell: nothing to publish; the editor's Review & publish needs a saved draft", async () => {
  const h = await publishShell();
  try {
    await h.go("/admin/drafts/review");
    assert.equal(h.root.querySelector("h1").textContent, "Nothing to publish");
    await h.go("/admin/pages/site");
    const review = h.root.querySelector('[data-action="publish"]');
    // M1 (Mr Spa): Publish is always there; off, with the reason.
    assert.equal(review.hidden, false);
    assert.equal(review.disabled, true);
    assert.equal(review.dataset.tooltip, "Save a draft before publishing.");
    type(h.window, h.root.querySelector('[data-path="tagline"] input'), "Changed");
    assert.equal(review.disabled, true, "unsaved changes: save first");
    assert.equal(review.dataset.tooltip, "Save a draft first");
    h.root.querySelector('[data-action="save"]').click();
    await h.until(() => !review.disabled, "the saved draft");
    assert.equal(review.dataset.tooltip, "Review changes before publishing.");
    // M6 (Mr Spa): Publish opens "Review changes" — grouped by section, the changed words marked; Cancel changes nothing.
    review.click();
    const dialog = () => h.window.document.querySelector(".vc-dialog");
    assert.ok(dialog(), "the dialog opens");
    assert.equal(dialog().querySelector(".vc-dialog-title").textContent, "Review changes");
    assert.equal(dialog().querySelector(".vc-dialog-text").textContent, "Review the changes to Salon info before publishing.");
    assert.equal(dialog().querySelector(".vc-review-group h3").textContent, "Homepage");
    assert.equal(dialog().querySelector(".vc-review-group li strong").textContent, "Changed: Tagline");
    assert.equal(dialog().querySelector(".vc-review-value.is-after .vc-review-mark").textContent, "Changed");
    assert.deepEqual([...dialog().querySelectorAll(".vc-dialog-actions button")].map((button) => button.textContent), ["Cancel", "Continue to publish"]);
    const choice = (text) => [...dialog().querySelectorAll("button")].find((button) => button.textContent === text);
    assert.equal(h.window.document.activeElement, choice("Cancel"), "the safe choice has focus");
    choice("Cancel").click();
    await settle();
    assert.equal(dialog(), null);
    assert.equal(h.window.location.pathname, "/admin/pages/site");
    // Escape closes it too.
    review.click();
    h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(dialog(), null);
  } finally { await h.close(); }
});

test("M6 shell: Publish = Review changes → Publish {name}; Publishing… then the chip counts the time; a failed build says so; Check again", async () => {
  let clock = Date.parse("2026-10-13T10:00:00Z");
  const cfg = { ...config, publish: { typicalMinutes: "5–10", buildCheck: "Workers Builds" } };
  const h = await publishShell({ cfg, now: () => clock, maxWaitMs: 20 * 60_000 });
  try {
    await saveDraft(h, "/api/cms/files/site", (content) => ({ ...content, tagline: "Fresh tagline" }));
    await h.go("/admin/pages/site");
    h.root.querySelector('[data-action="publish"]').click();
    h.press("Continue to publish");
    await h.until(() => h.state() === "Publishing… this usually takes 5–10 minutes", "publishing");
    assert.equal(h.asked.at(-1), "Publish Salon info\n\nThis will publish to demo.example.");
    assert.equal(h.root.querySelector(".vc-toast:not([hidden])"), null, "no toast (Mr Spa)");
    clock += 65_000;
    await h.until(() => h.tooltip() === "Publishing… this usually takes 5–10 minutes · 1m 5s", "the time in the tooltip");
    // The site's build fails: said in plain words, with the commit, instead of waiting.
    h.github.setCheckRuns(h.github.head(), [{ id: 1, name: "Workers Builds: demo", status: "completed", conclusion: "failure" }]);
    await h.until(() => /^The website build failed for this publish \(commit [0-9a-f]{8}\)\. The website still shows the previous version\.$/.test(h.state()), "the failed build");
    assert.equal(h.kind(), "problem");
    assert.equal(h.root.querySelector('[data-action="check-again"]').hidden, false);
    assert.ok(h.storage.get("vibe-cms:publishing"), "the receipt stays (checked again on reload)");
    // Fixed and deployed: Check again → Live.
    h.github.setCheckRuns(h.github.head(), [{ id: 2, name: "Workers Builds: demo", status: "completed", conclusion: "success" }]);
    h.redeploy();
    h.root.querySelector('[data-action="check-again"]').click();
    await h.until(() => h.state() === "No changes" || h.state() === "Live on demo.example", "live");
    assert.equal(h.storage.get("vibe-cms:publishing"), undefined, "the receipt goes once live");
  } finally { await h.close(); }
});

test("M6: live checks at 0, 10, 20, 30, 45 s, then every 60 s, for at most 20 minutes", async () => {
  const { LIVE_CHECK_STEPS } = await import("../dist/admin/app.js");
  assert.deepEqual(LIVE_CHECK_STEPS, [10_000, 20_000, 30_000, 45_000, 60_000]);
  const { buildState } = await import("../dist/index.js");
  const run = (id, status, conclusion) => ({ id, name: "Workers Builds: site", status, conclusion });
  assert.equal(buildState([], "Workers Builds"), "pending");
  assert.equal(buildState([run(1, "in_progress", null)], "workers builds"), "pending");
  assert.equal(buildState([run(1, "completed", "failure"), run(2, "completed", "success")], "Workers Builds"), "success", "the newest run");
  assert.equal(buildState([run(3, "completed", "timed_out")], "Workers Builds"), "failed");
  assert.equal(buildState([{ id: 9, name: "lint", status: "completed", conclusion: "failure" }], "Workers Builds"), "pending", "other checks do not count");
});

test("M6 shell: unsaved edits are kept in this browser (400 ms after typing, 24 h) and offered back — Restore changes / Discard them", async () => {
  let clock = Date.parse("2026-10-13T10:00:00Z");
  const storage = new Map();
  let answer = true;
  const h = await publishShell({ storage, now: () => clock, confirm: (message) => (message.startsWith("Restore unsaved changes?") ? answer : true) });
  try {
    await h.go("/admin/pages/site");
    type(h.window, h.root.querySelector('[data-path="tagline"] input'), "Typed, never saved");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const copy = JSON.parse(storage.get("vibe-cms:unsaved:v1:file:site"));
    assert.equal(copy.content.tagline, "Typed, never saved");
    assert.equal(copy.user, "owner");
    // The tab is closed and opened again 3 minutes later: the question, then the edits come back as unsaved changes.
    clock += 3 * 60_000;
    const again = await publishShell({ storage, now: () => clock, confirm: (message) => (message.startsWith("Restore unsaved changes?") ? answer : true) });
    try {
      // /admin opens the first page (Salon info) by itself.
      await again.until(() => again.state() === "1 unsaved change", "the restored edit");
      assert.equal(again.asked[0], "Restore unsaved changes?\n\nYou were editing this page 3 minutes ago and those changes were not saved (for example the page was refreshed or the tab was closed). Restore them? They come back as unsaved changes; press Save draft to keep them.");
      assert.equal(again.root.querySelector('[data-path="tagline"] input').value, "Typed, never saved");
      // Saved: the copy goes.
      again.root.querySelector('[data-action="save"]').click();
      await again.until(() => again.state() === "Draft saved · not live yet", "the save");
      assert.equal(storage.has("vibe-cms:unsaved:v1:file:site"), false);
    } finally { await again.close(); }
    // "Discard them" removes the copy; older than 24 hours it is not offered.
    storage.set("vibe-cms:unsaved:v1:file:site", JSON.stringify({ ...copy, savedAt: clock }));
    answer = false;
    const third = await publishShell({ storage, now: () => clock, confirm: (message) => (message.startsWith("Restore unsaved changes?") ? answer : true) });
    try {
      await third.until(() => !storage.has("vibe-cms:unsaved:v1:file:site"), "the copy removed");
      await third.until(() => third.state() === "No changes", "the page as saved");
      assert.equal(third.state(), "No changes", "nothing restored");
    } finally { await third.close(); }
  } finally { await h.close(); }
});

test("P8c shell: unsafe HTML typed in rich text is removed on save; the form shows what was saved and says where", async () => {
  const h = await shell();
  await h.go("/admin/pages/site");
  // Typed as HTML in the editor's source view ("Edit HTML").
  h.root.querySelector('[data-path="hero.text"] .vc-tool-source').click();
  const text = h.root.querySelector('[data-path="hero.text"] textarea');
  assert.equal(text.hidden, false);
  type(h.window, text, '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(2)">x</a>');
  h.button("Save draft").click();
  for (let i = 0; i < 40 && h.state() !== "Draft saved · not live yet"; i += 1) await settle();
  assert.equal(h.state(), "Draft saved · not live yet", "nothing left unsaved: the form holds what the server kept");
  assert.equal(text.value, "<p>Hello</p><a>x</a>");
  const banner = h.root.querySelector(".vc-banner");
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Saved, with some HTML removed for safety: Banner \(hero\.text\) — <script>, a\[href=javascript:\]/);
  assert.equal((await h.drafts.get("usr_owner", "file:site")).content.hero.text, "<p>Hello</p><a>x</a>");
});

// ------------------------------------------------------------------ P10: images

test("P10 / M5 shell: the image card opens the sheet (Current, uploads, the website's images, chips, search); Upload selects the new image; Use image · Undo · Remove", async () => {
  const { createMediaStore, createMemoryBucket, mediaSettings } = await import("../dist/index.js");
  const { tinyPng } = await import("./helpers/images.mjs");
  const { window, document } = dom();
  const media = createMediaStore({ bucket: createMemoryBucket(), settings: mediaSettings(config.media), now: () => new Date("2026-03-05T10:00:00Z") });
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user, media, siteImages: [{ src: "/images/hero.svg", bytes: 300 }, { src: "/images/team-sam.svg", bytes: 200 }, { src: "/images/spare.svg", bytes: 100 }] });
  const uploads = [];
  const fetch = async (url, init = {}) => {
    // happy-dom's Blob is not Node's: hand the API the bytes.
    const body = init.body && typeof init.body.arrayBuffer === "function" ? new Uint8Array(await init.body.arrayBuffer()) : init.body;
    if ((init.method ?? "GET") === "POST" && String(url).endsWith("/media")) uploads.push(init.headers);
    return api.handle(new Request(new URL(url, "http://localhost"), { ...init, body, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  };
  const root = document.createElement("div");
  document.body.append(root);
  const boot = adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }, { uploads: true });
  assert.deepEqual(boot.media, { uploads: true, base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 });
  const prepared = [];
  const prepare = async (file) => { prepared.push(file.name); return { blob: file, name: "chair.png", width: 4, height: 3 }; };
  const app = startAdmin({ root, boot, fetch, window, confirm: () => true, prepareImage: prepare });
  await app.ready;
  await app.go("/admin/catalog/team/alex"); await settle(); await app.idle();
  const field = root.querySelector('[data-path="photo"]');
  const shown = () => field.querySelector(".vc-image-thumb img")?.getAttribute("src") ?? "";
  const alt = field.querySelector(".vc-image-alt input");
  assert.equal(shown(), "/images/team-alex.svg");
  assert.equal(field.querySelector(".vc-image-name").textContent, "team-alex.svg");
  assert.deepEqual([...field.querySelectorAll(".vc-image-overlay button")].map((button) => button.textContent), ["Replace", "Adjust"]);
  assert.equal(field.querySelector(".vc-image-overlay-hint").textContent, "or drop an image here");
  const sheet = () => document.querySelector(".vc-sheet");
  const tiles = () => [...sheet().querySelectorAll(".vc-sheet-tile")].map((tile) => tile.dataset.src);
  const open = async () => { field.querySelector(".vc-image-replace").click(); for (let i = 0; i < 20 && !/^\d/.test(sheet()?.querySelector(".vc-sheet-count")?.textContent ?? ""); i += 1) await settle(); };
  await open();
  assert.equal(sheet().getAttribute("role"), "dialog");
  assert.equal(sheet().querySelector(".vc-sheet-title").textContent, "Choose image for Photo");
  assert.equal(sheet().querySelector(".vc-sheet-context").textContent, "Team › Alex Example");
  assert.equal(sheet().querySelector("input[type=search]").placeholder, "Search by file name, page or product");
  assert.deepEqual([...sheet().querySelectorAll(".vc-chip")].map((chip) => chip.textContent), ["All", "Pages", "Services", "Team", "Blog", "Not used", "Not published yet"]);
  // Current first, then the website's images — those the content uses first.
  assert.deepEqual(tiles(), ["/images/team-alex.svg", "/images/hero.svg", "/images/team-sam.svg", "/images/spare.svg"]);
  assert.equal(sheet().querySelector(".vc-sheet-badge").textContent, "Current");
  assert.equal(sheet().querySelector(".vc-sheet-count").textContent, "4 images");
  assert.equal(sheet().querySelector('[data-src="/images/team-sam.svg"] .vc-sheet-meta').textContent, "200 B · Sam Sample");
  // Chips: where the image is used; Not used.
  const chip = (label) => [...sheet().querySelectorAll(".vc-chip")].find((entry) => entry.textContent === label);
  chip("Pages").click();
  assert.deepEqual(tiles(), ["/images/hero.svg"]);
  assert.equal(sheet().querySelector(".vc-sheet-count").textContent, "1 image found");
  chip("Not used").click();
  assert.deepEqual(tiles(), ["/images/spare.svg"]);
  chip("All").click();
  // Search narrows the library (file name, address, where it is used).
  const search = sheet().querySelector("input[type=search]");
  type(window, search, "sam");
  assert.deepEqual(tiles(), ["/images/team-sam.svg"]);
  type(window, search, "nothing-like-this");
  assert.equal(sheet().querySelector(".vc-sheet-empty").textContent, 'No images match "nothing-like-this".');
  type(window, search, "");
  // Upload a file: prepared, sent as raw bytes with its name and size, then selected in the Library (not used yet).
  [...sheet().querySelectorAll(".vc-sheet-tab")].find((tab) => tab.textContent === "Upload").click();
  assert.equal(sheet().querySelector(".vc-sheet-search").hidden, true, "no search on the Upload tab");
  assert.match(sheet().querySelector(".vc-sheet-drop").textContent, /Drop an image hereorChoose fileJPEG, PNG, AVIF or WebP, up to 10 MB\./);
  const input = sheet().querySelector("input[type=file]");
  const file = new window.File([tinyPng(4, 3)], "Chair Photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change"));
  for (let i = 0; i < 40 && !/Uploaded/.test(sheet().querySelector(".vc-sheet-upload-status").textContent); i += 1) await settle();
  assert.equal(sheet().querySelector(".vc-sheet-upload-status").textContent, "Uploaded. It is selected in the Library.");
  assert.deepEqual(prepared, ["Chair Photo.png"]);
  assert.equal(uploads.length, 1);
  assert.deepEqual([uploads[0]["x-file-name"], uploads[0]["x-image-width"], uploads[0]["x-image-height"]], ["chair.png", "4", "3"]);
  const uploaded = tiles()[1];
  assert.match(uploaded, /^\/assets\/uploads\/2026\/03\/chair-[0-9a-f]{8}\.png$/);
  assert.equal(sheet().querySelector(`[data-src="${uploaded}"]`).getAttribute("aria-selected"), "true");
  assert.equal(sheet().querySelector(`[data-src="${uploaded}"] .vc-sheet-badge`).textContent, "Not published yet");
  assert.equal(document.activeElement, sheet().querySelector('[data-action="use-image"]'), "focus on Use image");
  sheet().querySelector('[data-action="use-image"]').click();
  assert.equal(sheet(), null);
  assert.equal(shown(), uploaded);
  assert.equal(alt.value, "Alex smiling", "alt kept");
  // A click selects (nothing changes yet), "Use image" uses it; the toast offers Undo.
  await open();
  assert.equal(tiles()[0], uploaded, "the current image first");
  const use = sheet().querySelector('[data-action="use-image"]');
  assert.equal(use.disabled, true, "nothing selected yet");
  assert.equal(sheet().querySelector(".vc-sheet-selection").textContent, "No image selected");
  sheet().querySelector('.vc-sheet-tile[data-src="/images/hero.svg"]').click();
  assert.equal(shown(), uploaded, "selecting is not choosing");
  assert.equal(sheet().querySelector(".vc-sheet-selection").textContent, "hero.svg · 300 B");
  use.click();
  assert.equal(sheet(), null);
  assert.equal(shown(), "/images/hero.svg");
  const toast = document.querySelector(".vc-toast");
  assert.match(toast.textContent, /^Image replacedUndo$/);
  toast.querySelector(".vc-toast-action").click();
  assert.equal(shown(), uploaded, "Undo puts the previous image back");
  // A double-click uses an image at once; Enter on the grid uses the selected one; Escape closes without a change.
  await open();
  sheet().querySelector('.vc-sheet-tile[data-src="/images/hero.svg"]').dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(sheet(), null);
  assert.equal(shown(), "/images/hero.svg");
  await open();
  const grid = sheet().querySelector(".vc-sheet-grid");
  grid.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  grid.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(shown(), "/images/spare.svg");
  await open();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(sheet(), null);
  assert.equal(shown(), "/images/spare.svg");
  // ⋯: Copy image link · Remove image; removed = the dashed "Choose image".
  field.querySelector(".vc-image-more").click();
  assert.deepEqual([...field.querySelectorAll(".vc-image-menu-item")].map((item) => item.textContent), ["Copy image link", "Remove image"]);
  [...field.querySelectorAll(".vc-image-menu-item")].find((item) => item.textContent === "Remove image").click();
  assert.equal(shown(), "");
  assert.equal(field.querySelector(".vc-image-empty").textContent, "Choose image");
});

test("U4 Media: the library (uploads first, then the website's images), filters, the chosen image's details, Upload images", async () => {
  const { createMediaStore, createMemoryBucket, mediaSettings } = await import("../dist/index.js");
  const { tinyPng } = await import("./helpers/images.mjs");
  const { window, document } = dom();
  const media = createMediaStore({ bucket: createMemoryBucket(), settings: mediaSettings(config.media), now: () => new Date("2026-03-05T10:00:00Z") });
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user, media, siteImages: [{ src: "/images/hero.svg", bytes: 3000 }, { src: "/images/team-sam.svg", bytes: 2000 }] });
  const fetch = async (url, init = {}) => {
    const body = init.body && typeof init.body.arrayBuffer === "function" ? new Uint8Array(await init.body.arrayBuffer()) : init.body;
    return api.handle(new Request(new URL(url, "http://localhost"), { ...init, body, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  };
  const root = document.createElement("div");
  document.body.append(root);
  const boot = adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }, { uploads: true });
  const app = startAdmin({ root, boot, fetch, window, confirm: () => true, prepareImage: async (file) => ({ blob: file, name: "chair.png", width: 4, height: 3 }) });
  await app.ready;
  await app.go("/admin/media"); await settle(); await app.idle();
  const tiles = () => [...root.querySelectorAll(".vc-media-grid .vc-tile")].map((tile) => tile.dataset.src);
  assert.deepEqual(tiles(), ["/images/hero.svg", "/images/team-sam.svg"]);
  assert.equal(root.querySelector(".vc-count").textContent, "2 images");
  assert.match(root.querySelector(".vc-media-detail").textContent, /Choose an image to see its details/);
  root.querySelector('.vc-tile[data-src="/images/team-sam.svg"]').click();
  assert.match(root.querySelector(".vc-media-detail").textContent, /team-sam\.svgWebsite imageCopy linkDimensions—FormatSVGFile size2 KB/);
  // Upload from the top bar: the new image comes first and is chosen.
  const input = root.querySelector("#vc-media-file");
  Object.defineProperty(input, "files", { value: [new window.File([tinyPng(4, 3)], "Chair.png", { type: "image/png" })], configurable: true });
  input.dispatchEvent(new window.Event("change"));
  for (let i = 0; i < 40 && tiles().length < 3; i += 1) await settle();
  assert.match(tiles()[0], /^\/assets\/uploads\/2026\/03\/chair-[0-9a-f]{8}\.png$/);
  assert.match(root.querySelector(".vc-media-detail").textContent, /Uploaded image/);
  // Filters: only uploads, only the website's own.
  [...root.querySelectorAll(".vc-filter")].find((chip) => chip.textContent === "Uploaded").click();
  assert.equal(tiles().length, 1);
  [...root.querySelectorAll(".vc-filter")].find((chip) => chip.textContent === "Website").click();
  assert.deepEqual(tiles(), ["/images/hero.svg", "/images/team-sam.svg"]);
});

test("P10 shell: without the bucket the sheet says uploading is not set up; an editor sees no buttons on a locked image; prepare refuses GIF / SVG", async () => {
  const { window, document } = dom();
  const { prepareImage, openImagePicker, createClient } = await import("../dist/admin/index.js");
  const api = createClient(async () => new Response(JSON.stringify({ uploads: [], site: [] }), { headers: { "content-type": "application/json" } }));
  openImagePicker({ doc: document, api, media: { uploads: false, base: "/assets/uploads", maxBytes: 1000 }, prepare: async () => assert.fail("no upload"), upload: async () => assert.fail("no upload"), onPick: () => {} });
  assert.equal(document.querySelector(".vc-sheet input[type=file]"), null);
  assert.match(document.querySelector(".vc-sheet").textContent, /Uploading is not set up/);
  document.querySelector('.vc-sheet [aria-label="Close"]').click();
  assert.equal(document.querySelector(".vc-sheet"), null);
  // Locked image fields (Mr Spa): the picture cannot be replaced; ⋯ keeps only Copy image link.
  const locked = createForm({ doc: document, fields: { logo: f.image({ label: "Logo", locked: "admin" }) }, value: { logo: "/a.png" }, role: "editor", pickImage: () => assert.fail("not for a locked field") });
  assert.deepEqual([...locked.element.querySelectorAll("button:not([disabled])")].map((button) => button.getAttribute("aria-label") ?? button.textContent), ["More actions for Logo", "Copy image link"]);
  assert.equal(locked.element.querySelector(".vc-image-replace"), null);
  const prepare = prepareImage(window);
  await assert.rejects(prepare(new window.File(["GIF89a"], "a.gif", { type: "image/gif" })), /^Error: This file type is not supported\. Choose a JPEG, PNG, AVIF or WebP image\.$/);
  await assert.rejects(prepare(new window.File(["<svg/>"], "a.svg", { type: "image/svg+xml" })), /This file type is not supported/);
  // A file the browser cannot decode is refused before uploading; with no createImageBitmap at all, it goes as it is
  // (the server still checks the bytes).
  const png = new window.File(["x"], "a.png", { type: "image/png" });
  await assert.rejects(prepare(png), /can't be read as an image/);
  assert.equal((await prepareImage({ document })(png)).blob, png);
});

// ------------------------------------------------------------------ P9: preview pane

test("P9 / M1 shell: the record's page is on the canvas (cmsPreview=1); Laptop / Tablet / Mobile in the top bar, remembered", async () => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const document = window.document;
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const root = document.createElement("div");
  document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, confirm: () => true, storage });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  await go("/admin/pages/site");
  const pane = () => root.querySelector(".vc-preview");
  assert.equal(pane().hidden, false);
  assert.equal(root.querySelector('[data-action="preview"]'), null, "no Preview toggle (Mr Spa)");
  assert.equal(pane().querySelector("iframe").getAttribute("src"), "/?cmsPreview=1");
  assert.equal(pane().querySelector("iframe").getAttribute("sandbox"), "allow-same-origin allow-scripts", "the page cannot navigate the admin, open pop-ups or send forms");
  const devices = () => [...root.querySelectorAll(".vc-top-center .vc-devices button")];
  assert.deepEqual(devices().map((button) => [button.dataset.tooltip, button.getAttribute("aria-pressed")]), [["Laptop", "true"], ["Tablet", "false"], ["Mobile", "false"]]);
  assert.equal(pane().querySelector("iframe").style.width, "1280px");
  devices()[2].click();
  assert.equal(store.get("vibe-cms:preview-device"), "mobile");
  assert.deepEqual([pane().querySelector("iframe").style.width, pane().querySelector("iframe").style.height], ["390px", "844px"]);
  // A record that is live has View live (its page, a new tab).
  await go("/admin/catalog/services/spa-pedicure");
  assert.equal(root.querySelector('[data-action="view-live"]').getAttribute("href"), "/services/");
  assert.equal(pane().dataset.device, "mobile", "the device is remembered");
  // A record's own page, from its fields.
  await go("/admin/catalog/posts/welcome");
  assert.equal(pane().querySelector("iframe").getAttribute("src"), "/blog/welcome/?cmsPreview=1");
  // A new record whose page is its own address: nothing to show until it is published.
  await go("/admin/catalog/posts/new");
  assert.equal(pane().querySelector(".vc-preview-stage").hidden, true);
  assert.match(pane().querySelector(".vc-preview-note").textContent, /A new post gets its own page once it is published/);
  assert.equal(root.querySelector('[data-action="view-live"]'), null, "nothing live yet");
  // A new record of a collection listed on one page: the list page (the record is shown there as it is typed).
  await go("/admin/catalog/services/new");
  assert.equal(pane().querySelector("iframe").getAttribute("src"), "/services/?cmsPreview=1");
});
