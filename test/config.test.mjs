// Loading a site's cms.config.ts from disk and stopping with one clear message (runs against the built dist/).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CmsConfigError, countConfig, defineCmsConfig, f, loadCmsConfig } from "../dist/index.js";

const demo = fileURLToPath(new URL("../fixtures/demo-site/cms.config.ts", import.meta.url));
const configModule = fileURLToPath(new URL("../dist/config/index.js", import.meta.url)).replace(/\\/g, "/");

const withConfig = async (source, run) => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-cms-"));
  try { const file = join(dir, "cms.config.ts"); writeFileSync(file, source); return await run(file); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("the demo site's config loads: 1 file, 3 collections, locked phone / email / address / hours + price", async () => {
  const config = await loadCmsConfig(demo);
  assert.deepEqual(countConfig(config), { files: 1, collections: 3 });
  for (const name of ["phone", "email", "address", "hours"]) assert.equal(config.files[0].fields[name].locked, "owner", name);
  assert.equal(config.collections[0].fields.price.locked, "owner");
  assert.equal(config.repo.branch, "main");
});

test("a file without path stops with a clear message naming the place", async () => {
  await withConfig(`import { defineCmsConfig, f } from "${configModule}";
export default defineCmsConfig({ configVersion: 1, site: { name: "X", url: "https://x.example" }, repo: { owner: "o", name: "r", branch: "main" },
  files: [{ key: "site", label: "Salon info", format: "json", fields: { phone: f.text({ label: "Phone" }) } }], collections: [] });`, async (file) => {
    await assert.rejects(loadCmsConfig(file), (error) => {
      assert.ok(error instanceof CmsConfigError, "a CmsConfigError");
      assert.match(error.message, /cms\.config\.ts is not valid \(1 problem\):/);
      assert.match(error.message, /files\[0\]\.path: required — the content file → e\.g\. "src\/data\/site\.json"/);
      return true;
    });
  });
});

test("other mistakes are all listed at once", async () => {
  await withConfig(`export default { configVersion: 2, site: {}, repo: { owner: "o" }, files: [{ key: "a", label: "A", path: "a.yaml", fields: { x: { type: "colour", label: "X" }, y: { type: "text" } } }],
  collections: [{ key: "c", label: "C", store: { kind: "json-array" }, fields: { n: { type: "text", label: "N", locked: "editor" } } }] };`, async (file) => {
    await assert.rejects(loadCmsConfig(file), (error) => {
      for (const part of ["configVersion: must be 1", "site.name: required", "site.url: must be a full http(s) address", "repo.name: required", "repo.branch: required", 'files[0].path: "a.yaml" must be inside "src/data/" or "src/content/"', 'files[0].fields.x.type: unknown field type "colour"', "files[0].fields.y.label: required", "collections[0].itemLabel: required", "collections[0].store.path: required", 'collections[0].store.idField: required for "json-array"', 'collections[0].fields.n.locked: only "owner" is allowed']) assert.ok(error.message.includes(part), `mentions ${part}\n${error.message}`);
      return true;
    });
  });
});

test("a missing config file says where it was looked for", async () => {
  await assert.rejects(loadCmsConfig(join(tmpdir(), "nope", "cms.config.ts")), /not found at .*cms\.config\.ts/);
});

test("field builders keep their options and type", () => {
  const list = f.list(f.text({ label: "Extra" }), { label: "Extras", ordered: true });
  assert.deepEqual(list, { type: "list", of: { type: "text", label: "Extra" }, label: "Extras", ordered: true });
  assert.deepEqual(f.reference({ label: "Category", to: "categories", multiple: true }), { type: "reference", label: "Category", to: "categories", multiple: true });
  assert.deepEqual(f.hours({ label: "Hours", locked: "owner" }), { type: "hours", label: "Hours", locked: "owner" });
  const config = defineCmsConfig({ configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, files: [], collections: [] });
  assert.deepEqual(countConfig(config), { files: 0, collections: 0 });
});
