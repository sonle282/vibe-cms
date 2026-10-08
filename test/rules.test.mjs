// P2: every cms.config rule has at least one wrong case (runs against the built dist/). Each case changes a valid base
// config and expects an error (or warning) at an exact path.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCmsConfig, f, MAX_DEPTH } from "../dist/config/index.js";

const base = () => ({
  configVersion: 1,
  site: { name: "Demo Salon", url: "https://demo.example", timezone: "America/New_York" },
  repo: { owner: "sonle282", name: "vibe-cms-demo", branch: "main" },
  roles: ["owner", "editor"],
  files: [{
    key: "site", label: "Salon info", path: "src/data/site.json", format: "json", preview: "/",
    sections: [{ key: "contact", label: "Contact", fields: ["phone", "hours"] }, { key: "home", label: "Home", fields: ["hero"] }],
    fields: {
      phone: f.text({ label: "Phone", locked: "owner" }),
      hours: f.hours({ label: "Hours", locked: "owner" }),
      hero: f.object({ label: "Banner", fields: { title: f.text({ label: "Heading" }), image: f.image({ label: "Image", alt: true }) } }),
    },
  }],
  collections: [{
    key: "services", label: "Services", itemLabel: "Service", preview: "/services/{id}/",
    store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
    status: { field: "status", live: "published", draft: "draft" }, order: { by: "name" },
    fields: {
      name: f.text({ label: "Name", required: true }),
      price: f.text({ label: "Price", locked: "owner" }),
      status: f.select({ label: "Status", options: ["published", "draft"] }),
      category: f.select({ label: "Category", options: ["Nails", "Spa"] }),
      items: f.list(f.object({ label: "Item", fields: { name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "owner" }) } }), { label: "Items", ordered: true, min: 0, max: 20 }),
      related: f.reference({ label: "Related", to: "services", multiple: true, ordered: true }),
    },
  }, {
    key: "blog", label: "Blog", itemLabel: "Post", preview: "/blog/{slug}/",
    store: { kind: "markdown-dir", dir: "src/content/blog", slugField: "slug" },
    fields: { title: f.text({ label: "Title" }), body: f.richText({ label: "Text" }) },
  }],
  media: { dir: "public/assets/uploads", maxBytes: 10_000_000 },
});

const paths = (list) => list.map((problem) => problem.path);
const expectError = (change, path, pattern) => {
  const config = base();
  change(config);
  const { errors } = checkCmsConfig(config);
  const hit = errors.find((problem) => problem.path === path);
  assert.ok(hit, `expected an error at ${path}; got:\n${errors.map((e) => `${e.path}: ${e.message}`).join("\n") || "(none)"}`);
  if (pattern) assert.match(`${hit.message}${hit.hint ? ` → ${hit.hint}` : ""}`, pattern);
  return hit;
};
const rule = (name, change, path, pattern) => test(name, () => { expectError(change, path, pattern); });

test("the valid base config and the demo shape pass with no errors and no warnings", () => {
  const { errors, warnings } = checkCmsConfig(base());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// Top level, site, repo
rule("configVersion must be 1", (c) => { c.configVersion = 2; }, "configVersion", /must be 1 \(got 2\)/);
rule("unknown top-level setting (typo)", (c) => { c.colections = []; }, "colections", /unknown setting → allowed: configVersion/);
rule("site is required", (c) => { delete c.site; }, "site", /required/);
rule("site.url must be a full http(s) address", (c) => { c.site.url = "demo.example"; }, "site.url", /full http\(s\) address/);
rule("site.timezone must be an IANA zone", (c) => { c.site.timezone = "Mars/Base"; }, "site.timezone", /unknown time zone/);
rule("repo is required", (c) => { delete c.repo; }, "repo", /required/);
rule("repo.owner must be a GitHub name", (c) => { c.repo.owner = "-bad-"; }, "repo.owner", /not a GitHub user/);
rule("repo.name must not end in .git", (c) => { c.repo.name = "site.git"; }, "repo.name", /not a repository name/);
rule("repo.branch is required", (c) => { c.repo.branch = ""; }, "repo.branch", /required — the production branch/);
rule('repo.branch: no ".."', (c) => { c.repo.branch = "feature..x"; }, "repo.branch", /not a valid branch name: it has "\.\."/);
rule("repo.branch: no spaces", (c) => { c.repo.branch = "my branch"; }, "repo.branch", /space/);
rule('repo.branch: no ".lock" part', (c) => { c.repo.branch = "release/x.lock"; }, "repo.branch", /\.lock/);
rule("roles are fixed to owner + editor", (c) => { c.roles = ["owner", "admin"]; }, "roles", /must be \["owner", "editor"\]/);
rule("media.dir is a folder inside public/", (c) => { c.media.dir = "src/uploads"; }, "media.dir", /folder inside public\//);
rule("media.dir has no '..'", (c) => { c.media.dir = "public/../secrets"; }, "media.dir", /folder inside public\//);
rule("media.maxBytes at most 25 MiB", (c) => { c.media.maxBytes = 100_000_000; }, "media.maxBytes", /1 to 26214400/);
rule("media has no unknown settings", (c) => { c.media.bucketPrefix = "demo/"; }, "media.bucketPrefix", /not a media setting/);
rule("contentDirs must stay inside the project", (c) => { c.contentDirs = ["../outside"]; }, "contentDirs[0]", /must not contain "\.\."/);

// Files and paths
rule("files must be a list", (c) => { c.files = {}; }, "files", /required — a list/);
rule("file key format", (c) => { c.files[0].key = "Site Info"; }, "files[0].key", /not a valid key/);
rule("keys are unique across files and collections", (c) => { c.collections[0].key = "site"; c.collections[0].fields.related.to = "site"; }, "collections[0].key", /already used by files\[0\]/);
rule("file label is required", (c) => { delete c.files[0].label; }, "files[0].label", /required/);
rule("file path is required", (c) => { delete c.files[0].path; }, "files[0].path", /required — the content file → e\.g\. "src\/data\/site\.json"/);
rule("path: not absolute", (c) => { c.files[0].path = "/src/data/site.json"; }, "files[0].path", /must be relative to the project root/);
rule("path: Windows drive is absolute too", (c) => { c.files[0].path = "C:/site/src/data/site.json"; }, "files[0].path", /must be relative/);
rule('path: no ".."', (c) => { c.files[0].path = "src/data/../../secrets.json"; }, "files[0].path", /must not contain "\.\."/);
rule('path: "/" not "\\"', (c) => { c.files[0].path = "src\\data\\site.json"; }, "files[0].path", /use "\/" between folders/);
rule("path: inside src/data or src/content", (c) => { c.files[0].path = "public/site.json"; }, "files[0].path", /must be inside "src\/data\/" or "src\/content\/"/);
rule("path: YAML is not supported", (c) => { c.files[0].path = "src/data/site.yaml"; }, "files[0].path", /YAML is not supported → store the content as JSON/);
rule("format: only json", (c) => { c.files[0].format = "yaml"; }, "files[0].format", /YAML is not supported/);
rule("a content path belongs to one entry", (c) => { c.collections[0].store.path = "src/data/site.json"; }, "collections[0].store.path", /already used by files\[0\]/);
rule("file preview starts with /", (c) => { c.files[0].preview = "home"; }, "files[0].preview", /starting with "\/"/);
rule("section fields must exist", (c) => { c.files[0].sections[0].fields.push("fax"); }, "files[0].sections[0].fields[2]", /"fax" is not a field of this file/);
rule("section keys are unique", (c) => { c.files[0].sections[1].key = "contact"; }, "files[0].sections[1].key", /used by another section/);
rule("a field belongs to one section", (c) => { c.files[0].sections[1].fields.push("phone"); }, "files[0].sections[1].fields[1]", /already in files\[0\]\.sections\[0\]/);

test("contentDirs adds an allowed folder", () => {
  const config = base();
  config.contentDirs = ["src/pages-data"];
  config.files[0].path = "src/pages-data/site.json";
  assert.deepEqual(paths(checkCmsConfig(config).errors), []);
});

test("a field in no section is a warning, not an error", () => {
  const config = base();
  config.files[0].fields.tagline = f.text({ label: "Tagline" });
  const { errors, warnings } = checkCmsConfig(config);
  assert.deepEqual(errors, []);
  assert.deepEqual(paths(warnings), ["files[0].sections"]);
  assert.match(warnings[0].message, /"tagline" is in no section/);
});

// Fields
rule("every field needs a label", (c) => { c.files[0].fields.phone = { type: "text" }; }, "files[0].fields.phone.label", /required — the name editors see/);
rule("nested fields need a label too", (c) => { delete c.collections[0].fields.items.of.fields.name.label; }, "collections[0].fields.items.of.fields.name.label", /required/);
rule("unknown field type", (c) => { c.files[0].fields.phone = { type: "colour", label: "Colour" }; }, "files[0].fields.phone.type", /unknown field type "colour" → use one of text, richText/);
rule("unknown option (typo) on a field", (c) => { c.files[0].fields.phone.lockd = "owner"; }, "files[0].fields.phone.lockd", /unknown option for a text field → allowed: label, help, required, locked, bind, maxLength, multiline/);
rule('locked only accepts "owner" (deep path)', (c) => { c.collections[0].fields.items.of.fields.price.locked = "admin"; }, "collections[0].fields.items.of.fields.price.locked", /only "owner" is allowed \(got "admin"\)/);
rule("required is true / false", (c) => { c.collections[0].fields.name.required = "yes"; }, "collections[0].fields.name.required", /true or false/);
rule("text maxLength is a whole number ≥ 1", (c) => { c.files[0].fields.phone.maxLength = 0; }, "files[0].fields.phone.maxLength", /whole number ≥ 1/);
rule("select needs options", (c) => { c.collections[0].fields.category.options = []; }, "collections[0].fields.category.options", /at least one option/);
rule("select options are unique", (c) => { c.collections[0].fields.category.options = ["Nails", "Nails"]; }, "collections[0].fields.category.options[1]", /listed twice/);
rule("hours has no extra options", (c) => { c.files[0].fields.hours.format = "12h"; }, "files[0].fields.hours.format", /unknown option for a hours field/);
rule("list needs an item type", (c) => { delete c.collections[0].fields.items.of; }, "collections[0].fields.items.of", /required — the kind of item/);
rule("list min ≤ max", (c) => { c.collections[0].fields.items.min = 5; c.collections[0].fields.items.max = 2; }, "collections[0].fields.items.min", /bigger than max/);
rule("list item type is checked too", (c) => { c.collections[0].fields.items.of = { type: "table", label: "X" }; }, "collections[0].fields.items.of.type", /unknown field type/);
rule("object needs fields", (c) => { delete c.files[0].fields.hero.fields; }, "files[0].fields.hero.fields", /at least one field/);
rule("object fields may not be empty", (c) => { c.files[0].fields.hero.fields = {}; }, "files[0].fields.hero.fields", /at least one field/);
rule("reference points to a real collection", (c) => { c.collections[0].fields.related.to = "products"; }, "collections[0].fields.related.to", /no collection has key "products" → use one of "services", "blog"/);
rule("field keys are identifiers", (c) => { c.files[0].fields["first name"] = f.text({ label: "First name" }); }, 'files[0].fields["first name"]', /not a valid field key/);
rule("a dotted key may not clash with a field at the same level", (c) => { c.files[0].fields["hero.title"] = f.text({ label: "Title" }); }, 'files[0].fields["hero.title"]', /clashes with the field "hero"/);

test(`nesting deeper than ${MAX_DEPTH} levels is an error; ${MAX_DEPTH} is fine`, () => {
  const nest = (levels) => { let field = f.text({ label: "Leaf" }); for (let i = 0; i < levels; i += 1) field = i % 2 ? f.list(field, { label: `L${i}` }) : f.object({ label: `O${i}`, fields: { x: field } }); return field; };
  const ok = base(); ok.files[0].fields.deep = nest(MAX_DEPTH); ok.files[0].sections[1].fields.push("deep");
  assert.deepEqual(checkCmsConfig(ok).errors, []);
  const bad = base(); bad.files[0].fields.deep = nest(MAX_DEPTH + 1); bad.files[0].sections[1].fields.push("deep");
  const { errors } = checkCmsConfig(bad);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, new RegExp(`nested too deep \\(more than ${MAX_DEPTH} levels`));
});

test("reference ordered without multiple is a warning", () => {
  const config = base();
  config.collections[0].fields.related = f.reference({ label: "Related", to: "services", ordered: true });
  const { errors, warnings } = checkCmsConfig(config);
  assert.deepEqual(errors, []);
  assert.deepEqual(paths(warnings), ["collections[0].fields.related.ordered"]);
});

// Collections
rule("collection itemLabel is required", (c) => { delete c.collections[0].itemLabel; }, "collections[0].itemLabel", /name of one record/);
rule("collection store is required", (c) => { delete c.collections[0].store; }, "collections[0].store", /required/);
rule("unknown store kind", (c) => { c.collections[0].store.kind = "json-dir"; }, "collections[0].store.kind", /unknown store kind "json-dir" → use "json-array".*"markdown-dir"/);
rule("json-array needs idField", (c) => { delete c.collections[0].store.idField; }, "collections[0].store.idField", /required for "json-array"/);
rule("json-array path is a .json file", (c) => { c.collections[0].store.path = "src/data/services.csv"; }, "collections[0].store.path", /must be a \.json file/);
rule("markdown-dir needs slugField", (c) => { delete c.collections[1].store.slugField; }, "collections[1].store.slugField", /required for "markdown-dir"/);
rule("markdown-dir folder is inside the content folders", (c) => { c.collections[1].store.dir = "posts"; }, "collections[1].store.dir", /must be inside/);
rule("the record id field must be text", (c) => { c.collections[0].fields.id = f.select({ label: "Id", options: ["a"] }); }, "collections[0].fields.id", /record id, so it must be a text field/);
rule("preview placeholders are fields of the entry", (c) => { c.collections[0].preview = "/services/{slug}/"; }, "collections[0].preview", /\{slug\} is not a field of this entry → use \{id\}/);
rule("order.by is a field", (c) => { c.collections[0].order = { by: "position" }; }, "collections[0].order.by", /not a field of this collection/);
rule("status live and draft differ", (c) => { c.collections[0].status.draft = "published"; }, "collections[0].status.draft", /must differ from live/);
rule("status values are options of the status select", (c) => { c.collections[0].status.live = "live"; }, "collections[0].status.live", /"live" is not an option of the "status" select/);

test("all mistakes are reported in one pass", () => {
  const config = base();
  config.configVersion = 3;
  config.repo.branch = "a b";
  config.files[0].path = "../site.yaml";
  config.collections[0].fields.items.of.fields.price.locked = "manager";
  config.collections[0].fields.related.to = "nowhere";
  delete config.collections[1].store.slugField;
  const { errors } = checkCmsConfig(config);
  assert.deepEqual(paths(errors), ["configVersion", "repo.branch", "files[0].path", "collections[0].fields.items.of.fields.price.locked", "collections[0].fields.related.to", "collections[1].store.slugField", "collections[1].preview"]);
});
