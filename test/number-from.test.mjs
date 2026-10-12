// P16a: f.number (a JSON number: order of an offer, stamps of a card) and text `from` (an item's id made from its name
// while the item is new, unique in its list). Invented content shaped like a real salon's menu and offers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, f } from "../dist/index.js";
import { checkRecordValues } from "../dist/check/values.js";
import { createForm, summarizeChanges, describeChange } from "../dist/admin/index.js";

const line = f.object({ label: "Line", fields: { id: f.text({ label: "ID", required: true, pattern: "[a-z0-9]+(?:-[a-z0-9]+)*", from: "name" }), name: f.text({ label: "Name", required: true }), price: f.text({ label: "Price" }) } });
const fields = {
  priority: f.number({ label: "Order", integer: true, min: 1, max: 99 }),
  stamps: f.number({ label: "Stamps", integer: true, min: 1, max: 20, required: true }),
  rate: f.number({ label: "Rate" }),
  items: f.list(line, { label: "Lines", itemLabel: "Line" }),
};
const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
const configProblems = (fieldsOf) => checkCmsConfig({ ...base, files: [{ key: "menu", label: "Menu", path: "src/data/menu.json", format: "json", fields: fieldsOf }] }).errors.map((problem) => `${problem.path}: ${problem.message}`);

test("config: number takes min / max / integer; `from` names a text field next to it", () => {
  assert.deepEqual(configProblems(fields), []);
  assert.match(configProblems({ n: f.number({ label: "N", min: 5, max: 1 }) }).join("\n"), /n\.min: is bigger than max \(5 > 1\)/);
  assert.match(configProblems({ n: { type: "number", label: "N", min: "1" } }).join("\n"), /n\.min: must be a number/);
  assert.match(configProblems({ id: f.text({ label: "ID", from: "title" }), name: f.text({ label: "Name" }) }).join("\n"), /id\.from: must name a text field next to it \(got "title"\)/);
});

test("values: a number is a JSON number, whole when integer, inside min / max", () => {
  assert.deepEqual(checkRecordValues({ fields, record: { priority: 2, stamps: 8, rate: 1.5, items: [] } }).errors, []);
  assert.deepEqual(checkRecordValues({ fields, record: { priority: "2", stamps: 8.5, rate: 3, items: [] } }).errors.map((problem) => `${problem.path}: ${problem.message}${problem.hint ? ` (${problem.hint})` : ""}`), [
    'priority: expected a number, got text "2" (write it without quotes: 2)',
    "stamps: 8.5 is not a whole number",
  ]);
  assert.deepEqual(checkRecordValues({ fields, record: { priority: 0, stamps: 21, items: [] } }).errors.map((problem) => `${problem.path}: ${problem.message}`), ["priority: 0 is less than 1", "stamps: 21 is more than 20"]);
  assert.match(checkRecordValues({ fields, record: { items: [] } }).errors[0].message, /required \("Stamps"\) but missing/);
});

test("form: a number input writes numbers; emptied, the value is left out; the review reads the number", () => {
  const { window } = new Window();
  const form = createForm({ doc: window.document, fields, value: { priority: 2, stamps: 8, items: [] }, role: "owner" });
  const input = form.element.querySelector('[data-path="priority"] input');
  assert.equal(input.type, "number");
  assert.deepEqual([input.min, input.max, input.step], ["1", "99", "1"]);
  input.value = "3"; input.dispatchEvent(new window.Event("input"));
  assert.equal(form.value().priority, 3);
  input.value = ""; input.dispatchEvent(new window.Event("input"));
  assert.ok(!("priority" in form.value()));
  assert.deepEqual(summarizeChanges({ fields, before: { stamps: 8 }, after: { stamps: 10 } }).map(describeChange), ["Stamps: 8 → 10"]);
});

test("form: a new line's id follows its name (unique in the list); typing the id stops that; an existing id never moves", () => {
  const { window } = new Window();
  const form = createForm({ doc: window.document, fields, value: { stamps: 8, items: [{ id: "classic-manicure", name: "Classic Manicure", price: "$20" }] }, role: "owner" });
  const add = [...form.element.querySelectorAll('[data-path="items"] button')].find((button) => /Add line/.test(button.textContent));
  const type = (path, value) => { const input = form.element.querySelector(`[data-path="${path}"] input`); input.value = value; input.dispatchEvent(new window.Event("input")); };
  // An existing line: renaming it keeps its id (prices elsewhere point to it).
  type("items[0].name", "Classic Manicure Deluxe");
  assert.equal(form.value().items[0].id, "classic-manicure");
  // A new line: the id is made from the name as it is typed, unique among the other lines.
  add.click();
  type("items[1].name", "Classic Manicure");
  assert.equal(form.value().items[1].id, "classic-manicure-2");
  assert.equal(form.element.querySelector('[data-path="items[1].id"] input').value, "classic-manicure-2");
  type("items[1].name", "Gel Manicure");
  assert.equal(form.value().items[1].id, "gel-manicure");
  // Typing the id yourself: it stays as written.
  type("items[1].id", "gel");
  type("items[1].name", "Gel Manicure Plus");
  assert.equal(form.value().items[1].id, "gel");
});
