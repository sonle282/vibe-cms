// P12d: generic field options a real site needs — f.tuple (["Manicure", "$17"]), text pattern + tokens ({phone}),
// rich text with its own allow-list (["em", "br"]), and a site's own `rules` (the plugin seam: build, save, publish).
// Invented content shaped like a real salon's menu: fixed categories, items as [name, price] with the price locked.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, checkContent, checkLocks, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, f } from "../dist/index.js";
import { checkRecordValues } from "../dist/check/values.js";
import { sanitizeRichText } from "../dist/check/rich-text.js";
import { checkFixedLists } from "../dist/check/structure.js";
import { createForm, summarizeChanges, describeChange } from "../dist/admin/index.js";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const item = f.tuple([f.text({ label: "Service", required: true }), f.text({ label: "Price", locked: "owner", pattern: "\\$\\d+(\\+)?", patternHint: "a price like $17 or $45+" })], { label: "Service and price" });
const menuFields = {
  categories: f.list(f.object({ label: "Category", fields: {
    id: f.text({ label: "Id" }),
    title: f.text({ label: "Title" }),
    items: f.list(item, { label: "Services", itemLabel: "Service", ordered: true }),
    note: f.richText({ label: "Price note", allow: ["em", "br"] }),
  } }), { label: "Categories", itemLabel: "Category", fixed: true }),
};
const salonFields = {
  phone: f.text({ label: "Phone", locked: "owner" }),
  intro: f.text({ label: "Intro", multiline: true, tokens: ["phone", "city"] }),
  hours: f.list(f.object({ label: "Row", fields: { from: f.select({ label: "From", options: ["Monday", "Saturday", "Sunday"] }), opens: f.text({ label: "Opens", pattern: "([01]\\d|2[0-3]):[0-5]\\d", patternHint: "a time like 09:30" }) } }), { label: "Opening hours" }),
};
const menu = { categories: [
  { id: "natural", title: "Natural Nail Care", items: [["Manicure", "$17"], ["Gel Manicure", "$30"]], note: "Prices <em>start</em> at" },
  { id: "spa", title: "Spa Pedicure", items: [["Classic Pedicure", "$30"]], note: "" },
] };
const salon = { phone: "555-010-0000", intro: "Call {phone} — we are in {city}.", hours: [{ from: "Monday", opens: "09:30" }] };
/** Every service needs a price unless the site's rule allows "Ask us" — and the intro must name the phone. */
const menuRules = (value) => (value.categories ?? []).flatMap((category, c) => (category.items ?? []).flatMap((entry, i) => (entry[1] === "" ? [{ path: `categories[${c}].items[${i}][1]`, message: "a service needs a price" }] : [])));
const salonRules = (value, content) => {
  const problems = [];
  if (!String(value.intro ?? "").includes("{phone}")) problems.push({ path: "intro", message: "must say {phone}", hint: "people call from the intro" });
  if ((content.file("menu")?.categories ?? []).length === 0) problems.push({ path: "", message: "the menu is empty", warning: true });
  return problems;
};
const config = {
  configVersion: 1, site: { name: "Invented Salon", url: "https://salon.example" }, repo: { owner: "o", name: "r", branch: "main" },
  files: [
    { key: "menu", label: "Services & prices", path: "src/data/menu.json", format: "json", fields: menuFields, rules: menuRules },
    { key: "salon", label: "Salon info", path: "src/data/salon.json", format: "json", fields: salonFields, rules: salonRules },
  ],
  collections: [],
};

test("config: tuple, pattern / patternHint, tokens, rich-text allow and rules are checked", () => {
  assert.deepEqual(checkCmsConfig(config).errors, []);
  const one = (fields, extra = {}) => checkCmsConfig({ ...config, files: [{ key: "x", label: "X", path: "src/data/x.json", format: "json", fields, ...extra }] });
  assert.match(one({ a: f.tuple([f.text({ label: "Only" })], { label: "A" }) }).errors[0].message, /at least two fields/);
  assert.match(one({ a: f.text({ label: "A", pattern: "(" }) }).errors[0].message, /not a valid regular expression/);
  assert.match(one({ a: f.text({ label: "A", patternHint: "x" }) }).errors[0].message, /needs a pattern/);
  assert.match(one({ a: f.text({ label: "A", tokens: ["{phone}"] }) }).errors[0].hint, /without the braces/);
  assert.match(one({ a: f.richText({ label: "A", allow: ["em", "script"] }) }).errors[0].message, /"script" is not a rich-text tag/);
  assert.match(one({ a: f.text({ label: "A" }) }, { rules: "no" }).errors[0].message, /must be a function/);
  assert.match(one({ a: f.tuple([f.text({ label: "N" }), f.text({ label: "P", oops: 1 })], { label: "A" }) }).errors[0].path, /files\[0\]\.fields\.a\.items\[1\]\.oops/);
});

test("values: a tuple is a list of exactly its places; pattern and tokens", () => {
  assert.deepEqual(checkRecordValues({ fields: menuFields, record: menu }).errors, []);
  const errors = (record, fields = menuFields) => checkRecordValues({ fields, record }).errors.map((e) => [e.path, e.message]);
  const broken = structuredClone(menu);
  broken.categories[0].items[0] = ["Manicure"]; broken.categories[0].items[1] = ["Gel", 30]; broken.categories[1].items[0][1] = "thirty";
  assert.deepEqual(errors(broken), [
    ["categories[0].items[0]", 'expected 2 values in a list [Service, Price], got a list of 1'],
    ["categories[0].items[1][1]", "expected text, got number 30"],
    ["categories[1].items[0][1]", 'text "thirty" is not a price like $17 or $45+'],
  ]);
  assert.deepEqual(errors({ ...salon, intro: "Call {phone} or {email}", hours: [{ from: "Monday", opens: "9.30" }] }, salonFields), [
    ["intro", "{email} is not filled in by the website"],
    ["hours[0].opens", 'text "9.30" is not a time like 09:30'],
  ]);
});

test("locks, fixed lists and the rich-text allow-list reach into tuples", () => {
  const cfg = { ...config };
  const changed = structuredClone(menu); changed.categories[0].items[1][1] = "$35"; changed.categories[0].items[1][0] = "Gel Manicure Deluxe";
  const violations = checkLocks({ config: cfg, role: "editor", target: { kind: "file", key: "menu" }, before: menu, after: changed });
  assert.deepEqual(violations.map((v) => [v.path, v.field]), [["categories[0].items[1][1]", "Categories › Services › Price"]], "the price is locked, the name is not");
  const added = structuredClone(menu); added.categories[1].items.push(["Paraffin", ""]);
  assert.deepEqual(checkLocks({ config: cfg, role: "editor", target: { kind: "file", key: "menu" }, before: menu, after: added }), [], "an editor adds a service with an empty price");
  assert.deepEqual(checkFixedLists(menuFields, menu, added), [], "services inside a fixed category are not fixed");
  assert.match(checkFixedLists(menuFields, menu, { categories: [menu.categories[0]] })[0].message, /fixed set of 2 category/);
  const cleaned = sanitizeRichText('<p>Prices <strong>start</strong> at <em>$17</em><br><a href="/x">x</a></p>', { allow: ["em", "br"] });
  assert.equal(cleaned.html, "Prices start at <em>$17</em><br>x");
});

test("rules (the plugin seam): build-time content check reads other files; a throwing rule is an error, not a crash", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-rules-")); dirs.push(root);
  mkdirSync(join(root, "src/data"), { recursive: true });
  const write = (name, value) => writeFileSync(join(root, "src/data", name), `${JSON.stringify(value, null, 2)}\n`);
  write("menu.json", menu); write("salon.json", salon);
  assert.deepEqual(checkContent(config, root), { errors: [], warnings: [] });
  const noPrice = structuredClone(menu); noPrice.categories[1].items[0][1] = "";
  write("menu.json", noPrice); write("salon.json", { ...salon, intro: "Welcome." });
  const result = checkContent(config, root);
  assert.deepEqual(result.errors.map((e) => [e.path, e.message]), [["src/data/menu.json.categories[1].items[0][1]", "a service needs a price"], ["src/data/salon.json.intro", "must say {phone}"]]);
  write("menu.json", { categories: [] });
  assert.ok(checkContent(config, root).warnings.some((w) => w.message === "the menu is empty"), "a rule can return a warning; it reads the menu file");
  const throwing = { ...config, files: [{ ...config.files[1], rules: () => { throw new Error("boom"); } }] };
  write("salon.json", salon);
  assert.deepEqual(checkContent(throwing, root).errors.map((e) => e.message), ["the site's rule failed: boom"]);
});

test("rules in the API: a draft that breaks a rule is refused (422) with the rule's message", async () => {
  const files = { "src/data/menu.json": `${JSON.stringify(menu, null, 2)}\n`, "src/data/salon.json": `${JSON.stringify(salon, null, 2)}\n` };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_owner", role: "owner" }) });
  const call = async (method, path, body) => { const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { origin: "http://localhost", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })); return { status: response.status, body: await response.json() }; };
  const sourceVersion = (await call("GET", "/files/salon")).body.version;
  const refused = await call("PUT", "/files/salon", { content: { ...salon, intro: "Welcome." }, expectedRevision: 0, sourceVersion });
  assert.deepEqual([refused.status, refused.body.error, refused.body.errors.map((e) => [e.path, e.message, e.hint])], [422, "invalid_content", [["intro", "must say {phone}", "people call from the intro"]]]);
  assert.equal((await call("PUT", "/files/salon", { content: { ...salon, intro: "Ring {phone}." }, expectedRevision: 0, sourceVersion })).status, 200);
  const menuVersion = (await call("GET", "/files/menu")).body.version;
  const noPrice = structuredClone(menu); noPrice.categories[0].items.push(["Paraffin", ""]);
  assert.equal((await call("PUT", "/files/menu", { content: noPrice, expectedRevision: 0, sourceVersion: menuVersion })).body.errors[0].message, "a service needs a price");
});

test("admin: a tuple shows one input per place; text says its tokens and format; the rich-text toolbar follows allow", () => {
  const window = new Window({ url: "http://localhost/admin" });
  const form = createForm({ doc: window.document, fields: menuFields, value: menu, role: "editor", references: {} });
  const first = form.element.querySelector('[data-path="categories[0].items[0]"]');
  const inputs = [...first.querySelectorAll("input")];
  assert.deepEqual(inputs.map((input) => [input.value, input.disabled]), [["Manicure", false], ["$17", true]], "name editable, price locked for an editor");
  assert.match(first.textContent, /Service[\s\S]*Price/);
  const tools = [...form.element.querySelectorAll('[data-path="categories[0].note"] .vc-tool')].map((tool) => tool.dataset.command ?? tool.textContent);
  assert.deepEqual(tools.filter((name) => name !== "Edit HTML"), ["italic"], "only the italic tool: the field allows em and br");
  const salonForm = createForm({ doc: window.document, fields: salonFields, value: salon, role: "owner", references: {} });
  assert.match(salonForm.element.querySelector('[data-path="intro"]').textContent, /Words the website fills in: \{phone\}, \{city\}\./);
  assert.match(salonForm.element.querySelector('[data-path="hours[0].opens"]').textContent, /Format: a time like 09:30\./);
});

test("review: a tuple change reads per place", () => {
  const changed = structuredClone(menu); changed.categories[0].items[1][1] = "$35";
  const changes = summarizeChanges({ fields: menuFields, before: menu, after: changed });
  assert.deepEqual(changes.map(describeChange), ["Categories › Category 1 (natural) › Services › Service 2 (Gel Manicure) › Price: $30 → $35"]);
});
