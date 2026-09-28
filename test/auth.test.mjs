// P6: sign-in + People on the real SQL (node:sqlite with the package migrations), a TTL KV and rate limiters on an
// injectable clock. The same wiring runs in `wrangler dev --local` in scripts/auth-local.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentPaths, createBundledSource, createCmsApi, createCmsAuth, createD1AuditLog, createD1DraftStore, hashPassword, insertUser, loadCmsConfig,
  PBKDF2_ITERATIONS, userFromLegacyRow, verifyPassword,
} from "../dist/index.js";
import { createSqliteD1, legacyHashPassword, memoryKv, memoryLimiter } from "./helpers/sqlite-d1.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});

const BOOT = { username: "owner", password: "bootstrap-secret-123" };
const setup = ({ bootstrap = BOOT, loginLimiter = true, publishLimit = 20, ttl } = {}) => {
  let clock = Date.UTC(2026, 8, 28, 12);
  const now = () => clock;
  const db = createSqliteD1();
  const kv = memoryKv(now);
  const audit = createD1AuditLog(db);
  const auth = createCmsAuth({ db, kv, audit, siteUrl: "https://demo.example", bootstrap, sessionTtlSeconds: ttl, now, requireLoginLimiter: true, ...(loginLimiter ? { loginLimiter: memoryLimiter(10, 60_000, now) } : {}) });
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createD1DraftStore(db), audit, identify: auth.identify, people: auth.people, publishLimiter: memoryLimiter(publishLimit, 60_000, now), requirePublishLimiter: true, publisher: { head: async () => ({ sha: "x" }), readFiles: async () => ({}), commit: async () => ({ sha: "y" }) } });
  const request = async (method, path, { body, cookie, origin = "http://localhost", ip = "203.0.113.7" } = {}) => {
    const headers = { "cf-connecting-ip": ip, ...(origin ? { origin } : {}), ...(cookie ? { cookie: `vibe_cms_session=${cookie}` } : {}) };
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const target = new Request(`http://localhost${path}`, init);
    const response = await (path.startsWith("/api/auth/") ? auth.handleAuth(target) : api.handle(target));
    const setCookie = response.headers.get("set-cookie") ?? "";
    return { status: response.status, body: await response.json(), setCookie, cookie: /vibe_cms_session=([^;]*)/.exec(setCookie)?.[1] || undefined, headers: Object.fromEntries(response.headers) };
  };
  const login = async (username, password, options) => request("POST", "/api/auth/login", { body: { username, password }, ...options });
  const auditRows = async () => (await audit.list({ limit: 1000 })).reverse();
  return { db, kv, auth, api, request, login, auditRows, advance: (ms) => { clock += ms; } };
};
/** Bootstrap the owner and replace the temporary password; returns the owner's cookie + id. */
const owner = async (h) => {
  const first = await h.login(BOOT.username, BOOT.password);
  const changed = await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: BOOT.password, newPassword: "owner-password-456" } });
  return { cookie: changed.cookie, id: first.body.user.id };
};
const addPerson = async (h, ownerCookie, username, role, password) => {
  const created = await h.request("POST", "/api/cms/users", { cookie: ownerCookie, body: { username, role, displayName: `${username} name`, ...(password ? { password } : {}) } });
  return created;
};

// ------------------------------------------------------------------ passwords

test("password hash: same format and parameters as the first site; verifies; rejects weaker / malformed hashes", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.match(hash, /^pbkdf2-sha256-v1\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  assert.equal(await verifyPassword("correct horse batterY", hash), false);
  assert.equal(await verifyPassword("x", hash.replace("$100000$", "$1000$")), false, "fewer than 100,000 iterations is refused");
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  const legacy = await legacyHashPassword("legacy-password-789");
  assert.equal(await verifyPassword("legacy-password-789", legacy), true, "a hash made by the first site's own code verifies");
});

test("a user imported from the first site's cms_users signs in with the same password (no reset)", async () => {
  const h = setup();
  const legacyRow = { id: 7, username: "Maria", password_hash: await legacyHashPassword("legacy-password-789"), role: "admin", status: "active", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z", last_login_at: null, password_changed_at: "2026-01-01T00:00:00.000Z", session_version: 3 };
  const row = userFromLegacyRow(legacyRow);
  assert.deepEqual([row.username, row.role, row.legacy_id, row.session_version, row.must_change_password], ["maria", "owner", 7, 3, 0]);
  await insertUser(h.db, row);
  const result = await h.login("maria", "legacy-password-789");
  assert.equal(result.status, 200);
  assert.equal(result.body.user.role, "owner");
  assert.equal(result.body.mustChangePassword, false);
});

// ------------------------------------------------------------------ bootstrap + first password

test("bootstrap: the first sign-in with the secrets creates the owner once, who must change the password", async () => {
  const h = setup();
  const first = await h.login(BOOT.username, BOOT.password);
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.user.role, first.body.mustChangePassword], ["owner", true]);
  assert.match(first.body.user.id, /^usr_[a-z2-7]{16}$/);
  const blocked = await h.request("GET", "/api/cms/content", { cookie: first.cookie });
  assert.deepEqual([blocked.status, blocked.body.error], [403, "password_change_required"]);
  const wrongCurrent = await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: "nope-nope-nope", newPassword: "owner-password-456" } });
  assert.deepEqual([wrongCurrent.status, wrongCurrent.body.error], [400, "wrong_current_password"]);
  const same = await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: BOOT.password, newPassword: BOOT.password } });
  assert.equal(same.body.error, "same_password");
  const short = await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: BOOT.password, newPassword: "short" } });
  assert.equal(short.body.error, "invalid_password");
  const changed = await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: BOOT.password, newPassword: "owner-password-456" } });
  assert.equal(changed.status, 200);
  assert.equal((await h.request("GET", "/api/cms/content", { cookie: first.cookie })).status, 401, "the old session ended with the password change");
  assert.equal((await h.request("GET", "/api/cms/content", { cookie: changed.cookie })).status, 200, "the new session works");
  const again = await h.login(BOOT.username, BOOT.password);
  assert.deepEqual([again.status, again.body.error], [401, "invalid_credentials"], "the bootstrap password no longer works");
  assert.ok((await h.auditRows()).some((row) => row.action === "bootstrap"));
});

test("bootstrap is closed for good once used, even if the users table were emptied", async () => {
  const h = setup();
  await owner(h);
  h.db.raw.exec("DELETE FROM cms_users");
  assert.equal((await h.login(BOOT.username, BOOT.password)).status, 401);
});

test("two first sign-ins at the same time create exactly one owner", async () => {
  const h = setup();
  const results = await Promise.all([h.login(BOOT.username, BOOT.password, { ip: "1.1.1.1" }), h.login(BOOT.username, BOOT.password, { ip: "2.2.2.2" })]);
  assert.equal(Number(h.db.raw.prepare("SELECT COUNT(*) AS c FROM cms_users").get().c), 1);
  assert.ok(results.some((result) => result.status === 200));
});

// ------------------------------------------------------------------ failures, rate limit, origin, sessions

test("wrong password, unknown user, disabled user → the same 401 message; audited without the typed name", async () => {
  const h = setup();
  const { cookie, id } = await owner(h);
  const created = await addPerson(h, cookie, "editor1", "editor", "editor-password-1");
  const wrong = await h.login("owner", "not-the-password");
  const unknown = await h.login("nobody-here", "whatever-password");
  await h.request("PATCH", `/api/cms/users/${created.body.user.id}`, { cookie, body: { action: "disable" } });
  const disabled = await h.login("editor1", "editor-password-1");
  for (const result of [wrong, unknown, disabled]) assert.deepEqual([result.status, result.body.error, result.body.message], [401, "invalid_credentials", "Username or password is incorrect."]);
  const failed = (await h.auditRows()).filter((row) => row.action === "login_failed");
  assert.deepEqual(failed.map((row) => [row.userId === id ? "owner" : row.userId === "anonymous" ? "anonymous" : "editor", row.detail.reason]), [["owner", "wrong_password"], ["anonymous", "unknown_user"], ["editor", "disabled"]]);
  assert.ok(!JSON.stringify(failed).includes("nobody-here"), "an unknown typed username is not stored");
});

test("rate limit: 10 sign-ins per minute per username + IP, then 429 with retry-after; another IP or a minute later is fine", async () => {
  const h = setup();
  await owner(h);
  for (let attempt = 1; attempt <= 10; attempt += 1) assert.equal((await h.login("owner", "wrong-password-x", { ip: "198.51.100.1" })).status, 401);
  const limited = await h.login("owner", "owner-password-456", { ip: "198.51.100.1" });
  assert.deepEqual([limited.status, limited.body.error, limited.headers["retry-after"]], [429, "too_many_attempts", "60"]);
  assert.equal((await h.login("owner", "owner-password-456", { ip: "198.51.100.2" })).status, 200, "another IP is not limited");
  h.advance(61_000);
  assert.equal((await h.login("owner", "owner-password-456", { ip: "198.51.100.1" })).status, 200, "a minute later it works again");
});

test("production without a login limiter → 503 (sign-in refused)", async () => {
  const h = setup({ loginLimiter: false });
  const result = await h.login(BOOT.username, BOOT.password);
  assert.deepEqual([result.status, result.body.error], [503, "login_limiter_missing"]);
});

test("sign-in and People refuse another Origin (403); a missing Origin too", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  assert.equal((await h.login("owner", "owner-password-456", { origin: "https://evil.example" })).body.error, "origin_forbidden");
  assert.equal((await h.request("POST", "/api/auth/logout", { cookie, origin: null })).status, 403);
  const people = await h.request("POST", "/api/cms/users", { cookie, origin: "https://evil.example", body: { username: "x-user", role: "editor" } });
  assert.deepEqual([people.status, people.body.error], [403, "origin_forbidden"]);
  assert.equal((await h.login("owner", "owner-password-456", { origin: "https://demo.example" })).status, 200, "the site's own URL (cms.config site.url) is accepted");
});

test("session cookie: HttpOnly, Secure, SameSite=Lax, 30 days; stored in KV under sha256(token), never the token itself", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  const result = await h.login("owner", "owner-password-456");
  assert.match(result.setCookie, /^vibe_cms_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(h.kv.keys().every((key) => key.startsWith("cms:auth:session:") && !key.includes(cookie) && !key.includes(result.cookie)));
  const me = await h.request("GET", "/api/auth/me", { cookie: result.cookie });
  assert.equal(me.body.user.username, "owner");
  assert.ok(!("password_hash" in me.body.user) && !JSON.stringify(me.body).includes("pbkdf2"));
});

test("sessions expire: 30 days by default, CMS_SESSION_TTL_SECONDS when set", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  h.advance(30 * 24 * 3600 * 1000 - 5_000);
  assert.equal((await h.request("GET", "/api/auth/me", { cookie })).status, 200);
  h.advance(10_000);
  assert.equal((await h.request("GET", "/api/auth/me", { cookie })).status, 401);
  const short = setup({ ttl: "300" });
  const shortCookie = (await owner(short)).cookie;
  short.advance(301_000);
  assert.equal((await short.request("GET", "/api/cms/content", { cookie: shortCookie })).status, 401);
});

test("logout ends the session and clears the cookie", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  const out = await h.request("POST", "/api/auth/logout", { cookie });
  assert.match(out.setCookie, /^vibe_cms_session=; Max-Age=0;/);
  assert.equal((await h.request("GET", "/api/cms/content", { cookie })).status, 401);
});

// ------------------------------------------------------------------ People

test("People: owner adds an editor (temporary password shown once), editor must change it; editor gets 403 on People", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  const created = await addPerson(h, cookie, "Editor1", "editor");
  assert.equal(created.status, 201);
  assert.match(created.body.temporaryPassword, /^[A-Za-z2-9]{20}$/);
  assert.deepEqual([created.body.user.username, created.body.user.displayName, created.body.user.role, created.body.user.mustChangePassword], ["editor1", "Editor1 name", "editor", true]);
  const editor = await h.login("editor1", created.body.temporaryPassword);
  assert.equal(editor.body.mustChangePassword, true);
  const changed = await h.request("PUT", "/api/auth/password", { cookie: editor.cookie, body: { currentPassword: created.body.temporaryPassword, newPassword: "editor-own-password" } });
  const denied = await h.request("GET", "/api/cms/users", { cookie: changed.cookie });
  assert.deepEqual([denied.status, denied.body.error], [403, "owner_only"]);
  assert.equal((await h.request("GET", "/api/cms/content", { cookie: changed.cookie })).status, 200);
  const list = await h.request("GET", "/api/cms/users", { cookie });
  assert.deepEqual(list.body.users.map((user) => [user.username, user.role]), [["editor1", "editor"], ["owner", "owner"]]);
  assert.ok(!JSON.stringify(list.body).includes("pbkdf2"));
  assert.deepEqual((await addPerson(h, cookie, "editor1", "editor")).body.error, "username_taken");
  assert.equal((await addPerson(h, cookie, "x", "editor")).body.error, "invalid_username");
  assert.equal((await addPerson(h, cookie, "editor2", "admin")).body.error, "invalid_role");
  assert.equal((await addPerson(h, cookie, "editor2", "editor", "short")).body.error, "invalid_password");
});

test("People: disable → 401 at once; enable; reset password → sessions end + must change; role change applies at once", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  const created = await addPerson(h, cookie, "editor1", "editor", "editor-password-1");
  const id = created.body.user.id;
  const first = await h.login("editor1", "editor-password-1");
  const editorCookie = (await h.request("PUT", "/api/auth/password", { cookie: first.cookie, body: { currentPassword: "editor-password-1", newPassword: "editor-own-password" } })).cookie;
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "disable" } })).status, 200);
  assert.equal((await h.request("GET", "/api/cms/content", { cookie: editorCookie })).status, 401, "disabled → the next request is refused");
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "enable" } })).body.user.status, "active");
  const again = (await h.login("editor1", "editor-own-password")).cookie;
  const reset = await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "reset-password" } });
  assert.match(reset.body.temporaryPassword, /^[A-Za-z2-9]{20}$/);
  assert.equal((await h.request("GET", "/api/cms/content", { cookie: again })).status, 401, "reset ends the sessions");
  const afterReset = await h.login("editor1", reset.body.temporaryPassword);
  assert.equal(afterReset.body.mustChangePassword, true);
  const own = (await h.request("PUT", "/api/auth/password", { cookie: afterReset.cookie, body: { currentPassword: reset.body.temporaryPassword, newPassword: "editor-password-3" } })).cookie;
  assert.equal((await h.request("GET", "/api/cms/users", { cookie: own })).status, 403);
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "set-role", role: "owner" } })).body.user.role, "owner");
  assert.equal((await h.request("GET", "/api/cms/users", { cookie: own })).status, 200, "promoted → People works on the same session");
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "rename" } })).body.error, "unsupported_action");
  assert.equal((await h.request("PATCH", "/api/cms/users/usr_nobody", { cookie, body: { action: "enable" } })).status, 404);
});

test("People: the last active owner cannot be disabled or demoted; you cannot disable yourself", async () => {
  const h = setup();
  const { cookie, id } = await owner(h);
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "disable" } })).body.error, "cannot_disable_self");
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "set-role", role: "editor" } })).body.error, "last_owner");
  const second = await addPerson(h, cookie, "owner2", "owner", "owner2-password-1");
  assert.equal((await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body: { action: "set-role", role: "editor" } })).status, 200, "with a second owner, demoting is fine");
  const secondCookie = (await h.request("PUT", "/api/auth/password", { cookie: (await h.login("owner2", "owner2-password-1")).cookie, body: { currentPassword: "owner2-password-1", newPassword: "owner2-password-2" } })).cookie;
  assert.equal((await h.request("PATCH", `/api/cms/users/${second.body.user.id}`, { cookie: secondCookie, body: { action: "set-role", role: "editor" } })).body.error, "last_owner");
});

test("every People / sign-in change is audited, with no password, hash or token", async () => {
  const h = setup();
  const { cookie } = await owner(h);
  const created = await addPerson(h, cookie, "editor1", "editor");
  const id = created.body.user.id;
  for (const body of [{ action: "disable" }, { action: "enable" }, { action: "reset-password" }, { action: "set-role", role: "owner" }]) await h.request("PATCH", `/api/cms/users/${id}`, { cookie, body });
  await h.request("POST", "/api/auth/logout", { cookie });
  const rows = await h.auditRows();
  const actions = rows.map((row) => row.action);
  for (const action of ["bootstrap", "login", "password_change", "user_create", "user_disable", "user_enable", "user_password_reset", "user_role_change", "logout"]) assert.ok(actions.includes(action), action);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(created.body.temporaryPassword) && !text.includes("pbkdf2") && !text.includes(BOOT.password) && !text.includes("owner-password-456") && !text.includes(cookie));
  assert.ok(rows.every((row) => row.userId === "anonymous" || /^usr_[a-z2-7]{16}$/.test(row.userId)));
});

test("publish rate limit: the (n+1)th publish in a minute → 429; production without the limiter → 503", async () => {
  const h = setup({ publishLimit: 1 });
  const { cookie } = await owner(h);
  const first = await h.request("POST", "/api/cms/publish", { cookie, body: { resources: ["file:site"] } });
  assert.equal(first.body.error, "no_draft", "the first one passes the limiter");
  const second = await h.request("POST", "/api/cms/publish", { cookie, body: { resources: ["file:site"] } });
  assert.deepEqual([second.status, second.body.error, second.body.retryAfter], [429, "too_many_publishes", 60]);
  const noLimiter = createCmsApi({ config, source: createBundledSource(files), drafts: createD1DraftStore(h.db), audit: createD1AuditLog(h.db), identify: h.auth.identify, requirePublishLimiter: true, publisher: { head: async () => ({ sha: "x" }), readFiles: async () => ({}), commit: async () => ({ sha: "y" }) } });
  const response = await noLimiter.handle(new Request("http://localhost/api/cms/publish", { method: "POST", headers: { origin: "http://localhost", cookie: `vibe_cms_session=${cookie}` }, body: JSON.stringify({ resources: ["file:site"] }) }));
  assert.deepEqual([response.status, (await response.json()).error], [503, "publish_limiter_missing"]);
});

test("the migrations keep existing audit rows when the audit table is widened (0005)", async () => {
  const h = setup();
  const columns = h.db.raw.prepare("PRAGMA table_info(cms_users)").all().map((row) => row.name);
  assert.deepEqual(columns, ["id", "username", "display_name", "password_hash", "role", "status", "must_change_password", "session_version", "created_at", "updated_at", "last_login_at", "password_changed_at", "legacy_id"]);
  const audit = h.db.raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'cms_audit_log'").get().sql;
  assert.match(audit, /'login_failed'/);
  assert.match(audit, /'people'/);
});
