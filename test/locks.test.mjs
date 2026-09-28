// P4: locked fields, checked on the server. Each editor rule has an allowed and a refused case; owner may do anything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkLocks, checkPublishLocks, createMemoryAuditLog, createMemoryDraftStore, f, isBlank, loadCmsConfig, LockedFieldError, lockedFieldBody, lockedFieldResponse, saveDraftChecked } from "../dist/index.js";

// A config with locks at every depth: file fields, a locked object, a dotted key, and a collection whose records hold
// groups[] → items[] → options[] → surcharge (4 levels).
const config = {
  configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" },
  files: [{
    key: "site", label: "Salon info", path: "src/data/site.json", format: "json",
    fields: {
      phone: f.text({ label: "Phone", locked: "owner" }),
      email: f.text({ label: "Email", locked: "owner" }),
      address: f.object({ label: "Address", locked: "owner", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }) } }),
      hours: f.hours({ label: "Opening hours", locked: "owner" }),
      tagline: f.text({ label: "Tagline" }),
      "contact.whatsapp": f.text({ label: "WhatsApp", locked: "owner" }),
      "contact.note": f.text({ label: "Note" }),
    },
  }],
  collections: [{
    key: "menu", label: "Menu", itemLabel: "Service", store: { kind: "json-array", path: "src/data/menu.json", idField: "id" },
    fields: {
      name: f.text({ label: "Name" }),
      price: f.text({ label: "Price", locked: "owner" }),
      groups: f.list(f.object({ label: "Group", fields: {
        title: f.text({ label: "Title" }),
        items: f.list(f.object({ label: "Item", fields: {
          name: f.text({ label: "Name" }),
          price: f.text({ label: "Price", locked: "owner" }),
          options: f.list(f.object({ label: "Option", fields: { label: f.text({ label: "Label" }), surcharge: f.text({ label: "Surcharge", locked: "owner" }) } }), { label: "Options" }),
        } }), { label: "Items", itemLabel: "Item" }),
      } }), { label: "Groups" }),
    },
  }],
};
const site = { phone: "(555) 010-0000", email: "hi@demo.example", address: { street: "1 Example St", city: "Sampletown" }, hours: [{ days: [1], open: "09:00", close: "17:00" }], tagline: "Hello", contact: { whatsapp: "+1 555", note: "Ask" } };
const record = (id, price, extra = {}) => ({ id, name: `Service ${id}`, price, groups: [{ title: "Main", items: [
  { name: "Basic", price: "$10", options: [{ label: "Gel", surcharge: "$5" }, { label: "Art", surcharge: "$3" }] },
  { name: "Deluxe", price: "$20", options: [{ label: "Gel", surcharge: "$6" }] },
] }], ...extra });
const clone = structuredClone;
const file = (role, change) => { const after = clone(site); change(after); return checkLocks({ config, role, target: { kind: "file", key: "site" }, before: site, after }); };
const item = (role, change, before = record("a", "$30")) => { const after = clone(before); change(after); return checkLocks({ config, role, target: { kind: "item", key: "menu" }, before, after }); };
const paths = (violations) => violations.map((entry) => `${entry.reason}:${entry.path}`);

// ------------------------------------------------------------------ rule 1: locked values do not change (any depth)

test("owner may change every locked field", () => {
  assert.deepEqual(file("owner", (s) => { s.phone = "1"; s.address.city = "X"; s.hours = []; s.contact.whatsapp = ""; }), []);
  assert.deepEqual(item("owner", (r) => { r.price = "$1"; r.groups[0].items[1].options[0].surcharge = "$0"; }), []);
});
test("editor: an unlocked field changes freely", () => { assert.deepEqual(file("editor", (s) => { s.tagline = "New"; s.contact.note = "Call"; }), []); });
test("editor: a locked text field → refused with its label", () => {
  const [violation, ...rest] = file("editor", (s) => { s.phone = "(555) 999-9999"; });
  assert.deepEqual(rest, []);
  assert.deepEqual({ ...violation }, { path: "phone", field: "Phone", label: "Phone", reason: "changed", message: "Only the owner can change Phone" });
});
test("editor: empty values count as the same (\"\" ↔ missing ↔ null)", () => {
  const before = { ...clone(site), email: "" };
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "file", key: "site" }, before, after: { ...clone(site), email: undefined } }), []);
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "file", key: "site" }, before, after: { ...clone(site), email: null } }), []);
  assert.ok(isBlank({ a: "", b: [null, { c: "" }] }) && !isBlank({ a: "x" }));
});
test("editor: a value inside a locked object → refused as the object", () => { assert.deepEqual(paths(file("editor", (s) => { s.address.city = "Othertown"; })), ["changed:address"]); });
test("editor: locked hours and a locked dotted key → refused", () => {
  assert.deepEqual(paths(file("editor", (s) => { s.hours[0].close = "18:00"; s.contact.whatsapp = "+1 556"; })), ["changed:hours", "changed:contact.whatsapp"]);
});
test("editor: every refused field is listed at once", () => {
  assert.deepEqual(paths(file("editor", (s) => { s.phone = "1"; s.email = "x@y.example"; s.tagline = "ok"; })), ["changed:phone", "changed:email"]);
});
test("editor: a record's top-level price → refused; its name → allowed", () => {
  assert.deepEqual(paths(item("editor", (r) => { r.price = "$35"; })), ["changed:price"]);
  assert.deepEqual(item("editor", (r) => { r.name = "Renamed"; }), []);
});
test("editor: 4 levels deep (groups → items → options → surcharge) → refused with the full path and labels", () => {
  const [violation] = item("editor", (r) => { r.groups[0].items[0].options[1].surcharge = "$4"; });
  assert.equal(violation.path, "groups[0].items[0].options[1].surcharge");
  assert.equal(violation.field, "Groups › Items › Options › Surcharge");
  assert.equal(violation.message, "Only the owner can change Groups › Items › Options › Surcharge");
});
test("editor: unlocked values at the same depths → allowed", () => {
  assert.deepEqual(item("editor", (r) => { r.groups[0].title = "Mains"; r.groups[0].items[1].name = "Premium"; r.groups[0].items[0].options[1].label = "Nail art"; }), []);
});
test("editor: swapping two prices in place is a change (not a move) → refused", () => {
  assert.deepEqual(paths(item("editor", (r) => { const items = r.groups[0].items; [items[0].price, items[1].price] = [items[1].price, items[0].price]; })), ["changed:groups[0].items[0].price", "changed:groups[0].items[1].price"]);
});

// ------------------------------------------------------------------ rule 3: re-ordering is allowed

test("editor: re-ordering list entries (whole entries move) → allowed", () => {
  assert.deepEqual(item("editor", (r) => { r.groups[0].items.reverse(); }), []);
  assert.deepEqual(item("editor", (r) => { r.groups[0].items[0].options.reverse(); }), []);
});
test("editor: entries with an id are matched by id — move + edit an unlocked field → allowed; + locked field → refused", () => {
  const before = record("a", "$30");
  before.groups[0].items = before.groups[0].items.map((entry, index) => ({ id: `i${index}`, ...entry }));
  assert.deepEqual(item("editor", (r) => { r.groups[0].items.reverse(); r.groups[0].items[0].name = "Deluxe+"; }, before), []);
  assert.deepEqual(paths(item("editor", (r) => { r.groups[0].items.reverse(); r.groups[0].items[0].price = "$21"; }, before)), ["changed:groups[0].items[0].price"]);
});
test("editor: re-ordering collection records (matched by id, not position) → allowed", () => {
  const before = [record("a", "$30"), record("b", "$40"), record("c", "")];
  const after = [clone(before[2]), clone(before[0]), clone(before[1])];
  after[1].name = "Renamed";
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "collection", key: "menu" }, before, after }), []);
  after[2].price = "$41";
  assert.deepEqual(paths(checkLocks({ config, role: "editor", target: { kind: "collection", key: "menu" }, before, after })), ['changed:["b"].price']);
});

// ------------------------------------------------------------------ rule 2: add only with locked fields empty

test("editor: a new record with its price empty → allowed; with a price → refused", () => {
  const empty = { id: "new", name: "New", price: "", groups: [{ title: "Main", items: [{ name: "Only", price: "", options: [{ label: "Gel", surcharge: "" }] }] }] };
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "item", key: "menu" }, before: undefined, after: empty }), []);
  const priced = { ...clone(empty), price: "$50" };
  priced.groups[0].items[0].options[0].surcharge = "$2";
  const violations = checkLocks({ config, role: "editor", target: { kind: "item", key: "menu" }, before: undefined, after: priced });
  assert.deepEqual(paths(violations), ["added:price", "added:groups[0].items[0].options[0].surcharge"]);
  assert.equal(violations[0].message, "Only the owner can add a Service with Price filled in — leave Price empty for the owner");
});
test("editor: a new list entry with an empty price → allowed; with a price → refused", () => {
  assert.deepEqual(item("editor", (r) => { r.groups[0].items.push({ name: "Mini", price: "", options: [] }); }), []);
  const [violation] = item("editor", (r) => { r.groups[0].items.push({ name: "Mini", price: "$5", options: [] }); });
  assert.deepEqual([violation.reason, violation.path, violation.message], ["added", "groups[0].items[2].price", "Only the owner can add an Item with Groups › Items › Price filled in — leave Price empty for the owner"]);
});
test("editor: a new record in the collection (collection-level) follows the same rule", () => {
  const before = [record("a", "$30")];
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "collection", key: "menu" }, before, after: [...clone(before), { id: "b", name: "B", price: "" }] }), []);
  assert.deepEqual(paths(checkLocks({ config, role: "editor", target: { kind: "collection", key: "menu" }, before, after: [...clone(before), { id: "b", name: "B", price: "$9" }] })), ['added:["b"].price']);
});

// ------------------------------------------------------------------ rule 4: no removing items that hold locked values

test("editor: removing a record with a price → refused; without any locked value → allowed", () => {
  const withPrice = record("a", "$30");
  assert.deepEqual(paths(checkLocks({ config, role: "editor", target: { kind: "item", key: "menu" }, before: withPrice, after: undefined })).slice(0, 1), ["removed:price"]);
  const bare = { id: "z", name: "Draft idea", price: "", groups: [] };
  assert.deepEqual(checkLocks({ config, role: "editor", target: { kind: "item", key: "menu" }, before: bare, after: undefined }), []);
  const collection = checkLocks({ config, role: "editor", target: { kind: "collection", key: "menu" }, before: [withPrice, bare], after: [] });
  assert.ok(collection.every((entry) => entry.reason === "removed" && entry.path.startsWith('["a"]')), JSON.stringify(collection));
  assert.equal(collection[0].message, "Only the owner can remove a Service that has Price");
});
test("editor: removing a list entry with a price → refused; an entry with empty locked fields → allowed", () => {
  assert.deepEqual(paths(item("editor", (r) => { r.groups[0].items.splice(1, 1); })), ["removed:groups[0].items[1].price", "removed:groups[0].items[1].options[0].surcharge"]);
  const before = record("a", "$30");
  before.groups[0].items.push({ name: "Unpriced", price: "", options: [] });
  assert.deepEqual(item("editor", (r) => { r.groups[0].items.pop(); }, before), []);
});
test("owner: add with a price, remove a priced record → allowed", () => {
  assert.deepEqual(checkLocks({ config, role: "owner", target: { kind: "item", key: "menu" }, before: undefined, after: record("n", "$9") }), []);
  assert.deepEqual(checkLocks({ config, role: "owner", target: { kind: "item", key: "menu" }, before: record("n", "$9"), after: undefined }), []);
});

// ------------------------------------------------------------------ enforcement: draft save + publish, 403, audit

const ids = { owner: "usr_owner1", editor: "usr_editor1" };
let clock = 0;
const now = () => new Date(Date.UTC(2026, 8, 28, 13, 0, clock++)).toISOString();

test("draft save by an editor changing a locked field → LockedFieldError (403), draft NOT written, audit 'denied' without values", async () => {
  const drafts = createMemoryDraftStore(now); const audit = createMemoryAuditLog();
  const input = { userId: ids.editor, resource: "file:site", label: "Salon info", content: { ...clone(site), phone: "(555) 123-4567" }, sourceVersion: "v1" };
  await assert.rejects(saveDraftChecked({ config, role: "editor", drafts, audit, source: site, input, now }), (error) => {
    assert.ok(error instanceof LockedFieldError);
    assert.equal(error.status, 403);
    assert.equal(error.stage, "draft");
    return true;
  });
  assert.equal(await drafts.get(ids.editor, "file:site"), undefined, "the draft was not saved");
  const [row, ...more] = await audit.list();
  assert.deepEqual(more, []);
  assert.deepEqual({ userId: row.userId, role: row.role, action: row.action, stage: row.stage, resource: row.resource }, { userId: ids.editor, role: "editor", action: "denied", stage: "draft", resource: "file:site" });
  assert.deepEqual(row.detail, { reason: "locked_field", fields: [{ path: "phone", field: "Phone", reason: "changed" }] });
  assert.ok(!JSON.stringify(row).includes("123-4567"), "no value in the audit row");
});
test("draft save by an editor changing only unlocked fields → saved, no audit row", async () => {
  const drafts = createMemoryDraftStore(now); const audit = createMemoryAuditLog();
  const saved = await saveDraftChecked({ config, role: "editor", drafts, audit, source: site, input: { userId: ids.editor, resource: "file:site", content: { ...clone(site), tagline: "Welcome" }, sourceVersion: "v1" }, now });
  assert.equal(saved.revision, 1);
  assert.deepEqual(await audit.list(), []);
});
test("publish checks again with the role at publish time: owner's draft, published after the role became editor → denied", async () => {
  const drafts = createMemoryDraftStore(now); const audit = createMemoryAuditLog();
  const before = record("a", "$30");
  const draft = await saveDraftChecked({ config, role: "owner", drafts, audit, source: before, input: { userId: ids.owner, resource: "item:menu:a", content: { ...clone(before), price: "$32" }, sourceVersion: "v1" }, now });
  assert.equal(draft.revision, 1, "the owner may save it");
  await assert.rejects(checkPublishLocks({ config, role: "editor", userId: ids.owner, audit, resource: "item:menu:a", before, after: draft.content, now }), LockedFieldError);
  const [row] = await audit.list({ resource: "item:menu:a" });
  assert.deepEqual([row.action, row.stage, row.detail.fields[0].path], ["denied", "publish", "price"]);
  await checkPublishLocks({ config, role: "owner", userId: ids.owner, audit, resource: "item:menu:a", before, after: draft.content, now });
  assert.equal((await audit.list()).length, 1, "an allowed publish writes no 'denied' row");
});
test("the 403 response names the fields and never the values", async () => {
  const error = new LockedFieldError(file("editor", (s) => { s.phone = "(555) 777-0000"; s.address.city = "Else"; }), "draft");
  const response = lockedFieldResponse(error);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await response.json();
  assert.deepEqual(body, lockedFieldBody(error));
  assert.equal(body.error, "locked_field");
  assert.deepEqual(body.fields.map((entry) => entry.path), ["phone", "address"]);
  assert.ok(!JSON.stringify(body).includes("777-0000") && !JSON.stringify(body).includes("Else"));
});
test("an email is never accepted as the audit user id", async () => {
  await assert.rejects(createMemoryAuditLog().record({ at: now(), userId: "owner@example.com", role: "owner", action: "denied", stage: "draft", resource: "file:site", detail: {} }), /never an email/);
});

// ------------------------------------------------------------------ the demo site's own locks (phone, email, address, hours, price)

test("demo site: editor may not change phone, email, address, hours or a service price; may change the tagline", async () => {
  const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
  const demo = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  const current = JSON.parse(readFileSync(join(demoRoot, "src/data/site.json"), "utf8"));
  const changed = { ...clone(current), phone: "1", email: "x@demo.example", address: { ...current.address, city: "X" }, hours: [], tagline: "New" };
  assert.deepEqual(checkLocks({ config: demo, role: "editor", target: { kind: "file", key: "site" }, before: current, after: changed }).map((entry) => entry.path), ["phone", "email", "address", "hours"]);
  const services = JSON.parse(readFileSync(join(demoRoot, "src/data/services.json"), "utf8"));
  assert.deepEqual(checkLocks({ config: demo, role: "editor", target: { kind: "item", key: "services" }, before: services[0], after: { ...services[0], price: "$21" } }).map((entry) => entry.message), ["Only the owner can change Price"]);
  assert.deepEqual(checkLocks({ config: demo, role: "editor", target: { kind: "collection", key: "services" }, before: services, after: [...services].reverse() }), []);
});
