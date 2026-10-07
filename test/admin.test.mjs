// P7: the admin form and shell on a fake DOM (happy-dom) — every field type of the demo site renders, edits and keeps
// what it does not touch; locks for editors; error placement; and the shell saving drafts through the REAL CMS API
// (createCmsApi with in-memory stores) behind a fake fetch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, f, loadCmsConfig } from "../dist/index.js";
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

const dom = () => { const window = new Window({ url: "http://localhost/admin" }); return { window, document: window.document }; };
const type = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const choose = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const toggle = (window, element, checked) => { element.checked = checked; element.dispatchEvent(new window.Event("change", { bubbles: true })); };
const references = () => ({ services: { label: "Services", itemLabel: "Service", items: services.map((item) => ({ id: item.id, label: item.name })) } });
const siteForm = (document, role = "owner", onChange) => createForm({ doc: document, fields: config.files[0].fields, sections: config.files[0].sections, value: site, role, references: references(), onChange });
const at = (form, path) => form.element.querySelector(`[data-path=${JSON.stringify(path)}]`);
const control = (form, path) => at(form, path).querySelector("input, textarea, select");
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
  assert.equal(holdsLockedValue(f.object({ label: "S", fields: { price: f.text({ label: "Price", locked: "owner" }), name: f.text({ label: "N" }) } }), { name: "x", price: "" }), false);
  assert.equal(holdsLockedValue(f.object({ label: "S", fields: { price: f.text({ label: "Price", locked: "owner" }) } }), { price: "$5" }), true);
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
  const expected = { name: "INPUT", phone: "INPUT", email: "INPUT", "address.street": "INPUT", tagline: "INPUT", "hero.title": "INPUT", "hero.text": "TEXTAREA", "seo.title": "INPUT", "seo.description": "TEXTAREA" };
  for (const [path, tag] of Object.entries(expected)) assert.equal(control(form, path)?.tagName, tag, path);
  assert.equal(at(form, "hours").querySelectorAll(".vc-hours-row").length, 3);
  assert.equal(at(form, "hero.image").querySelectorAll("input").length, 2, "image: address + alt");
  assert.deepEqual([...at(form, "highlights").querySelectorAll(".vc-chosen-label")].map((node) => node.textContent), ["Spa Pedicure", "Classic Manicure"]);
  assert.equal(at(form, "footerLinks[0].links[1].href").querySelector("input").value, "/team/");
  assert.equal(at(form, "name").querySelector(".vc-counter").textContent, "10 / 60");
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
  type(window, control(form, "hero.text"), "<p>Hi</p>");
  const [src, alt] = at(form, "hero.image").querySelectorAll("input");
  type(window, src, "/images/new.svg");
  type(window, alt, "");
  const value = form.value();
  assert.deepEqual(value, { ...site, tagline: "New tagline", seo: { ...site.seo, title: "Search title" }, hero: { ...site.hero, text: "<p>Hi</p>", image: { src: "/images/new.svg", alt: "" } } });
  assert.deepEqual(Object.keys(value), Object.keys(site));
  assert.ok(changes.includes("tagline") && changes.includes("seo.title"));
  type(window, control(form, "name"), "x".repeat(61));
  assert.ok(at(form, "name").querySelector(".vc-counter").classList.contains("vc-over"), "over maxLength shows");

  // An image written as a path stays a path; adding alt makes it { src, alt }.
  const teamForm = createForm({ doc: document, fields: config.collections[1].fields, value: team[1], role: "owner", references: references() });
  const [samSrc, samAlt] = at(teamForm, "photo").querySelectorAll("input");
  type(window, samSrc, "/images/other.svg");
  assert.equal(teamForm.value().photo, "/images/other.svg");
  type(window, samAlt, "Sam");
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
  type(window, control(form, "footerLinks[0].links[2].href"), "/blog/");
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

  const fields = { menu: f.list(f.object({ label: "Row", fields: { name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "owner" }) } }), { label: "Menu", ordered: true, itemLabel: "Row" }) };
  const value = { menu: [{ name: "Priced", price: "$5" }, { name: "Not priced yet" }] };
  const asEditor = createForm({ doc: document, fields, value, role: "editor" });
  assert.equal(at(asEditor, "menu").querySelector('[aria-label^="Only the owner can delete Row 1"]').disabled, true);
  assert.equal(at(asEditor, "menu").querySelector('[aria-label="Delete Row 2"]').disabled, false);
  assert.equal(at(asEditor, "menu").querySelector('[aria-label="Move Row 1 down"]').disabled, false, "re-ordering is allowed");
  assert.equal(control(asEditor, "menu[0].price").disabled, true);
  const asOwner = createForm({ doc: document, fields, value, role: "owner" });
  assert.equal(at(asOwner, "menu").querySelector('[aria-label="Delete Row 1"]').disabled, false);
  assert.match(at(asOwner, "menu[0].price").textContent, /Editors see this but only an owner can change it/);
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

const shell = async ({ role = "owner", confirm = () => true } = {}) => {
  const { window, document } = dom();
  const drafts = createMemoryDraftStore();
  const audit = createMemoryAuditLog();
  const user = { userId: role === "owner" ? "usr_owner" : "usr_editor", role };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts, audit, identify: () => user, publisher: undefined });
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body) : undefined });
    const request = new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } });
    return api.handle(request);
  };
  const root = document.createElement("div");
  document.body.append(root);
  const boot = adminBoot(config, { id: user.userId, username: role, displayName: role === "owner" ? "Owner" : "Editor", role });
  const go = async (hash) => { window.location.hash = hash; await settle(); await app.idle(); };
  const app = startAdmin({ root, boot, fetch, confirm, window });
  await app.ready;
  return { window, document, root, drafts, calls, app, go, state: () => root.querySelector(".vc-save-state").textContent, button: (name) => [...root.querySelectorAll(".vc-actions button, .vc-actions a")].find((element) => element.textContent === name) };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shell: overview lists files and collections from the API; navigation marks the current page", async () => {
  const h = await shell();
  assert.deepEqual([...h.root.querySelectorAll(".vc-card-title")].map((node) => node.textContent), ["Salon info", "Services", "Team", "Blog"]);
  assert.match(h.root.querySelector(".vc-cards").textContent, /3 services/);
  await h.go("#/collections/services");
  assert.equal(h.root.querySelector('.vc-nav-list a[aria-current="page"]').textContent, "Services");
  assert.deepEqual([...h.root.querySelectorAll(".vc-table tbody tr")].map((row) => row.dataset.id), ["classic-manicure", "spa-pedicure", "nail-art"]);
  assert.equal(h.document.title, "Services · Demo Salon · Vibe CMS");
});

test("shell: edit → Save draft → PUT with expectedRevision / sourceVersion; the next save uses the new revision", async () => {
  const h = await shell();
  await h.go("#/files/site");
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
  await h.go("#/files/site");
  type(h.window, h.root.querySelector('[data-path="name"] input'), "");
  h.button("Save draft").click();
  await settle();
  assert.equal(h.calls.filter((call) => call.method === "PUT").length, 0, "not sent");
  assert.match(h.root.querySelector('[data-path="name"] .vc-error').textContent, /required/);
  assert.equal(h.state(), "Needs attention");

  type(h.window, h.root.querySelector('[data-path="name"] input'), "Demo");
  // Another tab saves first.
  await h.drafts.save({ userId: "usr_owner", resource: "file:site", content: site, sourceVersion: "sha256:" + "0".repeat(64), expectedRevision: 0 });
  h.button("Save draft").click();
  for (let i = 0; i < 20 && !h.root.querySelector(".vc-banner:not([hidden])"); i += 1) await settle();
  assert.match(h.root.querySelector(".vc-banner").textContent, /saved in another tab or window/);
  assert.equal(h.state(), "Not saved");
});

test("shell: a new record — id from the name, saved at its own address; an editor's locked price stays empty", async () => {
  const h = await shell({ role: "editor" });
  await h.go("#/collections/services/new");
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
  const put = h.calls.find((call) => call.method === "PUT");
  assert.equal(put.url, "/api/cms/collections/services/items/gel-off");
  assert.deepEqual([put.body.expectedRevision, put.body.sourceVersion], [0, "new"]);
  assert.equal(h.window.location.hash, "#/collections/services/items/gel-off");
});

test("shell: leaving with unsaved changes asks; saying no keeps the page and the changes", async () => {
  const asked = [];
  let answer = false;
  const h = await shell({ confirm: (message) => { asked.push(message); return answer; } });
  await h.go("#/files/site");
  type(h.window, h.root.querySelector('[data-path="tagline"] input'), "Unsaved");
  await h.go("#/collections/team");
  assert.match(asked[0], /Leave without saving\?[\s\S]*1 unsaved change/);
  await settle();
  assert.ok(h.root.querySelector('[data-path="tagline"]'), "still on the form");
  answer = true;
  await h.go("#/collections/team");
  assert.ok(h.root.querySelector(".vc-table"));
});
