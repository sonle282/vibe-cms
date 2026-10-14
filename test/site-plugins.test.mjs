// P19: the site plugins — catalogPlugin (references that still lead somewhere, Live records pointing to hidden ones,
// every Live product listed once) and redirectsCheck (public/_redirects: form, 301, order, one hop, no rule hiding a
// Live page, destinations Live, Cloudflare's limits) — on a small catalog: at build (checkContent) and in the API at
// publish and at Hide, with a fake GitHub on 127.0.0.1.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkCmsConfig, checkContent, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f } from "../dist/index.js";
import { catalogPlugin, redirectsCheck, valuesAt } from "../dist/plugins/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

const catalog = (plugins) => ({
  configVersion: 1,
  site: { name: "Catalog Test", url: "https://catalog.example" },
  repo: { owner: "acme", name: "catalog", branch: "main" },
  files: [{
    key: "products-page", label: "Products page", path: "src/data/products-page.json", format: "json", preview: "/products/",
    fields: { blocks: f.list(f.object({ label: "Block", fields: { title: f.text({ label: "Title" }), productIds: f.reference({ label: "Products", to: "products", multiple: true, ordered: true }) } }), { label: "Blocks" }) },
  }],
  collections: [
    { key: "categories", label: "Categories", itemLabel: "Category", store: { kind: "json-array", path: "src/data/categories.json", idField: "id" }, preview: "/category/{id}/", fields: { name: f.text({ label: "Name", required: true }) } },
    {
      key: "products", label: "Products", itemLabel: "Product", store: { kind: "json-array", path: "src/data/products.json", idField: "id" }, preview: "/products/{id}/",
      status: { field: "status", live: "published", draft: "draft", archived: "archived" },
      fields: { name: f.text({ label: "Name", required: true }), status: f.select({ label: "Status", options: ["published", "draft", "archived"] }), categoryIds: f.reference({ label: "Categories", to: "categories", multiple: true }) },
    },
  ],
  plugins,
});
const content = () => ({
  "src/data/products-page.json": `${JSON.stringify({ blocks: [{ title: "Chairs", productIds: ["chair-one", "chair-two"] }, { title: "Tables", productIds: ["table-one"] }] }, null, 2)}\n`,
  "src/data/categories.json": `${JSON.stringify([{ id: "chairs", name: "Chairs" }, { id: "tables", name: "Tables" }], null, 2)}\n`,
  "src/data/products.json": `${JSON.stringify([
    { id: "chair-one", name: "Chair One", status: "published", categoryIds: ["chairs"] },
    { id: "chair-two", name: "Chair Two", status: "published", categoryIds: ["chairs"] },
    { id: "table-one", name: "Table One", status: "published", categoryIds: ["tables"] },
    { id: "table-two", name: "Table Two", status: "draft", categoryIds: ["tables"] },
  ], null, 2)}\n`,
  "public/_redirects": "# Old addresses\n/old-chair /products/chair-one/ 301\n/shop/* /products/ 301\n",
});
const listed = [{ collection: "products", in: [{ file: "products-page", path: "blocks[].productIds" }], once: true, place: "the Products page" }];
const site = (files) => {
  const root = mkdtempSync(join(here, ".tmp-site-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
};
const messages = (result) => [...result.errors.map((entry) => entry.message), ...result.warnings.map((entry) => `(warning) ${entry.message}`)];

test("P19 valuesAt: a path into a record, [] = every item", () => {
  assert.deepEqual(valuesAt({ blocks: [{ ids: ["a", "b"] }, { ids: ["c"] }, {}] }, "blocks[].ids"), ["a", "b", "c"]);
  assert.deepEqual(valuesAt({ page: { ids: ["a"] } }, "page.ids"), ["a"]);
  assert.deepEqual(valuesAt({}, "page.ids"), []);
});

test("P19 config: plugins are checked", () => {
  const problems = (plugins) => checkCmsConfig(catalog(plugins)).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems([catalogPlugin({ listed }), redirectsCheck()]), []);
  assert.deepEqual(problems({}), ["plugins: must be a list of plugins"]);
  assert.deepEqual(problems([{ name: "", check: "no", extra: 1, files: ["/etc/passwd"] }]), ["plugins[0].extra: unknown setting", "plugins[0].name: required — the plugin's name", "plugins[0].check: must be a function (site) => problems", "plugins[0].files: must be repo paths"]);
});

test("P19 at build — catalog: every Live product on the Products page once; a Live page pointing to a draft is said", () => {
  const files = content();
  // Table Two goes Live but is not listed; Chair One is listed twice; the page lists a draft.
  files["src/data/products.json"] = files["src/data/products.json"].replace('"id": "table-two",\n    "name": "Table Two",\n    "status": "draft"', '"id": "table-two",\n    "name": "Table Two",\n    "status": "published"');
  files["src/data/products-page.json"] = `${JSON.stringify({ blocks: [{ title: "Chairs", productIds: ["chair-one", "chair-two"] }, { title: "Tables", productIds: ["table-one", "chair-one"] }] }, null, 2)}\n`;
  const result = checkContent(catalog([catalogPlugin({ listed })]), site(files));
  assert.deepEqual(messages(result), ["Chair One is on the Products page 2 times (Products page, Products page).", "Table Two is Live but not on the Products page."]);
  assert.deepEqual(messages(checkContent(catalog([catalogPlugin({ listed })]), site({ ...content(), "src/data/products-page.json": `${JSON.stringify({ blocks: [{ title: "All", productIds: ["chair-one", "chair-two", "table-one", "table-two"] }] })}\n` }))),
    ["(warning) Products page › Products: Table Two is not Live, so the website does not show it there."]);
  assert.deepEqual(messages(checkContent(catalog([catalogPlugin({ listed })]), site(content()))), [], "the fixture as it is: fine");
});

test("P19 at build — redirects (Mr Spa's rules): form, 301 only, duplicates, order, one hop, hidden pages, Live destinations, limits", () => {
  const redirects = [
    "# comment",
    "/a /b/ 301",
    "/b",
    "/c /d/ 302",
    "/a /e/ 301",
    "/same /same 301",
    "/f /g 301",
    "/products/chair-two/ /products/ 301",
    "/x /products/table-two/ 301",
    "/y https://example.com/z 301 force",
    "/z/* /products/ 301",
    "/late /products/ 301",
  ].join("\n");
  const result = checkContent(catalog([redirectsCheck({ limits: { exact: 20, dynamic: 1 } })]), site({ ...content(), "public/_redirects": redirects }));
  assert.deepEqual(messages(result), [
    "public/_redirects line 3: expected source destination status",
    "public/_redirects line 4: only 301 redirects are allowed",
    "public/_redirects line 5: duplicate source /a (line 2)",
    "public/_redirects line 6: source and destination are identical",
    "public/_redirects line 6: /same needs its trailing slash — use /same/ (one 301, no second redirect after it)",
    "public/_redirects line 7: /g needs its trailing slash — use /g/ (one 301, no second redirect after it)",
    "public/_redirects line 8: /products/chair-two/ is a Live page — a redirect would hide it",
    "public/_redirects line 9: /products/table-two/ is a product that is not Live",
    "public/_redirects line 10: unexpected redirect options force",
    "public/_redirects line 12: exact rule after the first dynamic rule (line 11) — it would be dynamic",
    "(warning) public/_redirects: 1 of 1 dynamic rules used.",
  ]);
  assert.deepEqual(messages(checkContent(catalog([redirectsCheck()]), site(content()))), []);
  assert.deepEqual(messages(checkContent(catalog([redirectsCheck({ file: "public/none" })]), site(content()))), [], "no file: nothing to check");
});

test("P19 a plugin that throws or answers oddly is an error naming it", () => {
  const result = checkContent(catalog([{ name: "boom", check: () => { throw new Error("no data"); } }, { name: "odd", check: () => "yes" }]), site(content()));
  assert.deepEqual(result.errors.map((entry) => entry.message), ["the boom plugin failed: no data", "the odd plugin did not return a list of problems"]);
});

test("P19 at publish and at Hide: the site as it will be — refused with the plugins' words, nothing committed", async () => {
  const config = catalog([catalogPlugin({ listed }), redirectsCheck()]);
  const files = content();
  const github = await startFakeGitHub({ owner: "acme", name: "catalog", branch: "main", files });
  try {
    const user = { userId: "usr_owner", role: "owner" };
    const drafts = createMemoryDraftStore();
    const api = createCmsApi({ config, source: createBundledSource(files), drafts, audit: createMemoryAuditLog(), identify: () => user, publisher: createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url }) });
    const call = async (method, path, body) => { const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) })); return { status: response.status, body: await response.json() }; };
    const start = github.head();
    // Table Two goes Live, but nobody put it on the Products page.
    const tableTwo = await call("GET", "/collections/products/items/table-two");
    await call("PUT", "/collections/products/items/table-two", { content: { ...tableTwo.body.draft?.content ?? tableTwo.body.content, status: "published" }, expectedRevision: 0, sourceVersion: tableTwo.body.version });
    const refused = await call("POST", "/publish", { resources: ["item:products:table-two"] });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error, "site_check_failed");
    assert.equal(refused.body.message, "The site's checks refused this: Table Two is Live but not on the Products page.");
    assert.deepEqual(github.commitsSince(start), [], "nothing committed");
    // Published together with the page that lists it: fine.
    const page = await call("GET", "/files/products-page");
    await call("PUT", "/files/products-page", { content: { blocks: [...page.body.content.blocks, { title: "New", productIds: ["table-two"] }] }, expectedRevision: 0, sourceVersion: page.body.version });
    const both = await call("POST", "/publish", { resources: ["item:products:table-two", "file:products-page"] });
    assert.equal(both.status, 200, JSON.stringify(both.body));
    // Hide Chair One: a redirect points to its page, so it would lead nowhere.
    const hidden = await call("POST", "/collections/products/items/chair-one/visibility", { action: "archive" });
    assert.equal(hidden.status, 422);
    assert.match(hidden.body.message, /public\/_redirects line 2: \/products\/chair-one\/ is a product that is not Live/);
  } finally { await github.close(); }
});
