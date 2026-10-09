// P8: the change summary shown before publishing — every field type of the demo site, in the form's words.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { f, loadCmsConfig } from "../dist/index.js";
import { adminBoot, describeChange, editorFields, formatHours, summarizeChanges } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let site; let services; let team; let boot;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  site = JSON.parse(readFileSync(join(demoRoot, "src/data/site.json"), "utf8"));
  services = JSON.parse(readFileSync(join(demoRoot, "src/data/services.json"), "utf8"));
  team = JSON.parse(readFileSync(join(demoRoot, "src/data/team.json"), "utf8"));
  boot = adminBoot(config, { id: "usr_a", username: "a", displayName: "A", role: "owner" });
});
const references = () => ({ services: Object.fromEntries(services.map((item) => [item.id, item.name])) });
const lines = (changes) => changes.map(describeChange);
const clone = (value) => JSON.parse(JSON.stringify(value));

test("no change → nothing to say", () => {
  assert.deepEqual(summarizeChanges({ fields: config.files[0].fields, before: site, after: clone(site) }), []);
  assert.deepEqual(summarizeChanges({ fields: config.files[0].fields, before: { tagline: "" }, after: {} }), [], "empty and missing are the same");
});

test("salon info: text, owner-only fields, objects, images, dotted keys — labelled as in the form", () => {
  const after = clone(site);
  after.name = "Demo Salon & Spa";
  after.phone = "(555) 010-0001";
  after.address.street = "2 Example Street";
  after.hero.title = "Hello";
  after.hero.text = "<p>Everything here is <em>invented</em>.</p>";
  after.hero.image = { src: "/images/new.svg", alt: "A blue square" };
  after.seo.description = "New description.";
  const changes = summarizeChanges({ fields: config.files[0].fields, before: site, after, references: references() });
  assert.deepEqual(lines(changes), [
    "Salon name: Demo Salon → Demo Salon & Spa",
    "Phone: (555) 010-0000 → (555) 010-0001",
    "Address › Street: 1 Example Street → 2 Example Street",
    "Banner › Heading: Welcome to Demo Salon → Hello",
    "Banner › Text: Everything is invented. → Everything here is invented.",
    "Banner › Picture: /images/hero.svg → /images/new.svg",
    "Banner › Picture › alt text: A pastel drawing of a nail polish bottle → A blue square",
    "Search description: A made-up salon used to test Vibe CMS. → New description.",
  ].map((line) => line.replace("Everything is invented.", "Everything on this site is invented.")));
  assert.deepEqual(changes.filter((change) => change.locked).map((change) => change.path), ["phone", "address.street"], "owner-only fields are marked");
  assert.equal(changes.find((change) => change.label === "Search description").path, "seo.description");
});

test("hours: shown as readable rows", () => {
  assert.equal(formatHours(site.hours), "Mon–Fri 09:00–19:00 · Sat 09:00–17:00 · Sun closed");
  const after = clone(site);
  after.hours[0].close = "18:30";
  const [change] = summarizeChanges({ fields: config.files[0].fields, before: site, after });
  assert.equal(describeChange(change), "Opening hours: Mon–Fri 09:00–19:00 · Sat 09:00–17:00 · Sun closed → Mon–Fri 09:00–18:30 · Sat 09:00–17:00 · Sun closed");
  assert.equal(change.locked, true);
});

test("references: added, removed and re-ordered records by name; a single reference by name", () => {
  const after = clone(site);
  after.highlights = ["classic-manicure", "nail-art"];
  assert.deepEqual(lines(summarizeChanges({ fields: config.files[0].fields, before: site, after, references: references() })), [
    "Featured services: added “Nail Art”",
    "Featured services: removed “Spa Pedicure”",
  ]);
  const reordered = { ...clone(site), highlights: ["classic-manicure", "spa-pedicure"] };
  assert.deepEqual(lines(summarizeChanges({ fields: config.files[0].fields, before: site, after: reordered, references: references() })), ["Featured services: new order — Classic Manicure, Spa Pedicure"]);
  const alex = { ...clone(team[0]), specialty: "spa-pedicure" };
  assert.deepEqual(lines(summarizeChanges({ fields: config.collections[1].fields, before: team[0], after: alex, references: references() })), ["Specialty: Nail Art → Spa Pedicure"]);
});

test("lists: a re-order is one change; items added / removed / changed are named; nested lists", () => {
  const spa = services[1];
  const fields = config.collections[0].fields;
  assert.deepEqual(lines(summarizeChanges({ fields, before: spa, after: { ...spa, extras: ["Paraffin", "Hot stones"] } })), ["Extras: new order — Paraffin, Hot stones"]);
  assert.deepEqual(lines(summarizeChanges({ fields, before: spa, after: { ...spa, extras: ["Paraffin", "Foot mask"] } })), ["Extras › Extra 2: Hot stones → Foot mask"], "Paraffin is matched by content; the other slot changed");
  const removed = summarizeChanges({ fields, before: spa, after: { ...spa, extras: ["Paraffin"] } });
  assert.deepEqual(lines(removed), ["Extras › Extra: removed “Hot stones”"]);
  const added = summarizeChanges({ fields, before: spa, after: { ...spa, extras: [...spa.extras, "Foot mask"] } });
  assert.deepEqual(lines(added), ["Extras › Extra: added “Foot mask”"]);

  const after = clone(site);
  after.footerLinks[0].links.push({ label: "Blog", href: "/blog/" });
  after.footerLinks[0].links[0].href = "/services";
  after.footerLinks.push({ title: "Legal", links: [] });
  assert.deepEqual(lines(summarizeChanges({ fields: config.files[0].fields, before: site, after })), [
    "Footer links › Group 1 (Visit) › Links › Link 1 (Services) › Address: /services/ → /services",
    "Footer links › Group 1 (Visit) › Links › Link: added “Blog”",
    "Footer links › Group: added “Legal”",
  ]);
  // A link replaced by a wholly different one is "removed" + "added", not an edit of the old one.
  const replaced = clone(site);
  replaced.footerLinks[0].links = [{ label: "Blog", href: "/blog/" }, { label: "Team", href: "/team/" }];
  assert.deepEqual(lines(summarizeChanges({ fields: config.files[0].fields, before: site, after: replaced })), [
    "Footer links › Group 1 (Visit) › Links › Link: added “Blog”",
    "Footer links › Group 1 (Visit) › Links › Link: removed “Services”",
  ]);
});

test("records: a new record is one line; a Markdown body change uses the editor's fields; keys the form does not know are mentioned", () => {
  const posts = boot.collections.find((collection) => collection.key === "posts");
  const fields = editorFields({ kind: "item", collection: posts, isNew: false });
  const welcome = { slug: "welcome", title: "Welcome", status: "published", body: "Old body\n" };
  assert.deepEqual(lines(summarizeChanges({ fields, before: welcome, after: { ...welcome, status: "draft", body: "New body\n" } })), ["Status: published → draft", "Text: Old body → New body"]);
  const gel = { id: "gel", name: "Gel Removal" };
  assert.deepEqual(lines(summarizeChanges({ fields: config.collections[0].fields, before: undefined, after: gel, newRecord: { itemLabel: "Service", title: "Gel Removal" } })), ["New service: Gel Removal"]);
  assert.deepEqual(lines(summarizeChanges({ fields: { name: f.text({ label: "Name" }) }, before: { name: "x", extra: 1 }, after: { name: "x", extra: 2 } })), ["extra (not in the form): 1 → 2"]);
});

test("P8d: rich text — words without Markdown symbols, and each image added, removed, resized or re-described", async () => {
  const { imagesIn, plainText } = await import("../dist/admin/index.js");
  const fields = { body: { type: "richText", label: "Text" } };
  const run = (before, after) => lines(summarizeChanges({ fields, before: { body: before }, after: { body: after } }));
  assert.equal(plainText("New **body** text.\n\n## Hours\n\n- Mon\n- [Sat](/sat)\n").replace(/\s+/g, " ").trim(), "New body text. Hours Mon Sat");
  assert.deepEqual(imagesIn('a <img src="/a.webp" alt="A chair" width="438"> ![B](/b.webp "t") <IMG SRC=/c.png>'), [{ src: "/a.webp", alt: "A chair", width: "438" }, { src: "/c.png", alt: "", width: "" }, { src: "/b.webp", alt: "B", width: "" }]);
  assert.deepEqual(run("Hello\n", 'Hello there\n\n<img src="/a.webp" alt="Chair" width="438">\n'), ["Text: Hello → Hello there", "Text › image: added “/a.webp”"]);
  assert.deepEqual(run('<p>Hi <img src="/a.webp" alt="Chair" width="438"></p>', '<p>Hi <img src="/a.webp" alt="A chair"></p>'), ["Text › image size: 438 px wide → original size", "Text › image alt text: Chair → A chair"]);
  assert.deepEqual(run("Hi ![x](/b.webp)\n", "Hi\n"), ["Text › image: removed “/b.webp”"]);
  assert.deepEqual(run("Hello\n", "**Hello**\n"), ["Text: Hello → Hello (new formatting)"]);
});
