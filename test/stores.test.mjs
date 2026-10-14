// P20: the stores Mr Spa's content needs, without moving it — "json-object" (records keyed by id: policies.json,
// service-pages.json) and a list inside a bigger file (`pointer`: mrspainc-services-projects.json → projects). Checked
// at build, read by the store, written by the format-keeping writer (only the record's lines change), published
// through the real API to a fake GitHub on 127.0.0.1.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkCmsConfig, checkContent, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f, storeRecords, withStoreRecord } from "../dist/index.js";
import { writeStoreItem } from "../dist/writer/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

const crlf = (text) => text.replace(/\n/g, "\r\n");
const policies = `${JSON.stringify({
  "privacy-policy": { slug: "privacy-policy", title: "Privacy Policy", sections: [{ heading: "What we keep", paragraphs: ["Your name."] }] },
  "refund-policy": { slug: "refund-policy", title: "Refund Policy", sections: [{ heading: "Refunds", paragraphs: ["Within 30 days."] }] },
}, null, 2)}\n`;
const projects = crlf(`${JSON.stringify({
  source: "https://example.com",
  extractedAt: "2026-01-01",
  services: [{ slug: "design", title: "Design" }],
  projects: [{ slug: "salon-one", status: "published", title: "Salon One" }, { slug: "salon-two", status: "published", title: "Salon Two" }],
}, null, 2)}\n`);
const config = () => ({
  configVersion: 1,
  site: { name: "Stores Test", url: "https://stores.example" },
  repo: { owner: "acme", name: "stores", branch: "main" },
  files: [],
  collections: [
    { key: "policies", label: "Policies", itemLabel: "Policy", fixed: true, preview: "/{slug}/", store: { kind: "json-object", path: "src/data/policies.json", idField: "slug" },
      fields: { title: f.text({ label: "Title" }), sections: f.list(f.object({ label: "Section", fields: { heading: f.text({ label: "Heading" }), paragraphs: f.list(f.text({ label: "Paragraph", multiline: true }), { label: "Paragraphs", fixed: true }) } }), { label: "Sections", fixed: true }) } },
    { key: "projects", label: "Projects", itemLabel: "Project", preview: "/projects/{slug}/", store: { kind: "json-array", path: "src/data/projects-data.json", idField: "slug", pointer: "projects" },
      status: { field: "status", live: "published", draft: "draft", archived: "archived" },
      fields: { title: f.text({ label: "Title", required: true }), status: f.select({ label: "Status", options: ["published", "draft", "archived"] }) } },
  ],
});
const files = () => ({ "src/data/policies.json": policies, "src/data/projects-data.json": projects });
const site = (content) => {
  const root = mkdtempSync(join(here, ".tmp-stores-"));
  made.push(root);
  for (const [path, text] of Object.entries(content)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
};

test("P20 config: json-object and pointer are checked", () => {
  const problems = (store) => checkCmsConfig({ ...config(), collections: [{ ...config().collections[0], preview: undefined, store }] }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(checkCmsConfig(config()).errors, []);
  assert.deepEqual(problems({ kind: "json-object", path: "src/data/policies.json", idField: "slug", pointer: "a..b" }), ['collections[0].store.pointer: "a..b" is not a key path']);
  assert.deepEqual(problems({ kind: "json-object", path: "src/data/policies.json" }), ['collections[0].store.idField: required for "json-object" — the property that identifies a record']);
  assert.match(problems({ kind: "keyed", path: "src/data/policies.json" }).join(), /unknown store kind "keyed"/);
});

test("P20 store helpers: the records of a keyed object, of a list inside a file; one replaced, added, removed", () => {
  const object = { kind: "json-object", path: "x.json", idField: "slug" };
  assert.deepEqual(storeRecords(object, JSON.parse(policies)).map((entry) => entry.id), ["privacy-policy", "refund-policy"]);
  assert.match(storeRecords(object, []), /expected an object of records keyed by id/);
  const inner = { kind: "json-array", path: "x.json", idField: "slug", pointer: "projects" };
  assert.deepEqual(storeRecords(inner, JSON.parse(projects)).map((entry) => entry.id), ["salon-one", "salon-two"]);
  assert.match(storeRecords(inner, { projects: {} }), /expected a list of records \(\[ … \]\) at projects/);
  const next = withStoreRecord(inner, JSON.parse(projects), "salon-three", { slug: "salon-three", status: "draft", title: "Salon Three" });
  assert.deepEqual(next.projects.map((entry) => entry.slug), ["salon-one", "salon-two", "salon-three"]);
  assert.deepEqual(next.services, [{ slug: "design", title: "Design" }], "the other keys stay");
  assert.deepEqual(Object.keys(withStoreRecord(object, JSON.parse(policies), "refund-policy", null)), ["privacy-policy"]);
});

test("P20 at build: the records are checked; a json-object record holds its key as its id", () => {
  assert.deepEqual(checkContent(config(), site(files())).errors, []);
  const wrong = JSON.parse(policies);
  wrong["refund-policy"].slug = "refunds";
  const result = checkContent(config(), site({ ...files(), "src/data/policies.json": JSON.stringify(wrong) }));
  assert.deepEqual(result.errors.map((entry) => `${entry.path}: ${entry.message}`), ['src/data/policies.json › refund-policy.slug: must be "refund-policy", its key in the object (got text "refunds")']);
  const flat = checkContent(config(), site({ ...files(), "src/data/projects-data.json": "[]" }));
  assert.match(flat.errors.map((entry) => entry.message).join(), /expected a list of records \(\[ … \]\) at projects/);
});

test("P20 writer: only the record's lines change — CRLF, the other keys and records stay byte for byte", () => {
  const inner = { kind: "json-array", path: "x.json", idField: "slug", pointer: "projects" };
  const written = writeStoreItem(inner, projects, "salon-two", { slug: "salon-two", status: "published", title: "Salon Two (renovated)" });
  assert.equal(written.rewroteWholeFile, false);
  assert.equal(written.text, projects.replace('"title": "Salon Two"', '"title": "Salon Two (renovated)"'));
  const object = { kind: "json-object", path: "x.json", idField: "slug" };
  const policy = JSON.parse(policies)["privacy-policy"];
  const edited = writeStoreItem(object, policies, "privacy-policy", { ...policy, title: "Privacy" });
  assert.equal(edited.text, policies.replace('"title": "Privacy Policy"', '"title": "Privacy"'));
});

test("P20 publish: a policy (json-object) and a project (pointer) — one commit, only their lines", async () => {
  const cfg = config();
  const content = files();
  const github = await startFakeGitHub({ owner: "acme", name: "stores", branch: "main", files: content });
  try {
    const user = { userId: "usr_owner", role: "owner" };
    const api = createCmsApi({ config: cfg, source: createBundledSource(content), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user, publisher: createGitHubPublisher({ token: github.token, repo: cfg.repo, apiUrl: github.url }) });
    const call = async (method, path, body) => { const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) })); return { status: response.status, body: await response.json() }; };
    const list = await call("GET", "/collections/policies");
    assert.deepEqual(list.body.items.map((item) => item.id), ["privacy-policy", "refund-policy"]);
    const policy = await call("GET", "/collections/policies/items/refund-policy");
    assert.equal(policy.body.content.title, "Refund Policy");
    await call("PUT", "/collections/policies/items/refund-policy", { content: { ...policy.body.content, title: "Refunds" }, expectedRevision: 0, sourceVersion: policy.body.version });
    const project = await call("GET", "/collections/projects/items/salon-one");
    await call("PUT", "/collections/projects/items/salon-one", { content: { ...project.body.content, title: "Salon One, Holmdel" }, expectedRevision: 0, sourceVersion: project.body.version });
    const start = github.head();
    const published = await call("POST", "/publish", { resources: ["item:policies:refund-policy", "item:projects:salon-one"] });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(github.commitsSince(start).length, 1);
    assert.equal(github.files()["src/data/policies.json"], policies.replace('"title": "Refund Policy"', '"title": "Refunds"'));
    assert.equal(github.files()["src/data/projects-data.json"], projects.replace('"title": "Salon One"', '"title": "Salon One, Holmdel"'));
  } finally { await github.close(); }
});
