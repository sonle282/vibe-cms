// M16: what Mr Spa's own controls need from the form — a phone image kept in a sibling key (image + mobileImage) on the
// desktop image's card (Desktop | Mobile, the help of the version shown); a field `hidden` from the form (still a
// value); a plugin control that writes and shows other fields of the record (setAt, standardAt).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, f } from "../dist/index.js";
import { createForm, linkOpensText, phoneHrefValue } from "../dist/admin/index.js";
import { pluginControls } from "../dist/admin/plugins.js";

const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "acme", name: "s", branch: "main" }, collections: [] };
const problems = (fields) => checkCmsConfig({ ...base, files: [{ key: "home", label: "Home", path: "src/data/home.json", format: "json", fields }] }).errors.map((entry) => `${entry.path}: ${entry.message}`);

test("M16 config: mobile names a sibling image field; hidden is a yes / no", () => {
  const image = (options = {}) => f.image({ label: "Image", ...options });
  assert.deepEqual(problems({ hero: f.object({ label: "Hero", fields: { image: image({ mobile: "mobileImage" }), mobileImage: image() } }), hidden: f.text({ label: "Id", hidden: true }) }), []);
  assert.deepEqual(problems({ slides: f.list(f.object({ label: "Banner", fields: { image: image({ mobile: "mobileImage" }), mobileImage: image() } }), { label: "Banners" }) }), [], "inside list items too");
  assert.deepEqual(problems({
    a: image({ mobile: "a" }), b: image({ mobile: "nope" }), c: image({ mobile: "text" }), text: f.text({ label: "T" }),
    d: image({ mobile: "e" }), e: image({ mobile: true }), g: image({ mobile: "k" }), h: image({ mobile: "k" }), k: image(),
    l: f.list(image({ mobile: "x" }), { label: "L" }), m: image({ mobile: "bad key!" }), n: f.text({ label: "N", hidden: "yes" }),
  }), [
    "files[0].fields.m.mobile: must be true / false or the key of the phone version (got \"bad key!\")",
    "files[0].fields.n.hidden: must be true or false (got \"yes\")",
    "files[0].fields.a.mobile: cannot name the field itself",
    'files[0].fields.b.mobile: "nope" is not a field next to it',
    'files[0].fields.c.mobile: "text" is a text field, not image',
    'files[0].fields.d.mobile: "e" has a phone version of its own',
    'files[0].fields.h.mobile: "k" is already the phone version of g',
    "files[0].fields.l.of.mobile: a phone version by key is a sibling field — an image of a list has none",
  ]);
});

const form = (fields, value, extra = {}) => {
  const window = new Window({ url: "http://localhost/admin" });
  const changes = [];
  const made = createForm({ doc: window.document, fields, value, role: "owner", onChange: (next, path) => changes.push([path.join("."), next]), ...extra });
  window.document.body.append(made.element);
  return { window, form: made, changes, $: (selector) => made.element.querySelector(selector), $$: (selector) => [...made.element.querySelectorAll(selector)] };
};

test("M16 a phone image in a sibling key: one card, Desktop | Mobile; the Mobile slot writes the sibling; the help follows", () => {
  const fields = { hero: f.object({ label: "Hero", fields: {
    image: f.image({ label: "Hero image", mobile: "mobileImage", help: "Choose the desktop hero image." }),
    mobileImage: f.image({ label: "Mobile hero image", help: "Choose the phone-sized hero image." }),
  } }) };
  const picked = [];
  const c = form(fields, { hero: { image: "/a.webp", mobileImage: "" } }, { pickImage: (current, done) => { picked.push(current); done({ src: "/a-phone.webp" }); } });
  assert.equal(c.$('[data-path="hero.mobileImage"]').hidden, true, "the phone version is not a card of its own");
  const card = c.$('[data-path="hero.image"]');
  assert.deepEqual([...card.querySelectorAll(".vc-image-device")].map((button) => button.textContent), ["Desktop", "Mobile"]);
  assert.equal(card.querySelector(":scope > .vc-help").textContent, "Choose the desktop hero image.");
  card.querySelector('[data-device="mobile"]').click();
  assert.equal(card.querySelector(":scope > .vc-help").textContent, "Choose the phone-sized hero image.");
  assert.match(card.querySelector(".vc-image-empty").textContent, /No mobile image — the desktop image is used/);
  card.querySelector(".vc-image-empty").click();
  assert.deepEqual(c.form.value(), { hero: { image: "/a.webp", mobileImage: "/a-phone.webp" } }, "a plain address in the sibling, the desktop one untouched");
  assert.deepEqual(c.changes.map(([path]) => path), ["hero.mobileImage"]);
  card.querySelector('[data-device="desktop"]').click();
  assert.equal(card.querySelector(":scope > .vc-help").textContent, "Choose the desktop hero image.");
});

test("M16 a plugin control writes other fields (setAt) and shows a hidden one's standard box (standardAt)", () => {
  const plugin = { name: "site", controls: {
    "store-phone": ({ doc, value, set, setAt, record }) => {
      const input = doc.createElement("input");
      input.value = String(value ?? "");
      input.addEventListener("input", () => { set(input.value); const href = phoneHrefValue(input.value, "US"); if (href) setAt(["phoneHref"], `tel:${href}`); });
      const note = doc.createElement("p");
      note.className = "note";
      note.textContent = linkOpensText(String(record().phoneHref), "s.example", "US");
      const element = doc.createElement("div");
      element.append(input, note);
      return { element };
    },
    menu: ({ doc, standardAt }) => {
      const element = doc.createElement("div");
      element.className = "composite";
      element.append(standardAt(["more"]));
      return { element };
    },
  } };
  const fields = {
    phone: f.phone({ label: "Store phone number", control: "store-phone" }),
    phoneHref: f.text({ label: "Phone link" }),
    links: f.menu({ label: "Menu", control: "menu" }),
    more: f.menu({ label: "More links", hidden: true }),
  };
  const c = form(fields, { phone: "(215) 772-1111", phoneHref: "tel:+12157721111", links: [], more: [{ label: "Blog", href: "/blog/" }] }, { controls: pluginControls([plugin]) });
  assert.equal(c.$(".note").textContent, "Opens: call (215) 772-1111");
  const input = c.$('[data-path="phone"] input');
  input.value = "(267) 555-0100"; input.dispatchEvent(new c.window.Event("input", { bubbles: true }));
  assert.deepEqual([c.form.value().phone, c.form.value().phoneHref], ["(267) 555-0100", "tel:+12675550100"]);
  assert.equal(c.$('[data-path="phoneHref"] input').value, "tel:+12675550100", "shown where it is");
  const shown = c.$(".composite [data-path='more']");
  assert.ok(shown && !shown.hidden, "the hidden field's standard box, inside the control");
  assert.equal(c.$$("[data-path='more']").filter((element) => element.hidden).length, 1, "its own place stays hidden");
  assert.match(shown.querySelector(".vc-menu-card-title").textContent, /Blog/);
});
