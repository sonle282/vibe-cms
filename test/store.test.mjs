// The store — drafts (memory; the same scenario runs on local D1 in scripts/store-local.mjs)
// and the bundled ContentSource with versions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, contentPaths, createBundledSource, createContentReader, createMemoryDraftStore, loadCmsConfig, resourceId, parseResourceId, textVersion, valueVersion, writeArrayItem } from "../dist/index.js";
import { runStoreScenario } from "./helpers/store-scenario.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));

test("drafts: save / read / revision / concurrent saves / two users / two items / discard / publish / size / ids (memory)", async () => {
  let clock = 0;
  const checks = await runStoreScenario({ drafts: createMemoryDraftStore(() => new Date(Date.UTC(2026, 8, 28, 12, 0, clock++)).toISOString()) });
  assert.deepEqual(checks.filter((check) => !check.ok), []);
  assert.equal(checks.length, 24);
});

test("resource ids round-trip", () => {
  assert.equal(resourceId({ kind: "file", key: "site" }), "file:site");
  assert.equal(resourceId({ kind: "item", key: "services", id: "a:b" }), "item:services:a:b");
  assert.deepEqual(parseResourceId("item:services:a:b"), { kind: "item", key: "services", id: "a:b" });
  assert.throws(() => parseResourceId("file:"), RangeError);
});

test("versions: sha256 of the text; item versions ignore key order and other items", async () => {
  assert.equal(await textVersion(""), "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.equal(await valueVersion({ a: 1, b: 2 }), await valueVersion({ b: 2, a: 1 }));
  assert.notEqual(await valueVersion({ a: 1 }), await valueVersion({ a: 2 }));
});

test("bundled source: the demo's files, with file and item versions", async () => {
  const config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  const paths = contentPaths(config, demoRoot);
  assert.deepEqual(paths, ["src/data/site.json", "src/data/services.json", "src/data/team.json", "src/content/posts/spring-colours.md", "src/content/posts/welcome.md"]);
  const files = Object.fromEntries(paths.map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
  const reader = createContentReader(config, createBundledSource(files));

  const site = await reader.file("site");
  assert.equal(site.resource, "file:site");
  assert.equal(site.text, files["src/data/site.json"], "the exact built bytes");
  assert.equal(site.version, await textVersion(files["src/data/site.json"]));
  assert.equal(site.data.name, "Demo Salon");

  const items = await reader.items("services");
  assert.deepEqual(items.map((item) => item.resource), ["item:services:classic-manicure", "item:services:spa-pedicure", "item:services:nail-art"]);
  // Changing one item changes that item's version only.
  const text = files["src/data/services.json"];
  const changed = writeArrayItem(text, "id", "spa-pedicure", { ...items[1].data, price: "$40" }).text;
  const after = await createContentReader(config, createBundledSource({ ...files, "src/data/services.json": changed })).items("services");
  assert.deepEqual(after.map((item, index) => item.version === items[index].version), [true, false, true]);
  assert.equal((await reader.item("services", "nail-art")).data.name, "Nail Art");
  assert.equal(await reader.item("services", "nope"), undefined);
});

test("bundled source: markdown-dir records use the slug and keep body", async () => {
  const config = { files: [], collections: [{ key: "blog", label: "Blog", itemLabel: "Post", store: { kind: "markdown-dir", dir: "src/content/blog", slugField: "slug" }, fields: {} }] };
  const source = createBundledSource({ "src/content/blog/a.md": "---\nslug: hello\ntitle: Hello\n---\nBody\n", "src/content/blog/b.md": "---\ntitle: No slug\n---\n", "src/content/other.md": "x" });
  assert.deepEqual(await source.list("src/content/blog"), ["src/content/blog/a.md", "src/content/blog/b.md"]);
  const items = await createContentReader(config, source).items("blog");
  assert.deepEqual(items.map((item) => [item.resource, item.data.body]), [["item:blog:hello", "Body\n"], ["item:blog:b", ""]]);
});
