// P2: the content check — the files a config declares exist, parse, and match the field types (runs against dist/).
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkContent, CmsConfigError, checkSite, f, loadCmsConfig } from "../dist/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));

/** A copy of the demo site's config + content in a temp folder; edit(root) changes files before the check. */
const withSite = async (edit, run) => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-content-"));
  try {
    cpSync(join(demoRoot, "src/data"), join(root, "src/data"), { recursive: true });
    const config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
    await edit?.(root, config);
    return await run(root, config);
  } finally { rmSync(root, { recursive: true, force: true }); }
};
const json = (root, rel, data) => writeFileSync(join(root, rel), typeof data === "string" ? data : JSON.stringify(data, null, 2));
const services = () => [
  { id: "classic-manicure", name: "Classic Manicure", price: "$20", category: "Nails", extras: ["Gel polish"] },
  { id: "spa-pedicure", name: "Spa Pedicure", price: "$35", category: "Spa", extras: [] },
];
const find = (list, path) => list.find((problem) => problem.path === path);
const expectOne = (list, path, pattern) => {
  const hit = find(list, path);
  assert.ok(hit, `expected ${path}; got:\n${list.map((p) => `${p.path}: ${p.message}`).join("\n") || "(none)"}`);
  if (pattern) assert.match(`${hit.message}${hit.hint ? ` → ${hit.hint}` : ""}`, pattern);
};

test("the demo site's content matches its config: 0 errors, 0 warnings", async () => {
  const config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  assert.deepEqual(checkContent(config, demoRoot), { errors: [], warnings: [] });
});

test("a price stored as a number where the config says text is an error with a fix", async () => {
  await withSite((root) => { const list = services(); list[1].price = 35; json(root, "src/data/services.json", list); }, (root, config) => {
    const { errors } = checkContent(config, root);
    assert.equal(errors.length, 1);
    expectOne(errors, 'src/data/services.json[1] ("spa-pedicure").price', /expected text, got number 35 → write it in quotes: "35"/);
  });
});

test("a missing required value is an error", async () => {
  await withSite((root) => { const list = services(); delete list[0].name; json(root, "src/data/services.json", list); }, (root, config) => {
    expectOne(checkContent(config, root).errors, 'src/data/services.json[0] ("classic-manicure").name', /required \("Name"\) but missing/);
  });
});

test("a property the config does not declare is a warning only", async () => {
  await withSite((root) => { const list = services(); list[0].popular = true; json(root, "src/data/services.json", list); }, (root, config) => {
    const { errors, warnings } = checkContent(config, root);
    assert.deepEqual(errors, []);
    expectOne(warnings, 'src/data/services.json[0] ("classic-manicure").popular', /not in cms\.config/);
  });
});

test("a declared file that does not exist", async () => {
  await withSite((root) => rmSync(join(root, "src/data/site.json")), (root, config) => {
    expectOne(checkContent(config, root).errors, "src/data/site.json", /not found \(declared at files\[0\]\.path\)/);
  });
});

test("a file that is not valid JSON", async () => {
  await withSite((root) => json(root, "src/data/services.json", '[{ "id": "a", }]'), (root, config) => {
    expectOne(checkContent(config, root).errors, "src/data/services.json", /is not valid JSON/);
  });
});

test("a json-array file must hold a list, with unique ids", async () => {
  await withSite((root) => json(root, "src/data/services.json", { id: "x" }), (root, config) => {
    expectOne(checkContent(config, root).errors, "src/data/services.json", /expected a list of records/);
  });
  await withSite((root) => { const list = services(); list[1].id = "classic-manicure"; list.push({ name: "No id" }); json(root, "src/data/services.json", list); }, (root, config) => {
    const { errors } = checkContent(config, root);
    expectOne(errors, "src/data/services.json[1].id", /used twice/);
    expectOne(errors, "src/data/services.json[2].id", /required — the record id/);
  });
});

test("select values must be one of the options", async () => {
  await withSite((root) => { const list = services(); list[0].category = "Hair"; json(root, "src/data/services.json", list); }, (root, config) => {
    expectOne(checkContent(config, root).errors, 'src/data/services.json[0] ("classic-manicure").category', /"Hair" is not one of the options → use "Nails", "Spa"/);
  });
});

test("opening hours follow the declared row format", async () => {
  await withSite((root, config) => {
    const site = { name: "Demo", phone: "1", email: "a@b.example", address: { street: "1", city: "X" }, tagline: "t", hero: { title: "T", text: "x" },
      hours: [{ days: [1, 2], open: "9am", close: "17:00" }, { days: [2], open: "10:00", close: "09:00" }, { days: [7], closed: true }] };
    json(root, "src/data/site.json", site);
  }, (root, config) => {
    const { errors } = checkContent(config, root);
    expectOne(errors, "src/data/site.json.hours[0].open", /24-hour time "HH:MM", got text "9am"/);
    expectOne(errors, "src/data/site.json.hours[1].days", /day 2 is also in row 0/);
    expectOne(errors, "src/data/site.json.hours[1]", /opens at 10:00 but closes at 09:00/);
    expectOne(errors, "src/data/site.json.hours[2].days", /day numbers 0–6/);
  });
});

test("lists: must be a list and respect min / max", async () => {
  await withSite((root) => { const list = services(); list[0].extras = "Gel polish"; json(root, "src/data/services.json", list); }, (root, config) => {
    expectOne(checkContent(config, root).errors, 'src/data/services.json[0] ("classic-manicure").extras', /expected a list, got text "Gel polish" → wrap it in \[ \]/);
  });
  await withSite((root, config) => { config.collections[0].fields.extras.max = 1; }, (root, config) => {
    expectOne(checkContent(config, root).errors, 'src/data/services.json[1] ("spa-pedicure").extras', /has 2 items, more than max 1/);
  });
});

test("text maxLength and objects", async () => {
  await withSite((root) => { json(root, "src/data/site.json", { name: "x".repeat(61), phone: "1", email: "a@b.example", address: "1 Example Street", tagline: "t", hours: [], hero: { title: "T", text: "x" } }); }, (root, config) => {
    const { errors } = checkContent(config, root);
    expectOne(errors, "src/data/site.json.name", /61 characters, longer than maxLength 60/);
    expectOne(errors, "src/data/site.json.address", /expected an object, got text/);
  });
});

test("references must point to existing records", async () => {
  await withSite((root, config) => {
    config.collections[0].fields.related = f.reference({ label: "Related", to: "services", multiple: true });
    const list = services(); list[0].related = ["spa-pedicure", "gel-x"]; list[1].related = "classic-manicure";
    json(root, "src/data/services.json", list);
  }, (root, config) => {
    const { errors } = checkContent(config, root);
    expectOne(errors, 'src/data/services.json[0] ("classic-manicure").related[1]', /no "services" record has id "gel-x"/);
    expectOne(errors, 'src/data/services.json[1] ("spa-pedicure").related', /expected a list of "services" ids/);
    assert.equal(errors.length, 2);
  });
});

test("images: a path or { src, alt }", async () => {
  await withSite((root, config) => {
    config.files[0].fields.hero.fields.image = f.image({ label: "Image", alt: true });
    json(root, "src/data/site.json", { name: "D", phone: "1", email: "a@b.example", address: { street: "1", city: "X" }, tagline: "t", hours: [], hero: { title: "T", text: "x", image: { src: "/a.jpg" } } });
  }, (root, config) => {
    const { errors, warnings } = checkContent(config, root);
    assert.deepEqual(errors, []);
    expectOne(warnings, "src/data/site.json.hero.image.alt", /is empty/);
  });
  await withSite((root, config) => {
    config.files[0].fields.hero.fields.image = f.image({ label: "Image" });
    json(root, "src/data/site.json", { name: "D", phone: "1", email: "a@b.example", address: { street: "1", city: "X" }, tagline: "t", hours: [], hero: { title: "T", text: "x", image: 42 } });
  }, (root, config) => {
    expectOne(checkContent(config, root).errors, "src/data/site.json.hero.image", /expected an image path/);
  });
});

test("dotted field keys read nested values", async () => {
  await withSite((root, config) => {
    config.files[0].fields = { "hero.title": f.text({ label: "Heading", required: true }) };
    json(root, "src/data/site.json", { hero: { title: 7 } });
  }, (root, config) => {
    expectOne(checkContent(config, root).errors, "src/data/site.json.hero.title", /expected text, got number 7/);
  });
});

test("markdown-dir: front matter is parsed; slugs unique; broken files named", async () => {
  await withSite((root, config) => {
    config.collections.push({ key: "blog", label: "Blog", itemLabel: "Post", store: { kind: "markdown-dir", dir: "src/content/blog", slugField: "slug" },
      status: { field: "status", live: "published", draft: "draft" }, fields: { title: f.text({ label: "Title", required: true }), body: f.richText({ label: "Text" }) } });
    mkdirSync(join(root, "src/content/blog"), { recursive: true });
    writeFileSync(join(root, "src/content/blog/a.md"), "---\nslug: hello\ntitle: Hello\nstatus: published\n---\nBody text\n");
    writeFileSync(join(root, "src/content/blog/b.md"), "---\nslug: hello\ntitle: 5\nstatus: live\n---\n");
    writeFileSync(join(root, "src/content/blog/c.md"), "No front matter here\n");
    writeFileSync(join(root, "src/content/blog/d.md"), "---\nslug: [unclosed\n---\n");
  }, (root, config) => {
    const { errors } = checkContent(config, root);
    expectOne(errors, "src/content/blog/b.md (front matter).slug", /id "hello" is used twice/);
    expectOne(errors, "src/content/blog/b.md (front matter).title", /expected text, got number 5/);
    expectOne(errors, "src/content/blog/b.md (front matter).status", /neither live \("published"\) nor draft/);
    expectOne(errors, "src/content/blog/c.md", /has no front matter/);
    expectOne(errors, "src/content/blog/d.md", /front matter is not valid/);
    assert.equal(find(errors, "src/content/blog/a.md (front matter).title"), undefined);
  });
});

test("checkSite stops on content errors with every problem listed", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-site-"));
  try {
    cpSync(join(demoRoot, "src/data"), join(root, "src/data"), { recursive: true });
    const configModule = fileURLToPath(new URL("../dist/config/index.js", import.meta.url)).replace(/\\/g, "/");
    writeFileSync(join(root, "cms.config.ts"), readFileSync(join(demoRoot, "cms.config.ts"), "utf8").replace("@sonle282/vibe-cms/config", configModule));
    const list = services(); list[0].price = 20; list[1].category = "Hair";
    json(root, "src/data/services.json", list);
    const warnings = [];
    await assert.rejects(checkSite(join(root, "cms.config.ts"), { onWarnings: (items) => warnings.push(...items) }), (error) => {
      assert.ok(error instanceof CmsConfigError);
      assert.match(error.message, /cms\.config\.ts does not match the content \(2 problems\)/);
      assert.match(error.message, /price: expected text, got number 20 → write it in quotes: "20"/);
      assert.match(error.message, /category: text "Hair" is not one of the options/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
