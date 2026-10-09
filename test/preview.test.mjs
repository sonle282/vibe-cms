// P9: the preview bridge on a fake DOM (happy-dom) — which field an element shows (files, records, nested lists),
// the draft applied on load and as it is typed (text, rich text cleaned, images, links, references, list items added
// and hidden), clicks in the preview selecting fields (and nothing else navigating away or submitting), scrolling
// from the form, selector bindings from cms.config, a new record shown in its list, and the pane's addresses.
import assert from "node:assert/strict";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { loadCmsConfig } from "../dist/index.js";
import { attachBridge, bindingPath, configBinds, fieldAt, framedUrl, previewUrl, resolveBinding, resolveList } from "../dist/admin/index.js";
import * as markdown from "../dist/admin/markdown.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config;
before(async () => { config = await loadCmsConfig(join(demoRoot, "cms.config.ts")); });

const PAGE = `
  <header><a href="/" class="brand"><strong>Demo Salon</strong></a><a class="out" href="https://example.com/">Elsewhere</a><a class="in" href="/team/">Team</a></header>
  <section data-cms-section="home">
    <h1 data-cms-field="site.hero.title">Welcome</h1>
    <div data-cms-field="site.hero.text"><p>Old text</p></div>
    <img data-cms-field="site.hero.image" src="/images/hero.svg" alt="Old alt">
    <p data-cms-field="site.tagline">Old tagline</p>
    <ul data-cms-field="site.highlights"><li>Spa Pedicure</li></ul>
  </section>
  <section data-cms-section="contact"><span data-cms-field="site.phone">(555) 010-0000</span><form action="/contact" method="post"><button>Send</button></form></section>
  <footer data-cms-section="footer"><div data-cms-list="site.footerLinks">
    <section data-cms-item-index="0"><h2 data-cms-field="title">Visit</h2>
      <ul data-cms-list="links"><li data-cms-item-index="0"><a data-cms-field="label" data-cms-field-href="href" href="/services/">Services</a></li><li data-cms-item-index="1"><a data-cms-field="label" data-cms-field-href="href" href="/team/">Team</a></li></ul>
    </section>
  </div></footer>
  <ul data-cms-list="services"><li data-cms-item="services:classic-manicure"><strong data-cms-field="name">Classic Manicure</strong> <span data-cms-field="price">$20</span> <span data-cms-field="extras">Gel polish</span></li></ul>`;

const site = () => ({
  name: "Demo Salon", phone: "(555) 010-0000", tagline: "Draft tagline",
  hero: { title: "Draft title", text: "<p>Old text</p>", image: { src: "/images/hero.svg", alt: "Old alt" } },
  highlights: ["spa-pedicure", "classic-manicure"],
  footerLinks: [{ title: "Visit", links: [{ label: "Services", href: "/services/" }, { label: "Team", href: "/team/" }] }],
  seo: { title: "t", description: "d" },
});
const setup = (overrides = {}) => {
  const window = new Window({ url: "http://localhost/?cmsPreview=1" });
  window.document.body.innerHTML = PAGE;
  const selections = [];
  const siteFile = config.files[0];
  const bridge = attachBridge({
    frame: window, doc: window.document, owner: "file:site", value: site(), fields: siteFile.fields,
    binds: configBinds("site", siteFile.fields),
    describe: (owner, path) => `${owner} · ${path.join(".")}`,
    sectionOf: (_owner, path) => siteFile.sections.find((section) => section.fields.some((key) => key.split(".")[0] === path[0]))?.key,
    referenceLabel: (_to, id) => ({ "spa-pedicure": "Spa Pedicure", "classic-manicure": "Classic Manicure" })[id] ?? id,
    onSelect: (selection) => selections.push(selection),
    ...overrides,
  });
  const $ = (selector) => window.document.querySelector(selector);
  const click = (element) => { const event = new window.MouseEvent("click", { bubbles: true, cancelable: true }); element.dispatchEvent(event); return event; };
  return { window, document: window.document, bridge, selections, $, click };
};

test("which field an element shows: files, nested list items, records; paths and field definitions", () => {
  const { document, $ } = setup();
  assert.deepEqual(bindingPath("footerLinks.0.links[1].href"), ["footerLinks", 0, "links", 1, "href"]);
  assert.deepEqual(resolveBinding($("h1")), { owner: "file:site", path: ["hero", "title"] });
  const link = document.querySelectorAll("footer a")[1];
  assert.deepEqual(resolveBinding(link), { owner: "file:site", path: ["footerLinks", 0, "links", 1, "label"] });
  assert.deepEqual(resolveBinding(link, "data-cms-field-href"), { owner: "file:site", path: ["footerLinks", 0, "links", 1, "href"] });
  assert.deepEqual(resolveList(document.querySelector('[data-cms-list="links"]')), { owner: "file:site", path: ["footerLinks", 0, "links"] });
  assert.deepEqual(resolveBinding($('[data-cms-field="price"]')), { owner: "item:services:classic-manicure", path: ["price"] });
  const fields = config.files[0].fields;
  assert.equal(fieldAt(fields, ["seo", "title"]).field.label, "Search title", "dotted keys");
  assert.equal(fieldAt(fields, ["footerLinks", 0, "links", 1, "href"]).field.label, "Address");
  assert.deepEqual(fieldAt(fields, ["hero", "image", "alt"]).rest, ["alt"]);
});

test("on load the draft is shown; typing changes only what shows the changed field", () => {
  const { bridge, $ } = setup();
  assert.equal($("h1").textContent, "Draft title", "the draft, not the published text");
  assert.equal($('[data-cms-field="site.tagline"]').textContent, "Draft tagline");
  assert.equal(bridge.count(), 12, "h1, text, image, tagline, highlights, phone, the name (bind), the footer group title, 2 links × (text + address)");
  const hero = $('[data-cms-field="site.hero.text"]');
  const before = hero.firstChild;
  bridge.update({ ...site(), hero: { ...site().hero, title: "Typed" } }, ["hero", "title"]);
  assert.equal($("h1").textContent, "Typed");
  assert.equal(hero.firstChild, before, "other fields are not re-rendered");
  // The salon name has no attribute in the template: cms.config binds it by selector.
  bridge.update({ ...site(), name: "Bound Salon" }, ["name"]);
  assert.equal($("header .brand strong").textContent, "Bound Salon");
  assert.ok(bridge.stats().updates >= 3 && bridge.stats().maxMs >= 0);
});

test("rich text is cleaned before it is shown; images, links, references and lists", () => {
  const { bridge, $, document } = setup();
  const value = site();
  value.hero.text = '<p>New <b>bold</b></p><img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>';
  bridge.update(value, ["hero", "text"]);
  const hero = $('[data-cms-field="site.hero.text"]');
  assert.equal(hero.innerHTML, '<p>New <strong>bold</strong></p><p><img src="x"><a>x</a></p>');
  assert.equal(document.querySelector("script"), null);
  value.hero.image = { src: "/assets/uploads/2026/03/chair-0123abcd.webp", alt: "A chair" };
  bridge.update(value, ["hero", "image"]);
  assert.deepEqual([$("img[data-cms-field]").getAttribute("src"), $("img[data-cms-field]").getAttribute("alt")], ["/assets/uploads/2026/03/chair-0123abcd.webp", "A chair"]);
  value.hero.image = { src: "javascript:alert(1)", alt: "x" };
  bridge.update(value, ["hero", "image", "src"]);
  assert.equal($("img[data-cms-field]").getAttribute("src"), "/assets/uploads/2026/03/chair-0123abcd.webp", "an unsafe address is never shown");
  value.footerLinks[0].links[1] = { label: "Our team", href: "javascript:alert(1)" };
  bridge.update(value, ["footerLinks", 0, "links", 1]);
  const link = document.querySelectorAll("footer a")[1];
  assert.deepEqual([link.textContent, link.getAttribute("href")], ["Our team", "/team/"]);
  value.highlights = ["classic-manicure", "spa-pedicure", "nail-art"];
  bridge.update(value, ["highlights"]);
  assert.deepEqual([...document.querySelectorAll('[data-cms-field="site.highlights"] li')].map((li) => li.textContent), ["Classic Manicure", "Spa Pedicure", "nail-art"]);
});

test("list items: a new item is a copy of the first (its own lists follow its value); removed items are hidden", () => {
  const { bridge, document } = setup();
  const value = site();
  value.footerLinks.push({ title: "Legal", links: [] });
  bridge.update(value, ["footerLinks"]);
  const groups = [...document.querySelectorAll("footer section[data-cms-item-index]")];
  assert.equal(groups.length, 2);
  assert.equal(groups[1].querySelector("h2").textContent, "Legal");
  assert.deepEqual([...groups[1].querySelectorAll("li")].map((li) => li.hidden), [true, true], "the copy's links are hidden: the new group has none");
  value.footerLinks[1].links.push({ label: "Privacy", href: "/privacy/" });
  bridge.update(value, ["footerLinks", 1, "links"]);
  assert.deepEqual([...groups[1].querySelectorAll("li")].map((li) => [li.hidden, li.textContent]), [[false, "Privacy"], [true, "Team"]]);
  value.footerLinks.splice(0, 1);
  bridge.update(value, ["footerLinks"]);
  assert.deepEqual([...document.querySelectorAll("footer section[data-cms-item-index]")].map((group) => [group.hidden, group.querySelector("h2").textContent]), [[false, "Legal"], [true, "Legal"]]);
});

test("clicks: a bound element is selected and opened (never followed); other sites and forms do nothing", () => {
  const { bridge, selections, $, click, document } = setup();
  const event = click($("h1"));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(selections.map(({ owner, path }) => [owner, path]), [["file:site", ["hero", "title"]]]);
  const chip = document.querySelector("[data-vibe-cms-preview] span");
  assert.equal(chip.textContent, "file:site · hero.title");
  // Another record's content on the same page: reported with its owner (the admin opens that record).
  click($('[data-cms-field="price"]'));
  assert.deepEqual(selections.at(-1).owner, "item:services:classic-manicure");
  click($("footer a"));
  assert.deepEqual(selections.at(-1).path, ["footerLinks", 0, "links", 0, "label"]);
  assert.equal(click($("a.out")).defaultPrevented, true, "a link to another site is not followed");
  assert.equal(click($("a.in")).defaultPrevented, false, "a page of this site opens in the preview");
  const submit = new document.defaultView.Event("submit", { bubbles: true, cancelable: true });
  $("form").dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true, "forms are never sent from the preview");
  // From the form: scroll + outline, no report back.
  const count = selections.length;
  assert.equal(bridge.scrollTo(["phone"]), true);
  assert.equal(selections.length, count);
  assert.equal(chip.textContent, "file:site · phone");
  assert.equal(bridge.scrollTo(["seo", "title"]), false, "not on this page");
  bridge.detach();
  assert.equal(document.querySelector("[data-vibe-cms-preview]"), null);
  assert.equal(click($("h1")).defaultPrevented, false, "detached: the page is left as it was");
});

test("a new record is shown where its collection is listed, following its id as it is typed", () => {
  const services = config.collections.find((collection) => collection.key === "services");
  const { bridge, document } = setup({ owner: "item:services:new", value: {}, fields: services.fields, newItem: { collection: "services" }, binds: [] });
  const items = () => [...document.querySelectorAll('[data-cms-list="services"] > li')];
  assert.equal(items().length, 2);
  assert.equal(items()[1].getAttribute("data-cms-item"), "services:new");
  bridge.update({ id: "gel-removal", name: "Gel Removal", price: "$10", extras: ["Oil"] }, ["name"], "item:services:gel-removal");
  assert.equal(items()[1].getAttribute("data-cms-item"), "services:gel-removal");
  assert.deepEqual([...items()[1].querySelectorAll("[data-cms-field]")].map((element) => element.textContent), ["Gel Removal", "$10", "Oil"]);
  assert.equal(items()[0].querySelector("strong").textContent, "Classic Manicure", "the others stay");
  bridge.detach();
  assert.equal(items().length, 1, "the copy goes with the preview");
});

test("a Markdown body is shown as HTML (the converter loads when needed), cleaned", async () => {
  const window = new Window({ url: "http://localhost/blog/welcome/" });
  window.document.body.innerHTML = '<article data-cms-item="posts:welcome"><h1 data-cms-field="title">Old</h1><div data-cms-field="body"><p>Old</p></div></article>';
  let loads = 0;
  const posts = config.collections.find((collection) => collection.key === "posts");
  const fields = { ...posts.fields, body: { type: "richText", label: "Text" } };
  const bridge = attachBridge({ frame: window, doc: window.document, owner: "item:posts:welcome", value: { title: "New", body: "Hello **there**\n\n<script>x</script>\n" }, fields, markdown: ["body"], describe: () => "", onSelect: () => {}, loadMarkdown: async () => { loads += 1; return markdown; } });
  for (let i = 0; i < 20 && loads === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector("h1").textContent, "New");
  assert.equal(window.document.querySelector('[data-cms-field="body"]').innerHTML.trim(), "<p>Hello <strong>there</strong></p>");
  bridge.update({ title: "New", body: 'Two <img src="/a.webp" alt="A" width="300">\n' }, ["body"]);
  assert.equal(window.document.querySelector('[data-cms-field="body"]').innerHTML.trim(), '<p>Two <img src="/a.webp" alt="A" width="300"></p>');
  assert.equal(loads, 1);
});

test("the pane's address: the record's own page from its fields, with cmsPreview=1", () => {
  assert.equal(previewUrl("/blog/{slug}/", { slug: "welcome" }), "/blog/welcome/");
  assert.equal(previewUrl("/blog/{slug}/", { slug: "a b/c" }), "/blog/a%20b%2Fc/");
  assert.equal(previewUrl("/blog/{slug}/", {}), undefined);
  assert.equal(previewUrl("/services/", {}), "/services/");
  assert.equal(framedUrl("/services/"), "/services/?cmsPreview=1");
  assert.equal(framedUrl("/search?q=x"), "/search?q=x&cmsPreview=1");
});
