// P12e: `vibe-cms import-legacy-users` — the people of the first site's hand-copied CMS (numeric ids, admin / editor,
// the same PBKDF2 hashes) into a set-up, empty Vibe CMS database; then they sign in with their OLD passwords through the
// package's real sign-in code. The CLI runs a fake `wrangler d1 execute` on real SQLite files (test/helpers/sqlite-wrangler.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createCmsAuth, createD1AuditLog } from "../dist/index.js";
import { run } from "../dist/cli/index.js";
import { legacyHashPassword, memoryKv, memoryLimiter } from "./helpers/sqlite-d1.mjs";

const fakeWrangler = fileURLToPath(new URL("./helpers/sqlite-wrangler.mjs", import.meta.url));
const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
const dirs = []; const open = [];
after(() => { open.forEach((database) => { try { database.close(); } catch { /* already closed */ } }); dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

// The first site's people tables (its migrations 0002 + 0003), as the copied CMS has them.
const LEGACY_SCHEMA = `
CREATE TABLE cms_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT, password_changed_at TEXT NOT NULL);
ALTER TABLE cms_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE cms_auth_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`;
const PASSWORDS = { Olivia: "olivia-old-password-1", eddie: "eddie-old-password-2", sam: "sam-temporary-pass-3" };

/** A site folder with wrangler.jsonc (the new, migrated CMS_DB) and wrangler.legacy.json (the old CMS's CMS_DB). */
const site = async () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-legacy-")); dirs.push(root);
  writeFileSync(join(root, "wrangler.jsonc"), JSON.stringify({ name: "w", d1_databases: [{ binding: "CMS_DB", database_name: "demo-cms", database_id: "target" }] }));
  writeFileSync(join(root, "wrangler.legacy.json"), JSON.stringify({ name: "w", d1_databases: [{ binding: "CMS_DB", database_name: "demo-old-cms", database_id: "legacy" }] }));
  const target = new DatabaseSync(join(root, "target.sqlite"));
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) target.exec(readFileSync(join(migrations, file), "utf8"));
  const legacy = new DatabaseSync(join(root, "legacy.sqlite"));
  legacy.exec(LEGACY_SCHEMA);
  const add = legacy.prepare("INSERT INTO cms_users (username, password_hash, role, status, created_at, updated_at, last_login_at, password_changed_at, session_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  add.run("Olivia", await legacyHashPassword(PASSWORDS.Olivia), "admin", "active", "2026-09-29T08:00:00.000Z", "2026-10-01T08:00:00.000Z", "2026-10-08T09:00:00.000Z", "2026-09-29T08:00:00.000Z", 3);
  add.run("eddie", await legacyHashPassword(PASSWORDS.eddie), "editor", "disabled", "2026-09-30T08:00:00.000Z", "2026-10-02T08:00:00.000Z", null, "2026-09-30T08:00:00.000Z", 1);
  add.run("sam", await legacyHashPassword(PASSWORDS.sam), "editor", "active", "2026-10-03T08:00:00.000Z", "2026-10-03T08:00:00.000Z", null, "2026-10-03T08:00:00.000Z", 1);
  legacy.exec("INSERT INTO cms_auth_state VALUES ('bootstrap_completed', 'true', '2026-09-29T08:00:00.000Z'), ('password_reset_required:3', 'true', '2026-10-03T08:00:00.000Z')");
  target.close(); legacy.close();
  return { root, db: (name) => { const database = new DatabaseSync(join(root, `${name}.sqlite`)); open.push(database); return database; } };
};
const cli = async (root, argv) => {
  const out = [], err = [];
  const saved = { ...process.env };
  Object.assign(process.env, { VIBE_CMS_WRANGLER: fakeWrangler, FAKE_D1_DIR: root });
  try { const code = await run(argv, { root, log: (line) => out.push(line), error: (line) => err.push(line) }); return { code, out: out.join("\n"), err: err.join("\n") }; }
  finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
};
const IMPORT = ["import-legacy-users", "--from", "CMS_DB", "--from-config", "wrangler.legacy.json", "--local"];

/** A D1-like database over one SQLite file, for the package's sign-in code. */
const d1Over = (database) => {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values.map((value) => (value === undefined ? null : value))),
    first: async () => { const row = database.prepare(sql).get(...params); return row === undefined ? null : { ...row }; },
    all: async () => ({ results: database.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    run: async () => { const result = database.prepare(sql).run(...params); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => statement(sql) };
};

test("dry run lists who comes over and writes nothing; the real run maps every person", async () => {
  const s = await site();
  const dry = await cli(s.root, [...IMPORT, "--dry-run"]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Would import 3 people[\s\S]*olivia\s+owner\s+active[\s\S]*eddie\s+editor\s+disabled[\s\S]*sam\s+editor\s+active\s+must change the temporary password[\s\S]*Dry run: nothing was written/);
  assert.equal(s.db("target").prepare("SELECT COUNT(*) AS n FROM cms_users").get().n, 0);

  const done = await cli(s.root, IMPORT);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /Imported 3\. Passwords are unchanged[\s\S]*bootstrap is marked as used/);
  const target = s.db("target");
  const people = target.prepare("SELECT username, display_name, role, status, must_change_password, session_version, legacy_id, last_login_at, id, password_hash FROM cms_users ORDER BY legacy_id").all();
  const legacy = s.db("legacy").prepare("SELECT password_hash FROM cms_users ORDER BY id").all();
  assert.deepEqual(people.map((row) => [row.username, row.display_name, row.role, row.status, row.must_change_password, row.session_version, row.legacy_id, row.last_login_at]), [
    ["olivia", "Olivia", "owner", "active", 0, 3, 1, "2026-10-08T09:00:00.000Z"],
    ["eddie", "eddie", "editor", "disabled", 0, 1, 2, null],
    ["sam", "sam", "editor", "active", 1, 1, 3, null],
  ]);
  assert.ok(people.every((row) => /^usr_[a-z2-7]{16}$/.test(row.id)), "internal text ids");
  assert.deepEqual(people.map((row) => row.password_hash), legacy.map((row) => row.password_hash), "the same hashes, byte for byte");
  assert.equal(target.prepare("SELECT value FROM cms_auth_state WHERE key = 'bootstrap_completed'").get().value, "true");
  assert.deepEqual(target.prepare("SELECT action, stage, detail FROM cms_audit_log ORDER BY id").all().map((row) => [row.action, row.stage, JSON.parse(row.detail).by]), [["user_create", "people", "cli"], ["user_create", "people", "cli"], ["user_create", "people", "cli"]]);

  const again = await cli(s.root, IMPORT);
  assert.equal(again.code, 1);
  assert.match(again.err, /already has 3 people — the import only goes into a database nobody uses yet/);
});

test("after the import they sign in with their OLD passwords (the package's sign-in code); disabled stays out; a temporary password must be changed", async () => {
  const s = await site();
  assert.equal((await cli(s.root, IMPORT)).code, 0);
  const db = d1Over(s.db("target"));
  const now = () => Date.UTC(2026, 9, 12, 10);
  const auth = createCmsAuth({ db, kv: memoryKv(now), audit: createD1AuditLog(db), siteUrl: "https://demo.example", bootstrap: { username: "olivia", password: "a-bootstrap-password-9" }, now, loginLimiter: memoryLimiter(10, 60_000, now), requireLoginLimiter: true });
  const login = async (username, password) => {
    const response = await auth.handleAuth(new Request("http://localhost/api/auth/login", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ username, password }) }));
    return { status: response.status, body: await response.json() };
  };
  const olivia = await login("OLIVIA", PASSWORDS.Olivia);
  assert.deepEqual([olivia.status, olivia.body.user?.role, olivia.body.mustChangePassword], [200, "owner", false], "the old admin is an owner, with the old password, any case");
  assert.equal((await login("eddie", PASSWORDS.eddie)).status, 401, "a disabled person stays out");
  const sam = await login("sam", PASSWORDS.sam);
  assert.deepEqual([sam.status, sam.body.mustChangePassword], [200, true]);
  assert.equal((await login("olivia", "a-bootstrap-password-9")).status, 401, "the bootstrap cannot make another owner: it is marked as used");
});

test("refusals: not an older CMS, unusable rows, an unmigrated target, --local without --from-config", async () => {
  const s = await site();
  assert.match((await cli(s.root, ["import-legacy-users", "--from", "CMS_DB", "--local"])).err, /--local needs --from-config/);
  assert.match((await cli(s.root, ["import-legacy-users"])).err, /needs --from/);
  // The new database as the source: it is already Vibe CMS.
  assert.match((await cli(s.root, ["import-legacy-users", "--from", "CMS_DB", "--from-config", "wrangler.jsonc", "--local"])).err, /already a Vibe CMS database/);
  const legacy = s.db("legacy");
  legacy.exec("UPDATE cms_users SET password_hash = 'plain-text' WHERE username = 'sam'");
  const bad = await cli(s.root, IMPORT);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /some people cannot come over as they are — nothing was imported:\n {2}sam: its password is not stored in the format this CMS checks/);
  assert.equal(s.db("target").prepare("SELECT COUNT(*) AS n FROM cms_users").get().n, 0);
  writeFileSync(join(s.root, "empty.sqlite"), "");
  writeFileSync(join(s.root, "wrangler.empty.json"), JSON.stringify({ d1_databases: [{ binding: "CMS_DB", database_name: "x", database_id: "empty" }] }));
  legacy.exec("UPDATE cms_users SET password_hash = (SELECT password_hash FROM cms_users WHERE username = 'eddie') WHERE username = 'sam'");
  assert.match((await cli(s.root, [...IMPORT, "--config", "wrangler.empty.json"])).err, /CMS_DB is not set up for Vibe CMS yet/);
});
