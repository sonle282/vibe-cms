// P12g: pick (one of the choices the site lists from the record's own content — a price written once in the menu and
// used elsewhere by its place) and toggle (yes / no). Invented content shaped like a real salon's menu:
// services[].groups[].tiers[] with { id, name, price }, and { "of": "packages/the-essential-reset", "plain": true }.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, f } from "../dist/index.js";
import { checkRecordValues } from "../dist/check/values.js";
import { pickChoices, pickPlace } from "../dist/check/picks.js";
import { createForm, summarizeChanges, describeChange } from "../dist/admin/index.js";

/** Every line of the menu, as "group/line", grouped by the group's title. */
const menuLines = (content) => (content.services ?? []).flatMap((service) => (service.groups ?? []).flatMap((group) => [...(group.tiers ?? []), ...(group.items ?? [])].map((line) => ({ value: `${group.id}/${line.id}`, label: `${line.name} · ${line.price}`, group: group.title }))));
const priceRef = f.object({ label: "From price", fields: { of: f.pick({ label: "Line of the menu", required: true, choices: menuLines }), plain: f.toggle({ label: "Plain", help: "Show the price without “from”" }) } });
const fields = {
  services: f.list(f.object({ label: "Service", fields: {
    name: f.text({ label: "Name" }),
    fromPrice: priceRef,
    highlights: f.list(f.object({ label: "Highlight", fields: { label: f.text({ label: "Label" }), of: f.pick({ label: "Line", choices: menuLines }) } }), { label: "Highlights" }),
    groups: f.list(f.object({ label: "Group", fields: { id: f.text({ label: "Id" }), title: f.text({ label: "Title" }),
      tiers: f.list(f.object({ label: "Package", fields: { id: f.text({ label: "Id" }), name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "admin" }) } }), { label: "Packages" }),
      items: f.list(f.object({ label: "Line", fields: { id: f.text({ label: "Id" }), name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "admin" }) } }), { label: "Lines" }) } }), { label: "Menu", fixed: true }),
  } }), { label: "Services", fixed: true }),
  "about.pair": f.tuple([f.text({ label: "Title" }), f.pick({ label: "Price", choices: menuLines })], { label: "Pair" }),
};
const content = {
  services: [{
    name: "Head Spa",
    fromPrice: { of: "packages/the-essential-reset" },
    highlights: [{ label: "The Deep Renewal · 90m", of: "packages/the-deep-renewal" }],
    groups: [
      { id: "packages", title: "Head Spa Packages", tiers: [{ id: "the-essential-reset", name: "The Essential Reset", price: "$97" }, { id: "the-deep-renewal", name: "The Deep Renewal", price: "$150" }], items: [] },
      { id: "add-ons", title: "Add-ons", tiers: [], items: [{ id: "blowout", name: "Blowout", price: "$25" }] },
    ],
  }],
  about: { pair: ["Blowout", "add-ons/blowout"] },
};

test("config: a pick needs its choices function; a toggle takes no options", () => {
  const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
  const problems = (fieldsOf) => checkCmsConfig({ ...base, files: [{ key: "menu", label: "Menu", path: "src/data/menu.json", format: "json", fields: fieldsOf }] }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems({ price: f.pick({ label: "Price", choices: menuLines }), plain: f.toggle({ label: "Plain" }) }), []);
  assert.match(problems({ price: { type: "pick", label: "Price" } }).join("\n"), /price\.choices: required — a function/);
  assert.match(problems({ plain: { type: "toggle", label: "Plain", options: ["yes"] } }).join("\n"), /plain\.options: unknown/);
});

test("values: a pick holds one of the choices of the same record; a toggle is true / false; a choices function that throws is an error, not a crash", () => {
  assert.deepEqual(checkRecordValues({ fields, record: content }).errors, []);
  const wrong = structuredClone(content);
  wrong.services[0].fromPrice = { of: "packages/gone", plain: "yes" };
  wrong.services[0].highlights[0].of = 7;
  assert.deepEqual(checkRecordValues({ fields, record: wrong }).errors.map((problem) => `${problem.path}: ${problem.message}`), [
    'services[0].fromPrice.of: text "packages/gone" is not one of the choices of "Line of the menu"',
    'services[0].fromPrice.plain: expected true or false, got text "yes"',
    "services[0].highlights[0].of: expected the value of one of the choices, got number 7",
  ]);
  // The choices follow the content being checked: rename a line and the old place is no longer a choice.
  const renamed = structuredClone(content);
  renamed.groups = undefined;
  renamed.services[0].groups[0].tiers[0].id = "essential";
  assert.match(checkRecordValues({ fields, record: renamed }).errors[0].message, /"packages\/the-essential-reset" is not one of the choices/);
  const broken = { list: f.pick({ label: "Broken", choices: () => { throw new Error("no menu"); } }) };
  assert.match(checkRecordValues({ fields: broken, record: { list: "x" } }).errors[0].message, /the site's choices for "Broken" failed: no menu/);
});

test("choices by place: list items share one place ([]), tuple places stay apart ([1]), dotted keys as written", () => {
  const choices = pickChoices(fields, content);
  assert.deepEqual(Object.keys(choices), ["services[].fromPrice.of", "services[].highlights[].of", "about.pair[1]"]);
  assert.deepEqual(choices["services[].fromPrice.of"].map((choice) => [choice.value, choice.label, choice.group]), [
    ["packages/the-essential-reset", "The Essential Reset · $97", "Head Spa Packages"],
    ["packages/the-deep-renewal", "The Deep Renewal · $150", "Head Spa Packages"],
    ["add-ons/blowout", "Blowout · $25", "Add-ons"],
  ]);
  assert.equal(pickPlace(fields, ["services", 0, "fromPrice", "of"]), "services[].fromPrice.of");
  assert.equal(pickPlace(fields, ["services", 3, "highlights", 2, "of"]), "services[].highlights[].of");
  assert.equal(pickPlace(fields, ["about", "pair", 1]), "about.pair[1]");
  const errors = [];
  assert.deepEqual(pickChoices({ x: f.pick({ label: "X", choices: () => { throw new Error("boom"); } }) }, {}, (place, error) => errors.push(`${place}: ${error.message}`)), { x: [] });
  assert.deepEqual(errors, ["x: boom"]);
});

test("API: the editor's view carries the choices of the draft (else the live content)", async () => {
  const config = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [], files: [{ key: "menu", label: "Menu", path: "src/data/menu.json", format: "json", fields }] };
  const drafts = createMemoryDraftStore();
  const api = createCmsApi({ config, source: createBundledSource({ "src/data/menu.json": JSON.stringify(content, null, 2) }), drafts, audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_owner", role: "owner" }) });
  const call = async (method, body) => (await api.handle(new Request("http://localhost/api/cms/files/menu", { method, headers: { origin: "http://localhost", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }))).json();
  const view = await call("GET");
  assert.deepEqual(view.choices["services[].highlights[].of"].map((choice) => choice.value), ["packages/the-essential-reset", "packages/the-deep-renewal", "add-ons/blowout"]);
  // A draft that adds a line to the menu: that line is a choice at once, and the draft may point to it.
  const next = structuredClone(content);
  next.services[0].groups[1].items.push({ id: "haircut", name: "Haircut", price: "$55" });
  next.services[0].highlights[0].of = "add-ons/haircut";
  const saved = await call("PUT", { content: next, expectedRevision: 0, sourceVersion: view.version });
  assert.equal(saved.draft.revision, 1, JSON.stringify(saved));
  assert.ok((await call("GET")).choices["services[].highlights[].of"].some((choice) => choice.value === "add-ons/haircut"));
  // …and a place that is not a choice is refused on save.
  next.services[0].highlights[0].of = "add-ons/nothing";
  const refused = await call("PUT", { content: next, expectedRevision: 1, sourceVersion: view.version });
  assert.equal(refused.error, "invalid_content");
  assert.match(refused.errors.map((problem) => problem.message).join(" "), /"add-ons\/nothing" is not one of the choices/);
});

test("form: a pick is a list of the choices (grouped); a place no longer listed is kept and says so; a toggle sets true, and unticking leaves it out again", () => {
  const { window } = new Window();
  const doc = window.document;
  const value = structuredClone(content);
  value.services[0].highlights[0].of = "packages/retired";
  const changes = [];
  const form = createForm({ doc, fields, value, role: "owner", choices: pickChoices(fields, content), onChange: (next, path) => changes.push([path.join("."), structuredClone(next)]) });
  const from = form.element.querySelector('[data-path="services[0].fromPrice.of"] select');
  assert.deepEqual([...from.querySelectorAll("optgroup")].map((group) => [group.label, [...group.querySelectorAll("option")].map((option) => option.textContent)]), [
    ["Head Spa Packages", ["The Essential Reset · $97", "The Deep Renewal · $150"]],
    ["Add-ons", ["Blowout · $25"]],
  ]);
  assert.equal(from.value, "packages/the-essential-reset");
  const highlight = form.element.querySelector('[data-path="services[0].highlights[0].of"] select');
  assert.equal(highlight.value, "packages/retired");
  assert.equal(highlight.selectedOptions[0].textContent, "packages/retired (not in the list)");
  from.value = "add-ons/blowout"; from.dispatchEvent(new window.Event("change"));
  assert.equal(form.value().services[0].fromPrice.of, "add-ons/blowout");
  const plain = form.element.querySelector('[data-path="services[0].fromPrice.plain"] input[type=checkbox]');
  assert.equal(plain.checked, false);
  assert.match(form.element.querySelector('[data-path="services[0].fromPrice.plain"]').textContent, /Plain.*Show the price without “from”/);
  plain.checked = true; plain.dispatchEvent(new window.Event("change"));
  assert.equal(form.value().services[0].fromPrice.plain, true);
  plain.checked = false; plain.dispatchEvent(new window.Event("change"));
  assert.ok(!("plain" in form.value().services[0].fromPrice), "it was never set: unticked, it is left out again");
  assert.equal(form.element.querySelector('[data-path="about.pair[1]"] select').value, "add-ons/blowout");
});

test("review: a pick change reads as the names of the lines; a toggle as Yes / No", () => {
  const after = structuredClone(content);
  after.services[0].fromPrice = { of: "packages/the-deep-renewal", plain: true };
  const labels = Object.fromEntries(Object.values(pickChoices(fields, content)).flat().map((choice) => [choice.value, choice.label]));
  const lines = summarizeChanges({ fields, before: content, after, choiceLabels: labels }).map(describeChange);
  assert.deepEqual(lines, [
    "Services › Service 1 (Head Spa) › From price › Line of the menu: The Essential Reset · $97 → The Deep Renewal · $150",
    "Services › Service 1 (Head Spa) › From price › Plain: added “Yes”",
  ]);
});
