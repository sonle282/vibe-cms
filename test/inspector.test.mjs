// M3: the page inspector of the Mr Spa CMS (two levels), its lists and its validation summary — the pure functions,
// the inspector in the real editor on a fake DOM (happy-dom), against the REAL CMS API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, f, loadCmsConfig } from "../dist/index.js";
import { adminBoot, countItems, createForm, inspectorSections, orderSectionsByPage, sectionSummary, startAdmin } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files; let site;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
  site = JSON.parse(files["src/data/site.json"]);
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); };

test("sections: the config's, then Other; one for the whole page when none; in page order (the first field shown)", () => {
  const fields = { a: f.text({ label: "A" }), b: f.text({ label: "B" }), c: f.text({ label: "C" }), "seo.title": f.text({ label: "T" }) };
  const sections = inspectorSections(fields, [{ key: "one", label: "One", fields: ["a"] }, { key: "two", label: "Two", fields: ["b", "seo.title"] }], "Page");
  assert.deepEqual(sections.map((section) => [section.key, section.fields]), [["one", ["a"]], ["two", ["b", "seo.title"]], ["_other", ["c"]]]);
  assert.deepEqual(inspectorSections(fields, undefined, "Salon info").map((section) => [section.key, section.label]), [["_all", "Salon info"]]);
  assert.deepEqual(orderSectionsByPage(sections, ["seo.title", "x", "a"]).map((section) => section.key), ["two", "one", "_other"], "not on the page: after, in config order");
});

test("section summary (Mr Spa): its title / heading, else its first filled text, else its lists ('2 banners'), else its fields", () => {
  const fields = { title: f.text({ label: "Title" }), note: f.text({ label: "Note" }), banners: f.list(f.object({ label: "Banner", fields: { t: f.text({ label: "T" }) } }), { label: "Banners" }), photo: f.image({ label: "Photo" }) };
  const section = (keys) => ({ key: "s", label: "S", fields: keys });
  assert.equal(sectionSummary(section(["note", "title"]), fields, { note: "first", title: "<b>Our</b>  Showroom" }), "Our Showroom");
  assert.equal(sectionSummary(section(["note", "title"]), fields, { note: "first" }), "first");
  assert.equal(sectionSummary(section(["banners", "photo"]), fields, { banners: [{}, {}] }), "2 banners");
  assert.equal(sectionSummary(section(["photo"]), fields, {}), "1 editable field");
  assert.equal(countItems(1, "Category card"), "1 category card");
  assert.equal(countItems(3, "Box"), "3 boxes");
});

test("lists (Mr Spa): 'Banner 1' over its words or 'Untitled', ↑ ↓ ×, 'N of M allowed.', 'Add banner', deleting asks first", async () => {
  const { window } = new Window();
  const asked = [];
  let answer = false;
  const fields = { banners: f.list(f.object({ label: "Banner", fields: { title: f.text({ label: "Title" }) } }), { label: "Banners", ordered: true, max: 3 }) };
  const form = createForm({ doc: window.document, fields, value: { banners: [{ title: "Spring" }, {}] }, role: "owner", confirm: (message, options) => { asked.push([message, options]); return answer; } });
  const list = form.element.querySelector('[data-path="banners"]');
  assert.deepEqual([...list.querySelectorAll(".vc-item-head")].map((head) => [head.querySelector(".vc-item-title").textContent, head.querySelector(".vc-item-summary").textContent]), [["Banner 1", "Spring"], ["Banner 2", "Untitled"]]);
  assert.deepEqual([...list.querySelectorAll(".vc-item")][0].querySelectorAll(".vc-glyph").length, 3);
  assert.deepEqual([...[...list.querySelectorAll(".vc-item")][1].querySelectorAll(".vc-glyph")].map((button) => button.textContent), ["↑", "↓", "×"]);
  assert.equal(list.querySelector(".vc-list-count").textContent, "2 of 3 allowed.");
  assert.equal(list.querySelector(".vc-add").textContent, "Add banner");
  const remove = () => [...list.querySelectorAll(".vc-item")][1].querySelector(".vc-remove").click();
  remove();
  await settle();
  assert.deepEqual(asked[0], ["Delete banner\n\nDelete banner 2?", { confirm: "Delete", danger: true }]);
  assert.equal(form.value().banners.length, 2, "no: nothing changes");
  answer = true;
  remove();
  await settle();
  assert.equal(form.value().banners.length, 1);
  assert.equal(list.querySelector(".vc-list-count").textContent, "1 of 3 allowed.");
});

test("validation summary (Mr Spa): 'N validation errors', a button per problem that goes to its field", () => {
  const { window } = new Window();
  const revealed = [];
  const form = createForm({ doc: window.document, fields: config.files[0].fields, sections: config.files[0].sections, value: site, role: "owner", reveal: (path) => revealed.push(path) });
  form.showErrors([{ path: "name", message: "Fill this in." }, { path: "footerLinks[0].links[1].href", message: "Use a full address." }]);
  const summary = form.element.querySelector(".vc-form-errors");
  assert.equal(summary.querySelector("strong").textContent, "2 validation errors");
  const buttons = [...summary.querySelectorAll("button")];
  assert.deepEqual(buttons.map((button) => button.textContent), ["Salon name: Fill this in.", "Address: Use a full address."]);
  buttons[1].click();
  assert.deepEqual(revealed, ["footerLinks[0].links[1].href"]);
  form.showErrors([{ path: "name", message: "x" }]);
  assert.equal(summary.querySelector("strong").textContent, "1 validation error");
});

const shell = async ({ session = new Map() } = {}) => {
  const window = new Window({ url: "http://localhost/admin", width: 1440, height: 900, settings: { disableIframePageLoading: true } });
  const store = (map) => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) });
  Object.defineProperty(window, "sessionStorage", { value: store(session), configurable: true });
  const local = new Map();
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, confirm: () => true, storage: store(local) });
  await app.ready;
  const q = (selector) => root.querySelector(selector);
  const head = () => [q(".vc-inspector-crumb").textContent, q(".vc-inspector-title").textContent, q(".vc-inspector-back").hidden];
  const rows = () => [...root.querySelectorAll(".vc-section-row")].map((row) => [row.querySelector("strong").textContent, row.querySelector(".vc-section-summary").textContent, Boolean(row.querySelector(".vc-section-dot"))]);
  const visible = () => [...root.querySelectorAll(".vc-form > [data-section]")].filter((box) => !box.hidden).map((box) => box.dataset.section);
  return { window, root, app, q, head, rows, visible, local, session, go: async (path) => { await app.go(path); await settle(); await app.idle(); } };
};

test("inspector level 1: crumb Pages, the page's title, the hideable tip, one row per section (summary, unsaved dot, ›)", async () => {
  const h = await shell();
  assert.equal(h.window.location.pathname, "/admin/pages/site");
  assert.deepEqual(h.head(), ["Pages", "Salon info", true]);
  assert.equal(h.q(".vc-tip-text").textContent, "Click any part of the page, or pick a section below.");
  assert.deepEqual(h.rows(), [["Contact & hours", site.phone, false], ["Homepage", site.hero.title, false], ["Menu", "5 links", false], ["Footer & search", site.seo.title, false]]);
  assert.deepEqual(h.visible(), [], "no section's fields at level 1");
  assert.ok([...h.root.querySelectorAll(".vc-section-chevron")].every((chevron) => chevron.textContent === "›"));
  // Hiding the tip is remembered.
  h.q(".vc-tip-hide").click();
  assert.equal(h.q(".vc-tip").hidden, true);
  assert.equal(h.local.get("vibe-cms:tip-hidden:page-sections"), "1");
});

test("inspector level 2: ← Close section, crumb = the page, title = the section; Esc goes back to its row; remembered", async () => {
  const h = await shell();
  h.root.querySelector('[data-section-key="home"]').click();
  assert.deepEqual(h.head(), ["Salon info", "Homepage", false]);
  assert.equal(h.q(".vc-inspector-back").getAttribute("aria-label"), "Close section");
  assert.deepEqual(h.visible(), ["home"]);
  assert.equal(h.session.get("vibe-cms:section:file:site"), "home");
  // An edit marks the section on level 1.
  const tagline = h.q('[data-path="tagline"] input');
  type(h.window, tagline, "Changed tagline");
  // Esc while typing stays; elsewhere it goes back.
  tagline.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(h.visible(), ["home"]);
  h.q(".vc-inspector-back").focus();
  h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(h.visible(), []);
  assert.equal(h.window.document.activeElement?.dataset.sectionKey, "home", "focus on the row just left");
  assert.deepEqual(h.rows().find(([name]) => name === "Homepage"), ["Homepage", site.hero.title, true]);
  assert.equal(h.session.get("vibe-cms:section:file:site"), undefined);
  // The section opened stays open when the editor comes back (this session).
  h.root.querySelector('[data-section-key="footer"]').click();
  await h.go("/admin/pages");
  await h.go("/admin/pages/site");
  assert.deepEqual(h.visible(), ["footer"]);
});

test("inspector: a validation problem opens its section; a record without sections opens at level 2 without ←", async () => {
  const h = await shell();
  type(h.window, (h.root.querySelector('[data-section-key="home"]').click(), h.q('[data-path="name"] input')), "");
  h.q(".vc-inspector-back").click();
  [...h.root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  await settle();
  assert.equal(h.q(".vc-form-errors strong").textContent, "1 validation error");
  h.q(".vc-form-errors button").click();
  assert.deepEqual(h.visible(), ["home"], "the summary's button opens the field's section");
  assert.equal(h.window.document.activeElement, h.q('[data-path="name"] input'));
  await h.go("/admin/catalog/services/spa-pedicure");
  assert.deepEqual(h.head(), ["Services", "Spa Pedicure", true]);
  assert.equal(h.q(".vc-sections").closest(".vc-inspector-sections").hidden, true);
});

test("M3b: a section that is one object lists that object's fields flat; one declared section = crumb the page, title the section", async () => {
  const { window } = new Window();
  const fields = { hero: f.object({ label: "Top of the homepage", fields: { title: f.text({ label: "Heading" }), image: f.image({ label: "Photo" }) } }) };
  const form = createForm({ doc: window.document, fields, sections: [{ key: "hero", label: "Hero", fields: ["hero"] }], value: { hero: { title: "Hi" } }, role: "owner" });
  assert.ok(form.element.querySelector('[data-path="hero"]').classList.contains("vc-sole"));
  const plain = createForm({ doc: window.document, fields: { ...fields, note: f.text({ label: "Note" }) }, value: {}, role: "owner" });
  assert.equal(plain.element.querySelector(".vc-sole"), null, "with other fields beside it, the object stays a group");
  const { createInspector } = await import("../dist/admin/index.js");
  const inspector = createInspector({ doc: window.document, form, fields, sections: inspectorSections(fields, [{ key: "hero", label: "Hero", fields: ["hero"] }], "Home"), crumb: "Pages", title: "Home", value: () => form.value(), saved: () => ({}), resource: "file:home" });
  assert.deepEqual([inspector.element.querySelector(".vc-inspector-crumb").textContent, inspector.element.querySelector(".vc-inspector-title").textContent, inspector.element.querySelector(".vc-inspector-back").hidden], ["Home", "Hero", true]);
  inspector.destroy();
});

test("M3c: sections may point into a field — an object's field, an item of a fixed list (one list, a section per item)", async () => {
  const { checkCmsConfig } = await import("../dist/index.js");
  const fields = {
    intro: f.text({ label: "Intro" }),
    hero: f.object({ label: "Hero", fields: { title: f.text({ label: "Heading" }), photo: f.image({ label: "Photo" }) } }),
    services: f.list(f.object({ label: "Service", fields: { name: f.text({ label: "Name" }), card: f.object({ label: "Card", flat: true, fields: { blurb: f.text({ label: "Card text" }) } }), highlights: f.list(f.text({ label: "Highlight" }), { label: "Highlights", itemLabel: "Highlight" }) } }), { label: "Services", fixed: true }),
    loose: f.list(f.text({ label: "Item" }), { label: "Loose" }),
  };
  const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
  const check = (sections) => checkCmsConfig({ ...base, files: [{ key: "home", label: "Home", path: "src/data/home.json", format: "json", fields, sections }] });
  const good = check([
    { key: "top", label: "Top", fields: ["intro", "hero.title"] },
    { key: "s0", label: "Head Spa · Card & facts", fields: ["services[0].name", "services[0].card"] },
    { key: "s0h", label: "Head Spa · Highlights", fields: ["services[0].highlights"] },
    { key: "rest", label: "Rest", fields: ["loose"] },
  ]);
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.warnings, [], "hero / services shown in parts are placed");
  const messages = (sections) => check(sections).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(messages([{ key: "a", label: "A", fields: ["loose[0]"] }]), ['files[0].sections[0].fields[0]: "loose[0]": a section can point into a list only when the list is fixed (its items stay in place)']);
  assert.deepEqual(messages([{ key: "a", label: "A", fields: ["hero.nope"] }]), ['files[0].sections[0].fields[0]: "hero.nope": "nope" is not a field there']);
  assert.deepEqual(messages([{ key: "a", label: "A", fields: ["hero"] }, { key: "b", label: "B", fields: ["hero.title"] }]), ['files[0].sections[1].fields[0]: "hero" is already in files[0].sections[0] as a whole']);
  // The form: each section shows exactly its parts; a flat object's fields are the section's own.
  const { window } = new Window();
  const value = { intro: "Welcome", hero: { title: "Hi", photo: "/a.png" }, services: [{ name: "Head Spa", card: { blurb: "Calm" }, highlights: ["Scalp", "Steam"] }, { name: "Nails" }], loose: [] };
  const sections = [{ key: "top", label: "Top", fields: ["intro", "hero.title"] }, { key: "s0", label: "Head Spa · Card & facts", fields: ["services[0].name", "services[0].card"] }, { key: "s0h", label: "Head Spa · Highlights", fields: ["services[0].highlights"] }];
  const form = createForm({ doc: window.document, fields, sections, value, role: "owner" });
  const paths = (key) => [...form.element.querySelector(`[data-section="${key}"]`).querySelectorAll(":scope > .vc-field")].map((field) => field.dataset.path);
  assert.deepEqual(paths("top"), ["intro", "hero.title"]);
  assert.deepEqual(paths("s0"), ["services[0].name", "services[0].card"]);
  assert.ok(form.element.querySelector('[data-path="services[0].card"]').classList.contains("vc-sole"), "flat: true");
  assert.deepEqual(paths("_other"), ["loose"], "only what no section shows is under Other");
  form.element.querySelector('[data-path="services[0].card.blurb"] input').value = "Very calm";
  form.element.querySelector('[data-path="services[0].card.blurb"] input').dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(form.value().services, [{ name: "Head Spa", card: { blurb: "Very calm" }, highlights: ["Scalp", "Steam"] }, { name: "Nails" }], "the rest of the list stays as it was");
  // The inspector: rows and summaries from the parts.
  const listed = inspectorSections(fields, sections, "Home");
  assert.deepEqual(listed.map((section) => section.key), ["top", "s0", "s0h", "_other"]);
  assert.equal(sectionSummary(listed[1], fields, value), "Head Spa");
  assert.equal(sectionSummary(listed[2], fields, value), "2 highlights");
  const { sectionOfPath } = await import("../dist/admin/index.js");
  assert.equal(sectionOfPath(listed, "services[0].card.blurb").key, "s0");
  assert.equal(sectionOfPath(listed, "hero.title").key, "top");
});
