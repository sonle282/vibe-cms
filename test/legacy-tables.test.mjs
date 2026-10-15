// P21: a site whose old CMS already has a D1, a KV and an R2 (Mr Spa: mrspainc-cms, SESSION, MEDIA) switches to the
// package with them as they are. `setup` keeps the KV its binding uses and creates nothing; the old CMS's tables, which
// have the package's names, are renamed legacy_cms_* in the same D1 (only with --rename-legacy; every row kept); the
// package's migrations then apply there and import-legacy-users reads the people from legacy_cms_users. Fake Cloudflare
// account with real SQLite (test/helpers/fake-wrangler.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { siteNames } from "../dist/index.js";
import { run, useSiteNames } from "../dist/cli/index.js";
import { legacyHashPassword } from "./helpers/sqlite-d1.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const fake = fileURLToPath(new URL("./helpers/fake-wrangler.mjs", import.meta.url));
const dirs = []; const open = [];
after(() => { open.forEach((database) => { try { database.close(); } catch { /* closed */ } }); dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); useSiteNames(siteNames({})); });

const DB = "00000000-0000-4000-8000-00000000mrsp", KV = "bb94378b15204415a869b3fbd3081c02";
// Mr Spa's own migrations 0001–0005 (its CMS), as its D1 has them.
const MRSPA_SCHEMA = `
CREATE TABLE cms_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, result TEXT NOT NULL, source_version TEXT, commit_sha TEXT);
CREATE INDEX idx_cms_audit_log_resource ON cms_audit_log (resource, occurred_at DESC);
CREATE TABLE cms_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT, password_changed_at TEXT NOT NULL);
CREATE INDEX idx_cms_users_status ON cms_users (status);
ALTER TABLE cms_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE cms_auth_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE cms_draft_index (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, resource TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('page', 'site', 'data')),
  resource_id TEXT NOT NULL, label TEXT NOT NULL, updated_at TEXT NOT NULL, editor_location TEXT, UNIQUE(subject, resource));
CREATE TABLE cms_media_metadata (media_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
INSERT INTO d1_migrations (name) VALUES ('0001_cms_audit_log.sql'), ('0002_cms_users.sql'), ('0003_cms_auth_state.sql'), ('0004_cms_draft_index.sql'), ('0005_cms_media_metadata.sql');`;
const WRANGLER = JSON.stringify({
  name: "mrspainc",
  kv_namespaces: [{ binding: "SESSION", id: KV }],
  r2_buckets: [{ binding: "MEDIA", bucket_name: "mrspainc-media" }],
  d1_databases: [{ binding: "CMS_DB", database_name: "mrspainc-cms", database_id: DB }],
  ratelimits: [{ name: "CMS_PUBLISH_LIMITER", namespace_id: "20260828", simple: { limit: 20, period: 60 } }, { name: "CMS_LOGIN_LIMITER", namespace_id: "2026082801", simple: { limit: 10, period: 60 } }],
}, null, 2);

const site = async () => {
  const root = mkdtempSync(join(here, ".tmp-legacy-tables-")); dirs.push(root);
  writeFileSync(join(root, "wrangler.astro.jsonc"), WRANGLER);
  writeFileSync(join(root, "cms.config.ts"), `export default { configVersion: 1, site: { name: "MR SPA", url: "https://mrspainc.com" }, repo: { owner: "MRSPAINC", name: "mrspainc.com", branch: "main" }, files: [], collections: [], bindings: { media: "MEDIA" }, secrets: { githubToken: "CMS_GITHUB_TOKEN" } };\n`);
  writeFileSync(join(root, "fake-cf.json"), JSON.stringify({ accounts: { default: { d1: [{ uuid: DB, name: "mrspainc-cms" }], kv: [{ id: KV, title: "mrspainc-cms-SESSION" }], r2: ["mrspainc-media"], applied: {} } } }));
  const db = new DatabaseSync(join(root, `${DB}.sqlite`));
  db.exec(MRSPA_SCHEMA);
  const add = db.prepare("INSERT INTO cms_users (username, password_hash, role, status, created_at, updated_at, last_login_at, password_changed_at, session_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  add.run("owner", await legacyHashPassword("owner-old-password-1"), "admin", "active", "2026-08-28T08:00:00.000Z", "2026-09-01T08:00:00.000Z", "2026-10-10T09:00:00.000Z", "2026-08-28T08:00:00.000Z", 2);
  add.run("writer", await legacyHashPassword("writer-old-password-2"), "editor", "active", "2026-09-02T08:00:00.000Z", "2026-09-02T08:00:00.000Z", null, "2026-09-02T08:00:00.000Z", 1);
  db.exec(`INSERT INTO cms_auth_state VALUES ('bootstrap_completed', 'true', '2026-08-28T08:00:00.000Z');
    INSERT INTO cms_audit_log (occurred_at, actor, action, resource, result) VALUES ('2026-10-01T08:00:00.000Z', 'owner', 'publish', 'page:homepage', 'succeeded');
    INSERT INTO cms_draft_index (subject, resource, kind, resource_id, label, updated_at) VALUES ('1', 'page:about', 'page', 'about', 'About', '2026-10-02T08:00:00.000Z');
    INSERT INTO cms_media_metadata VALUES ('uploads/a.jpg', 'Showroom', '2026-10-03T08:00:00.000Z', 'owner');`);
  db.close();
  return {
    root,
    db: () => { const database = new DatabaseSync(join(root, `${DB}.sqlite`)); open.push(database); return database; },
    calls: () => JSON.parse(readFileSync(join(root, "fake-cf.json"), "utf8")).calls ?? [],
    config: () => readFileSync(join(root, "wrangler.astro.jsonc"), "utf8"),
  };
};
const cli = async (root, argv) => {
  const out = [], err = [];
  const saved = { ...process.env };
  Object.assign(process.env, { VIBE_CMS_WRANGLER: fake, FAKE_CF_STATE: join(root, "fake-cf.json") });
  try { const code = await run(argv, { root, log: (line) => out.push(line), error: (line) => err.push(line) }); return { code, out: out.join("\n"), err: err.join("\n") }; }
  finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
};
const SETUP = ["setup", "--site", "mrspainc", "--config", "wrangler.astro.jsonc"];
const tables = (database) => database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);

test("P21 setup on a site that had a CMS: its D1 / KV / R2 kept, nothing created; the old tables only renamed with --rename-legacy", async () => {
  const s = await site();
  const before = tables(s.db());
  const refused = await cli(s.root, SETUP);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.err, /CMS_DB has the tables of the CMS this site ran before \(cms_users, cms_auth_state, cms_draft_index, cms_audit_log\)[^\n]*nothing was changed/);
  assert.match(refused.err, /--rename-legacy: cms_users → legacy_cms_users, cms_auth_state → legacy_cms_auth_state, cms_draft_index → legacy_cms_draft_index, cms_audit_log → legacy_cms_audit_log/);
  assert.deepEqual(tables(s.db()), before, "the database is unchanged");

  const done = await cli(s.root, [...SETUP, "--rename-legacy"]);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /D1 mrspainc-cms: already there[\s\S]*KV mrspainc-cms-SESSION: already used by SESSION, kept[\s\S]*R2 mrspainc-media: already there/);
  assert.match(done.out, /the old CMS's tables renamed, every row kept \(remote\)[\s\S]*migrations applied \(remote\): 0001_draft_index\.sql, 0002_draft_content\.sql, 0003_audit_log\.sql, 0004_users\.sql, 0005_audit_log_auth\.sql/);
  assert.match(done.out, /wrangler secret put CMS_GITHUB_TOKEN\s+# fine-grained[^\n]*skip if it is set already/, "the site's own secret name");
  assert.deepEqual(s.calls().filter((call) => call.args.includes("create")), [], "nothing created");
  const config = JSON.parse(s.config());
  assert.deepEqual(config.kv_namespaces, [{ binding: "SESSION", id: KV }]);
  assert.deepEqual(config.r2_buckets, [{ binding: "MEDIA", bucket_name: "mrspainc-media" }]);
  assert.deepEqual([config.d1_databases[0].database_id, config.d1_databases.length], [DB, 1]);
  assert.match(config.d1_databases[0].migrations_dir, /migrations$/);
  assert.deepEqual(config.ratelimits.map((limit) => limit.namespace_id), ["20260828", "2026082801"], "the limiters kept");

  const db = s.db();
  assert.deepEqual(tables(db), ["cms_audit_log", "cms_auth_state", "cms_draft_index", "cms_media_metadata", "cms_users", "d1_migrations", "legacy_cms_audit_log", "legacy_cms_auth_state", "legacy_cms_draft_index", "legacy_cms_users"]);
  assert.deepEqual(["legacy_cms_users", "legacy_cms_auth_state", "legacy_cms_audit_log", "legacy_cms_draft_index", "cms_media_metadata"].map((name) => db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n), [2, 1, 1, 1, 1], "every old row kept");
  assert.ok(db.prepare("PRAGMA table_info(cms_users)").all().some((column) => column.name === "display_name"), "cms_users is the package's now");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cms_users").get().n, 0);
  db.close();

  const again = await cli(s.root, [...SETUP, "--rename-legacy"]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /wrangler\.astro\.jsonc: already up to date[\s\S]*migrations: up to date/);
  assert.doesNotMatch(again.out, /renamed/);
});

test("P21 import-legacy-users from the same D1: the people of legacy_cms_users, same hashes; the old rows stay", async () => {
  const s = await site();
  assert.equal((await cli(s.root, [...SETUP, "--rename-legacy"])).code, 0);
  const imported = await cli(s.root, ["import-legacy-users", "--from", "CMS_DB", "--from-config", "wrangler.astro.jsonc", "--config", "wrangler.astro.jsonc"]);
  assert.equal(imported.code, 0, imported.err);
  assert.match(imported.out, /Importing 2 people from CMS_DB \(remote\) into CMS_DB:[\s\S]*owner\s+owner\s+active[\s\S]*writer\s+editor\s+active[\s\S]*Imported 2\./);
  const db = s.db();
  assert.deepEqual(db.prepare("SELECT username, role, legacy_id FROM cms_users ORDER BY legacy_id").all().map((row) => [row.username, row.role, row.legacy_id]), [["owner", "owner", 1], ["writer", "editor", 2]]);
  assert.deepEqual(db.prepare("SELECT password_hash FROM cms_users ORDER BY legacy_id").all().map((row) => row.password_hash), db.prepare("SELECT password_hash FROM legacy_cms_users ORDER BY id").all().map((row) => row.password_hash));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_cms_users").get().n, 2);
});

test("P21 migrate refuses an old CMS's tables too, and with --rename-legacy sets them aside", async () => {
  const s = await site();
  // migrate needs migrations_dir: as setup would write it (the site folder is test/.tmp-…).
  writeFileSync(join(s.root, "wrangler.astro.jsonc"), s.config().replace(`"database_id": "${DB}"`, `"database_id": "${DB}", "migrations_dir": "../../migrations"`));
  const refused = await cli(s.root, ["migrate", "--config", "wrangler.astro.jsonc"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /has the tables of the CMS this site ran before/);
  const done = await cli(s.root, ["migrate", "--config", "wrangler.astro.jsonc", "--rename-legacy"]);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /tables renamed[\s\S]*Migrations applied \(remote\): 0001_draft_index\.sql/);
});
