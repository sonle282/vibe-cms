// M13: the Mr Spa CMS's shared blocks — menu cards (f.menu: label + "Opens: …", ↑ ↓, ⋯ Remove, "+ Add link",
// dropdowns), the price box (f.price) and a field that copies another (sameAs: "Phone comes from … › …", Edit).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, f, loadCmsConfig } from "../dist/index.js";
import { createForm, priceNote, priceShown, priceValue, sameAsNote } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let site; let services;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  site = JSON.parse(readFileSync(join(demoRoot, "src/data/site.json"), "utf8"));
  services = JSON.parse(readFileSync(join(demoRoot, "src/data/services.json"), "utf8"));
});
const dom = () => { const window = new Window({ url: "http://localhost/admin" }); return { window, document: window.document }; };
const links = { pages: [["/", "Salon info"], ["/services/", "Services"], ["/team/", "Team"]], host: "demo.example" };
const type = (window, input, value) => { input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };

test("M13 helpers: a plain amount is written $1,299 (Mr Spa), other words as typed; the copy's words", () => {
  assert.deepEqual(["1299", "$1299", "1,299.5", " 20 ", "From $980", "$5+", "", "1234567890"].map(priceValue), ["$1,299", "$1,299", "$1,299.50", "$20", "From $980", "$5+", "", "1234567890"]);
  assert.deepEqual(["$1,299", "$20", "From $980", "$5+", ""].map(priceShown), ["1,299", "20", "From $980", "$5+", ""], "a plain amount without its $ (the box has one); other words keep theirs");
  assert.equal(priceNote("$1,299"), "Shoppers will see $1,299.");
  assert.equal(priceNote(""), "");
  assert.equal(sameAsNote("Phone", "Store phone number", "Header"), "Phone comes from Header › Store phone number");
  assert.equal(sameAsNote("Phone", "Phone"), "Phone comes from Phone");
});

test("M13 config: menu items, the price format and sameAs are checked", () => {
  const problems = (fields) => checkCmsConfig({ ...config, files: config.files.map((file, index) => (index === 0 ? { ...file, sections: undefined, fields: { ...file.fields, ...fields } } : file)) }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ nav: f.menu({ label: "Nav", min: 1, max: 4 }) }), []);
  assert.deepEqual(problems({ nav: f.list(f.object({ label: "Item", fields: { label: f.text({ label: "Label" }) } }), { label: "Nav", menu: true }) }), ["files[0].fields.nav.menu: menu cards are items with a label (a text field) and where they go (a link field)"]);
  assert.deepEqual(problems({ cost: { ...f.price({ label: "Cost" }), format: "money" } }), ['files[0].fields.cost.format: unknown format "money"']);
  assert.deepEqual(problems({ again: f.phone({ label: "Again", sameAs: "nope" }) }), ['files[0].fields.again.sameAs: "nope" is not a field of this record']);
  assert.deepEqual(problems({ again: f.text({ label: "Again", sameAs: "phone" }) }), ['files[0].fields.again.sameAs: "phone" is a phone field, not text']);
  assert.deepEqual(problems({ again: f.phone({ label: "Again", sameAs: "footerPhone" }) }), ['files[0].fields.again.sameAs: "footerPhone" copies "phone" itself']);
  assert.deepEqual(problems({ again: f.text({ label: "Again", sameAs: "again" }) }), ["files[0].fields.again.sameAs: cannot name the field itself"]);
  assert.deepEqual(problems({ rows: f.list(f.object({ label: "Row", fields: { phone: f.phone({ label: "P", sameAs: "phone" }) } }), { label: "Rows" }) }), ["files[0].fields.rows.of: sameAs is not for fields inside a list item"]);
});

test("M13 menu cards (Mr Spa): closed = label + Opens / Dropdown · N links; open = Editing link i of n, ↑ ↓, ⋯ Remove; + Add link", () => {
  const { window, document } = dom();
  let value;
  const form = createForm({ doc: document, fields: { menu: config.files[0].fields.menu }, value: { menu: site.menu }, role: "owner", links, onChange: (next) => { value = next; } });
  document.body.append(form.element);
  const cards = () => [...form.element.querySelectorAll('[data-path="menu"] > .vc-menu-list > .vc-menu-cards > .vc-menu-card')];
  const closed = () => cards().map((card) => (card.classList.contains("is-open") ? ["(open)", card.querySelector(".vc-menu-card-heading").textContent] : [card.querySelector(".vc-menu-card-title").textContent, card.querySelector(".vc-menu-card-meta").textContent]));
  assert.deepEqual(closed(), [["Home", "Opens: demo.example"], ["Services", "Opens: demo.example/services/"], ["Team", "Opens: demo.example/team/"], ["More", "Dropdown · 2 links"], ["Elsewhere", "Opens: example.com"]]);
  // Open the second: its fields, ↑ ↓ (named), ⋯.
  cards()[1].querySelector(".vc-menu-card-summary").click();
  assert.deepEqual(closed()[1], ["(open)", "Editing link 2 of 5"]);
  const open = () => form.element.querySelector(".vc-menu-card.is-open");
  assert.equal(document.activeElement, open().querySelector(".vc-menu-card-heading"));
  assert.deepEqual([...open().querySelectorAll(".vc-menu-card-action")].map((button) => [button.getAttribute("aria-label"), button.dataset.tooltip, button.disabled]), [["Move Services up", "Move up", false], ["Move Services down", "Move down", false]]);
  assert.deepEqual([...open().querySelectorAll(".vc-menu-card-body > .vc-field > .vc-label")].map((label) => label.textContent.trim()), ["Label", "Opens", "Dropdown"], "a link may hold a dropdown");
  type(window, open().querySelector('[data-path="menu[1].label"] input'), "Our services");
  assert.equal(value.menu[1].label, "Our services");
  // ↑: it trades places, and stays open.
  open().querySelector(".vc-menu-card-up").click();
  assert.deepEqual(value.menu.slice(0, 2).map((item) => item.label), ["Our services", "Home"]);
  assert.deepEqual(closed()[0], ["(open)", "Editing link 1 of 5"]);
  assert.equal(open().querySelector(".vc-menu-card-up").disabled, true, "the first cannot go up");
  // The heading closes it.
  open().querySelector(".vc-menu-card-heading").click();
  assert.equal(open(), null);
  // A dropdown: its links are cards inside.
  cards()[3].querySelector(".vc-menu-card-summary").click();
  assert.deepEqual([...open().querySelectorAll(".vc-menu-cards .vc-menu-card-title")].map((node) => node.textContent), ["Blog", "Privacy"]);
  // ⋯ → Remove (no question); the list redraws closed.
  const more = open().querySelector(":scope > .vc-menu-card-head .vc-row-menu-button");
  assert.deepEqual([more.getAttribute("aria-label"), more.dataset.tooltip], ["More actions for More", "More"]);
  more.click();
  const remove = open().querySelector(":scope > .vc-menu-card-head .vc-row-menu-item");
  assert.deepEqual([remove.textContent, remove.disabled], ["Remove", false]);
  remove.click();
  assert.deepEqual(value.menu.map((item) => item.label), ["Our services", "Home", "Team", "Elsewhere"]);
  // + Add link: "New link" opening the site, open, its label focused; at most 8.
  const add = form.element.querySelector('[data-path="menu"] > .vc-menu-list > .vc-menu-add');
  assert.equal(add.textContent, "+ Add link");
  add.click();
  assert.deepEqual(value.menu.at(-1), { label: "New link", href: "/" });
  assert.deepEqual(closed().at(-1), ["(open)", "Editing link 5 of 5"]);
  assert.equal(document.activeElement, open().querySelector('[data-path="menu[4].label"] input'));
  for (let i = 0; i < 3; i += 1) add.click();
  assert.equal(value.menu.length, 8);
  assert.deepEqual([add.disabled, add.title], [true, "This list holds at most 8 links."]);
});

test("M13 menu at its minimum: Remove is off and says why", () => {
  const { document } = dom();
  const form = createForm({ doc: document, fields: { nav: f.menu({ label: "Nav", min: 2 }) }, value: { nav: [{ label: "A", href: "/" }, { label: "B", href: "/b/" }] }, role: "owner", links });
  form.element.querySelector(".vc-menu-card-summary").click();
  form.element.querySelector(".vc-row-menu-button").click();
  const remove = form.element.querySelector(".vc-row-menu-item");
  assert.deepEqual([remove.disabled, remove.title, form.element.querySelector(".vc-menu-card-reason").textContent], [true, "This list keeps at least 2 links.", "This list keeps at least 2 links."]);
});

test("M13 price (Mr Spa): $ in front, 1299 saved as $1,299, other words kept, “Shoppers will see …”", () => {
  const { window, document } = dom();
  let value;
  const form = createForm({ doc: document, fields: config.collections[0].fields, value: services[0], role: "owner", onChange: (next) => { value = next; } });
  const box = form.element.querySelector('[data-path="price"]');
  const input = box.querySelector("input");
  assert.deepEqual([box.querySelector(".vc-price-currency").textContent, input.value, input.placeholder, input.getAttribute("inputmode")], ["$", "20", "0.00", "decimal"]);
  assert.equal(box.querySelector(".vc-price-note").textContent, "Shoppers will see $20.");
  type(window, input, "1299");
  assert.equal(value.price, "$1,299");
  assert.equal(box.querySelector(".vc-price-note").textContent, "Shoppers will see $1,299.");
  type(window, input, "From $980");
  assert.equal(value.price, "From $980");
  const plus = createForm({ doc: document, fields: config.collections[0].fields, value: services[2], role: "owner" });
  assert.equal(plus.element.querySelector('[data-path="price"] input').value, "$5+", "words keep their $");
});

test("M13 sameAs (Mr Spa): the footer's phone is the salon's — its value, where it comes from, Edit goes there; it follows", () => {
  const { window, document } = dom();
  let value;
  const revealed = [];
  const fields = config.files[0].fields;
  const form = createForm({ doc: document, fields, sections: config.files[0].sections, value: site, role: "owner", onChange: (next) => { value = next; }, reveal: (path) => revealed.push(path) });
  const card = form.element.querySelector('[data-path="footerPhone"] .vc-same-card');
  assert.equal(form.element.querySelector('[data-path="footerPhone"] input'), null, "no box of its own");
  assert.deepEqual([card.querySelector(".vc-same-value").textContent, card.querySelector(".vc-same-text span").textContent], ["(555) 010-0000", "Phone comes from Contact & hours › Phone"]);
  const edit = card.querySelector(".vc-same-edit");
  assert.deepEqual([edit.textContent, edit.getAttribute("aria-label")], ["Edit", "Edit the phone in Contact & hours"]);
  edit.click();
  assert.deepEqual(revealed, ["phone"]);
  type(window, form.element.querySelector('[data-path="phone"] input'), "(555) 010-0099");
  assert.equal(value.footerPhone, value.phone, "it follows");
  assert.equal(card.querySelector(".vc-same-value").textContent, value.phone);
});
