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

// ---------------------------------------------------------------- P20: one file, several records (`pointer` on files)
const settings = crlf(`${JSON.stringify({
  seo: { siteName: "MR SPA", defaultTitle: "Salon furniture" },
  header: { logo: "/assets/logo.webp", phoneLabel: "(215) 772-1111" },
  footer: { description: "Since 2010.", email: "hi@example.com" },
}, null, 2)}\n`);
const areas = () => ({
  ...config(),
  files: [
    { key: "header", label: "Header", path: "src/data/site-settings.json", pointer: "header", format: "json", area: true, description: "Logo, phone number and menu", fields: { logo: f.image({ label: "Header logo" }), phoneLabel: f.text({ label: "Store phone number" }) } },
    { key: "footer", label: "Footer", path: "src/data/site-settings.json", pointer: "footer", format: "json", area: true, description: "Contact details, links and social", fields: { description: f.text({ label: "About the business", multiline: true }), email: f.text({ label: "Email" }) } },
    { key: "privacy", label: "Privacy Policy", path: "src/data/policies.json", pointer: "privacy-policy", format: "json", group: "Policies", preview: "/privacy-policy/",
      fields: { slug: f.text({ label: "Web address" }), title: f.text({ label: "Title" }), sections: config().collections[0].fields.sections } },
  ],
  collections: [],
});

test("P20 files with a pointer: several entries on one file, each its own key; overlaps and whole-file entries refused", () => {
  assert.deepEqual(checkCmsConfig(areas()).errors, []);
  const problems = (change) => checkCmsConfig({ ...areas(), files: change(areas().files) }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems((files) => [...files, { ...files[0], key: "header-menu", pointer: "header.menu" }]), ['files[3].pointer: "header.menu" overlaps files[0] on the same file']);
  assert.deepEqual(problems((files) => [...files, { ...files[0], key: "everything", pointer: undefined }]), ['files[3].path: "src/data/site-settings.json" is already used by files[0]']);
  assert.deepEqual(problems((files) => [{ ...files[0], pointer: "a b" }, files[1]]), ['files[0].pointer: "a b" is not a key path']);
});

test("P20 files with a pointer at build: the record is the key's value; a missing key is said", () => {
  assert.deepEqual(checkContent(areas(), site({ "src/data/site-settings.json": settings, "src/data/policies.json": policies })).errors, []);
  const result = checkContent(areas(), site({ "src/data/site-settings.json": settings.replace('"footer"', '"bottom"'), "src/data/policies.json": policies }));
  assert.deepEqual(result.errors.map((entry) => `${entry.path}: ${entry.message}`), ['src/data/site-settings.json: has no "footer" (files[1].pointer)']);
});

test("P20 files with a pointer at publish: one commit, only their lines; Header's publish does not make Footer's draft stale", async () => {
  const cfg = areas();
  const content = { "src/data/site-settings.json": settings, "src/data/policies.json": policies };
  const github = await startFakeGitHub({ owner: "acme", name: "stores", branch: "main", files: content });
  try {
    const user = { userId: "usr_owner", role: "owner" };
    const api = createCmsApi({ config: cfg, source: createBundledSource(content), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user, publisher: createGitHubPublisher({ token: github.token, repo: cfg.repo, apiUrl: github.url }) });
    const call = async (method, path, body) => { const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) })); return { status: response.status, body: await response.json() }; };
    const header = await call("GET", "/files/header");
    assert.deepEqual(header.body.content, { logo: "/assets/logo.webp", phoneLabel: "(215) 772-1111" });
    const footer = await call("GET", "/files/footer");
    await call("PUT", "/files/header", { content: { ...header.body.content, phoneLabel: "(215) 772-2222" }, expectedRevision: 0, sourceVersion: header.body.version });
    await call("PUT", "/files/footer", { content: { ...footer.body.content, email: "office@example.com" }, expectedRevision: 0, sourceVersion: footer.body.version });
    const start = github.head();
    assert.equal((await call("POST", "/publish", { resources: ["file:header"] })).status, 200);
    assert.equal(github.files()["src/data/site-settings.json"], settings.replace("772-1111", "772-2222"));
    // Footer's draft started before Header was published: it is still current (its own key did not change).
    const footerPublished = await call("POST", "/publish", { resources: ["file:footer"] });
    assert.equal(footerPublished.status, 200, JSON.stringify(footerPublished.body));
    assert.equal(github.commitsSince(start).length, 2);
    assert.equal(github.files()["src/data/site-settings.json"], settings.replace("772-1111", "772-2222").replace("hi@example.com", "office@example.com"));
    // A policy, one key of policies.json.
    const privacy = await call("GET", "/files/privacy");
    assert.equal(privacy.body.content.title, "Privacy Policy");
    await call("PUT", "/files/privacy", { content: { ...privacy.body.content, title: "Privacy" }, expectedRevision: 0, sourceVersion: privacy.body.version });
    assert.equal((await call("POST", "/publish", { resources: ["file:privacy"] })).status, 200);
    assert.equal(github.files()["src/data/policies.json"], policies.replace('"title": "Privacy Policy"', '"title": "Privacy"'));
  } finally { await github.close(); }
});

test("P20 keep: keys the site owns are kept without a warning; a declared field cannot be kept; an archived record builds", () => {
  const legacy = crlf(`${JSON.stringify({
    source: "https://example.com",
    projects: [{ slug: "salon-one", status: "archived", title: "Salon One", sourceUrl: "https://old.example/one", hero: { src: "/a.webp", alt: "A" }, gallery: [{ src: "/b.webp", alt: "B", note: "x" }] }],
  }, null, 2)}\n`);
  const cfg = (keep) => ({ ...config(), collections: [{ ...config().collections[1], fields: { title: f.text({ label: "Title", required: true }) }, status: { field: "status", live: "published", draft: "draft", archived: "archived" }, ...(keep ? { keep } : {}) }] });
  const root = site({ "src/data/projects-data.json": legacy });
  const warned = (keep) => checkContent(cfg(keep), root).warnings.map((entry) => entry.path.replace(/^.*\("salon-one"\)\./, ""));
  assert.deepEqual(checkContent(cfg(), root).errors, [], "archived is a status of the collection, not an error");
  assert.deepEqual(warned(), ["sourceUrl", "hero", "gallery"]);
  assert.deepEqual(warned(["sourceUrl", "hero", "gallery"]), []);
  assert.deepEqual(warned(["gallery[].note"]), ["sourceUrl", "hero", "gallery"], "a key inside list items is kept by its path");
  assert.deepEqual(checkCmsConfig(cfg(["title", "a b"])).errors.map((entry) => `${entry.path}: ${entry.message}`), ['collections[0].keep[0]: "title" is a field of this entry', 'collections[0].keep[1]: "a b" is not a key path']);
});

test("P20 round-trip: every record written back unchanged gives its file byte for byte", async () => {
  const { checkRoundTrip } = await import("../dist/check/roundtrip.js");
  const root = site({ ...files(), "src/data/site-settings.json": settings });
  const trip = checkRoundTrip({ ...areas(), collections: config().collections }, root);
  assert.deepEqual([trip.records, trip.files, trip.problems], [7, 3, []], "3 areas / policy files + 2 policies + 2 projects");
  // Even an oddly formatted file (a list on one line) is kept: an unchanged record touches nothing.
  const odd = site({ ...files(), "src/data/projects-data.json": '{"projects":[{"slug":"salon-one","status":"published","title":"Salon One"}],\n"other":1}\n' });
  assert.deepEqual(checkRoundTrip(config(), odd).problems, []);
});
