/**
 * P6: sign-in and People, the same mechanism as the CMS already running on the first site (see password.ts):
 * username + password; a random 32-byte token in a cookie (HttpOnly; Secure; SameSite=Lax); the session in KV under
 * sha256(token), 30 days; users.session_version bumped on password change / disable → every session ends; login rate
 * limit 10/min per (username + IP) (a Workers rate-limit binding; missing in production → 503); one generic error for
 * any failed sign-in; the first owner comes from bootstrap secrets on the first sign-in, then bootstrap is closed.
 * Roles are read from D1 on every request, so disabling or demoting someone applies at once.
 *
 * Routes: /api/auth/login (POST), /logout (POST), /me (GET), /password (PUT) via handleAuth; People (/api/cms/users…,
 * owner only) via `people`, called by the CMS API after it has checked identity and Origin.
 */
import type { AuditEntry, AuditLog, Role } from "../locks/index.js";
import type { D1Like } from "../store/index.js";
import {
  decoyHash, encodeBase64Url, hashPassword, InputError, normalizeUsername, randomBytes, sameSecret, temporaryPassword, validateDisplayName, validatePassword,
  validateUsername, verifyPassword,
} from "./password.js";

export * from "./password.js";

export type Identity = { userId: string; role: Role; mustChangePassword?: boolean };
/** undefined = sign-in not set up (503); null = not signed in (401). */
export type Identify = (request: Request) => Identity | null | undefined | Promise<Identity | null | undefined>;

export interface SessionKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
/** Cloudflare's Workers rate-limiting binding. */
export interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }

export const SESSION_COOKIE = "vibe_cms_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_PREFIX = "cms:auth:session:";

export type UserRow = {
  id: string; username: string; display_name: string; password_hash: string; role: Role; status: "active" | "disabled";
  must_change_password: number; session_version: number; created_at: string; updated_at: string; last_login_at: string | null;
  password_changed_at: string; legacy_id: number | null;
};
export type PublicUser = {
  id: string; username: string; displayName: string; role: Role; status: "active" | "disabled"; mustChangePassword: boolean;
  createdAt: string; updatedAt: string; lastLoginAt: string | null; passwordChangedAt: string;
};
export const publicUser = (row: UserRow): PublicUser => ({
  id: row.id, username: row.username, displayName: row.display_name, role: row.role, status: row.status, mustChangePassword: row.must_change_password === 1,
  createdAt: row.created_at, updatedAt: row.updated_at, lastLoginAt: row.last_login_at, passwordChangedAt: row.password_changed_at,
});
const COLUMNS = "id, username, display_name, password_hash, role, status, must_change_password, session_version, created_at, updated_at, last_login_at, password_changed_at, legacy_id";

/** A new internal user id: "usr_" + 16 random base32 characters. */
export const newUserId = () => `usr_${[...randomBytes(16)].map((byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte % 32]).join("")}`;

// ---------------------------------------------------------------- import from the old CMS (P21)

/** A row of the old CMS's cms_users table (numeric id, admin / editor). */
export type LegacyUserRow = {
  id: number; username: string; password_hash: string; role: "admin" | "editor"; status: "active" | "disabled";
  created_at: string; updated_at: string; last_login_at: string | null; password_changed_at: string; session_version?: number | null;
};
/** The Vibe row for an old-CMS user: same username, same password hash (no reset), admin → owner. */
export const userFromLegacyRow = (row: LegacyUserRow, id = newUserId()): UserRow => ({
  id, username: normalizeUsername(row.username), display_name: row.username, password_hash: row.password_hash, role: row.role === "admin" ? "owner" : "editor",
  status: row.status === "disabled" ? "disabled" : "active", must_change_password: 0,
  session_version: Number.isSafeInteger(row.session_version) && (row.session_version as number) > 0 ? (row.session_version as number) : 1,
  created_at: row.created_at, updated_at: row.updated_at, last_login_at: row.last_login_at, password_changed_at: row.password_changed_at, legacy_id: row.id,
});
export const insertUser = async (db: D1Like, row: UserRow) => {
  await db.prepare(`INSERT INTO cms_users (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.username, row.display_name, row.password_hash, row.role, row.status, row.must_change_password, row.session_version, row.created_at, row.updated_at, row.last_login_at, row.password_changed_at, row.legacy_id).run();
};

// ---------------------------------------------------------------- the auth service

class AuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly headers: Record<string, string> = {}, public readonly extra: Record<string, unknown> = {}) {
    super(message); this.name = "AuthError";
  }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
const errorResponse = (error: AuthError) => json({ error: error.code, message: error.message, ...error.extra }, error.status, error.headers);

export type CmsAuthDeps = {
  db?: D1Like | undefined;
  kv?: SessionKv | undefined;
  audit?: AuditLog | undefined;
  /** The site's public URL (cms.config site.url): its origin is accepted besides the request's own. */
  siteUrl?: string;
  loginLimiter?: RateLimiter | undefined;
  /** true in production builds: no limiter → sign-in answers 503. */
  requireLoginLimiter?: boolean;
  bootstrap?: { username?: unknown; password?: unknown };
  sessionTtlSeconds?: unknown;
  /** The local development identity (P5 devIdentity) — tried first; undefined in production. */
  devIdentity?: Identify;
  cookieName?: string;
  /** Milliseconds; injectable for tests. */
  now?: () => number;
};

export const createCmsAuth = (deps: CmsAuthDeps) => {
  const now = deps.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const cookieName = deps.cookieName ?? SESSION_COOKIE;
  const ttl = (() => { const value = Number(deps.sessionTtlSeconds); return Number.isInteger(value) && value >= 300 && value <= SESSION_TTL_SECONDS ? value : SESSION_TTL_SECONDS; })();
  const ready = () => Boolean(deps.db && deps.kv);
  const db = () => deps.db as D1Like;
  const kv = () => deps.kv as SessionKv;

  const audit = async (entry: Omit<AuditEntry, "at">) => { if (deps.audit) await deps.audit.record({ at: iso(), ...entry }); };
  const byId = (id: string) => db().prepare(`SELECT ${COLUMNS} FROM cms_users WHERE id = ? LIMIT 1`).bind(id).first<UserRow>();
  const byUsername = (username: string) => db().prepare(`SELECT ${COLUMNS} FROM cms_users WHERE username = ? COLLATE NOCASE LIMIT 1`).bind(username).first<UserRow>();
  const activeOwners = async () => Number((await db().prepare("SELECT COUNT(*) AS count FROM cms_users WHERE role = 'owner' AND status = 'active'").first<{ count: number }>())?.count ?? 0);

  // ---- sessions
  const sessionKey = async (token: string) => `${SESSION_PREFIX}${encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))}`;
  const tokenOf = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
  const cookie = (token: string, maxAge: number) => `${cookieName}=${token}; Max-Age=${Math.max(0, Math.floor(maxAge))}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  const createSession = async (user: UserRow) => {
    const token = encodeBase64Url(randomBytes(32));
    const expiresAt = now() + ttl * 1000;
    await kv().put(await sessionKey(token), JSON.stringify({ userId: user.id, sessionVersion: user.session_version, issuedAt: iso(), expiresAt }), { expirationTtl: ttl });
    return { token, expiresAt, setCookie: cookie(token, ttl) };
  };
  const clearSession = async (token: string) => { if (token) await kv().delete(await sessionKey(token)); };
  const session = async (request: Request): Promise<{ token: string; user: UserRow; expiresAt: number } | null> => {
    const token = tokenOf(request);
    if (!token || !ready()) return null;
    const stored = await kv().get(await sessionKey(token));
    if (!stored) return null;
    try {
      const value = JSON.parse(stored) as { userId: string; sessionVersion: number; expiresAt: number };
      const user = typeof value.userId === "string" ? await byId(value.userId) : null;
      if (!user || user.status !== "active" || user.session_version !== value.sessionVersion || !(value.expiresAt > now())) { await clearSession(token); return null; }
      return { token, user, expiresAt: value.expiresAt };
    } catch { await clearSession(token); return null; }
  };

  const identify: Identify = async (request) => {
    const dev = await deps.devIdentity?.(request);
    if (dev) return dev;
    if (!ready()) return undefined;
    const current = await session(request);
    return current ? { userId: current.user.id, role: current.user.role, mustChangePassword: current.user.must_change_password === 1 } : null;
  };

  // ---- request helpers
  const sameSite = (request: Request) => {
    const origin = request.headers.get("origin");
    if (!origin) return false;
    const allowed = new Set([new URL(request.url).origin]);
    try { if (deps.siteUrl) allowed.add(new URL(deps.siteUrl).origin); } catch { /* checked by the config check */ }
    return allowed.has(origin);
  };
  const body = async (request: Request): Promise<Record<string, unknown>> => {
    const text = await request.text();
    if (text.length > 10_000) throw new AuthError(413, "payload_too_large", "The request is too large.");
    try { const value = JSON.parse(text || "null"); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* below */ }
    throw new AuthError(400, "bad_json", "The request body must be a JSON object.");
  };
  const input = <T>(run: () => T): T => { try { return run(); } catch (error) { if (error instanceof InputError) throw new AuthError(400, error.code, error.message); throw error; } };
  const clientKey = (request: Request, username: string) => `cms-login:${username}:${(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 100)}`;

  /** Password guesses (sign-in, and the current password when changing it): 10 / minute per key, 503 without a limiter in production. */
  const limitAttempts = async (key: string) => {
    if (deps.loginLimiter) {
      let allowed: boolean;
      try { allowed = (await deps.loginLimiter.limit({ key })).success; } catch { throw new AuthError(503, "limiter_unavailable", "The sign-in service is temporarily unavailable. Please try again."); }
      if (!allowed) throw new AuthError(429, "too_many_attempts", "Too many sign-in attempts. Please try again in a minute.", { "retry-after": "60" });
    } else if (deps.requireLoginLimiter) throw new AuthError(503, "login_limiter_missing", "Sign-in rate limiting is not configured.");
  };

  // ---- sign-in routes
  const login = async (request: Request) => {
    if (!ready()) throw new AuthError(503, "auth_not_configured", "Sign-in is not configured on this site.");
    const payload = await body(request);
    const invalid = () => new AuthError(401, "invalid_credentials", "Username or password is incorrect.");
    let username = "";
    try { username = validateUsername(payload.username); } catch { /* generic failure below */ }
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!username || !password) throw invalid();
    await limitAttempts(clientKey(request, username));

    let user = await byUsername(username);
    if (!user) user = await bootstrap(username, password);
    if (!user) {
      await verifyPassword(password, decoyHash); // same cost as a real check: no "this username exists" timing hint
      await audit({ userId: "anonymous", role: "anonymous", action: "login_failed", stage: "auth", resource: "auth", detail: { reason: "unknown_user" } });
      throw invalid();
    }
    if (user.status !== "active" || !(await verifyPassword(password, user.password_hash))) {
      await audit({ userId: user.id, role: user.role, action: "login_failed", stage: "auth", resource: "auth", detail: { reason: user.status !== "active" ? "disabled" : "wrong_password" } });
      throw invalid();
    }
    await db().prepare("UPDATE cms_users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(iso(), iso(), user.id).run();
    const created = await createSession(user);
    await audit({ userId: user.id, role: user.role, action: "login", stage: "auth", resource: "auth", detail: {} });
    const fresh = (await byId(user.id)) ?? user;
    return json({ ok: true, user: publicUser(fresh), mustChangePassword: fresh.must_change_password === 1, expiresAt: created.expiresAt }, 200, { "set-cookie": created.setCookie });
  };

  /** The first owner, from the bootstrap secrets, once: no users yet, bootstrap not done, exact username + password. */
  const bootstrap = async (username: string, password: string): Promise<UserRow | null> => {
    const wantedUser = (() => { try { return validateUsername(deps.bootstrap?.username); } catch { return ""; } })();
    const wantedPassword = typeof deps.bootstrap?.password === "string" ? deps.bootstrap.password.replace(/\r?\n$/, "") : "";
    if (!wantedUser || !wantedPassword || username !== wantedUser || !(await sameSecret(password, wantedPassword))) return null;
    const done = await db().prepare("SELECT value FROM cms_auth_state WHERE key = 'bootstrap_completed' LIMIT 1").first<{ value: string }>();
    const count = Number((await db().prepare("SELECT COUNT(*) AS count FROM cms_users").first<{ count: number }>())?.count ?? 0);
    if (done || count > 0) return null;
    try { validatePassword(wantedPassword); } catch { return null; }
    const at = iso();
    const row: UserRow = { id: newUserId(), username, display_name: username, password_hash: await hashPassword(wantedPassword), role: "owner", status: "active", must_change_password: 1, session_version: 1, created_at: at, updated_at: at, last_login_at: null, password_changed_at: at, legacy_id: null };
    // Mark first: two parallel first sign-ins cannot both create an owner.
    const claimed = await db().prepare("INSERT INTO cms_auth_state (key, value, updated_at) VALUES ('bootstrap_completed', 'true', ?) ON CONFLICT (key) DO NOTHING RETURNING key").bind(at).first();
    if (!claimed) return null;
    await insertUser(db(), row);
    await audit({ userId: row.id, role: "owner", action: "bootstrap", stage: "auth", resource: `user:${row.id}`, detail: { username } });
    return row;
  };

  const logout = async (request: Request) => {
    const current = ready() ? await session(request) : null;
    if (ready()) await clearSession(tokenOf(request));
    if (current) await audit({ userId: current.user.id, role: current.user.role, action: "logout", stage: "auth", resource: "auth", detail: {} });
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  };

  const me = async (request: Request) => {
    const dev = await deps.devIdentity?.(request);
    if (dev) return json({ ok: true, user: { id: dev.userId, username: dev.userId, displayName: "Local developer", role: dev.role, status: "active", mustChangePassword: false }, dev: true });
    if (!ready()) throw new AuthError(503, "auth_not_configured", "Sign-in is not configured on this site.");
    const current = await session(request);
    if (!current) throw new AuthError(401, "unauthenticated", "Your session has expired. Please sign in again.");
    return json({ ok: true, user: publicUser(current.user), mustChangePassword: current.user.must_change_password === 1, expiresAt: current.expiresAt });
  };

  const changePassword = async (request: Request) => {
    if (!ready()) throw new AuthError(503, "auth_not_configured", "Sign-in is not configured on this site.");
    const current = await session(request);
    if (!current) throw new AuthError(401, "unauthenticated", "Your session has expired. Please sign in again.");
    const payload = await body(request);
    const next = input(() => validatePassword(payload.newPassword));
    const old = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
    // A stolen session must not become a way to guess the password at full speed.
    await limitAttempts(`cms-password:${current.user.id}`);
    if (!(await verifyPassword(old, current.user.password_hash))) throw new AuthError(400, "wrong_current_password", "Current password is incorrect.");
    if (old === next) throw new AuthError(400, "same_password", "Choose a new password that is different from the current one.");
    const at = iso();
    await db().prepare("UPDATE cms_users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(await hashPassword(next), at, at, current.user.id).run();
    await clearSession(current.token);
    const refreshed = (await byId(current.user.id))!;
    const created = await createSession(refreshed);
    await audit({ userId: refreshed.id, role: refreshed.role, action: "password_change", stage: "auth", resource: `user:${refreshed.id}`, detail: {} });
    return json({ ok: true, user: publicUser(refreshed) }, 200, { "set-cookie": created.setCookie });
  };

  /** /api/auth/* */
  const handleAuth = async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
      const routes: Record<string, Record<string, (request: Request) => Promise<Response>>> = { "/login": { POST: login }, "/logout": { POST: logout }, "/me": { GET: me }, "/password": { PUT: changePassword } };
      const route = routes[path];
      if (!route) throw new AuthError(404, "not_found", "Not a sign-in route.");
      const handler = route[request.method];
      if (!handler) throw new AuthError(405, "method_not_allowed", `${request.method} is not allowed here.`, { allow: Object.keys(route).join(", ") });
      if (request.method !== "GET" && !sameSite(request)) throw new AuthError(403, "origin_forbidden", "Requests must come from this site.");
      return await handler(request);
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error);
      return json({ error: "internal_error", message: "Something went wrong with sign-in." }, 500);
    }
  };

  // ---------------------------------------------------------------- People (owner only)

  /** /api/cms/users and /api/cms/users/:id — called by the CMS API with the checked identity (Origin already checked). */
  const people = async (request: Request, user: Identity, id?: string): Promise<Response> => {
    try {
      if (!ready()) throw new AuthError(503, "auth_not_configured", "Sign-in is not configured on this site.");
      if (user.role !== "owner") throw new AuthError(403, "owner_only", "Only an owner can manage people.");
      const actor = { userId: user.userId, role: user.role };
      const log = (action: AuditEntry["action"], targetId: string, detail: Record<string, unknown>) => audit({ ...actor, action, stage: "people", resource: `user:${targetId}`, detail });
      if (!id) {
        if (request.method === "GET") return json({ users: (await db().prepare(`SELECT ${COLUMNS} FROM cms_users ORDER BY username`).all<UserRow>()).results.map(publicUser) });
        if (request.method !== "POST") throw new AuthError(405, "method_not_allowed", `${request.method} is not allowed here.`, { allow: "GET, POST" });
        const payload = await body(request);
        const username = input(() => validateUsername(payload.username));
        const role = input(() => { if (payload.role !== "owner" && payload.role !== "editor") throw new InputError("invalid_role", "Role must be owner or editor."); return payload.role as Role; });
        const displayName = input(() => validateDisplayName(payload.displayName, username));
        const generated = payload.password === undefined || payload.password === "" ? temporaryPassword() : undefined;
        const password = input(() => validatePassword(generated ?? payload.password));
        if (await byUsername(username)) throw new AuthError(409, "username_taken", "That username is already in use.");
        const at = iso();
        const row: UserRow = { id: newUserId(), username, display_name: displayName, password_hash: await hashPassword(password), role, status: "active", must_change_password: 1, session_version: 1, created_at: at, updated_at: at, last_login_at: null, password_changed_at: at, legacy_id: null };
        await insertUser(db(), row);
        await log("user_create", row.id, { username, role });
        return json({ ok: true, user: publicUser(row), ...(generated ? { temporaryPassword: generated } : {}) }, 201);
      }
      if (request.method !== "PATCH") throw new AuthError(405, "method_not_allowed", `${request.method} is not allowed here.`, { allow: "PATCH" });
      const target = await byId(id);
      if (!target) throw new AuthError(404, "not_found", "User not found.");
      const payload = await body(request);
      const at = iso();
      const lastOwner = async () => target.role === "owner" && target.status === "active" && (await activeOwners()) <= 1;
      switch (payload.action) {
        case "disable": {
          if (target.id === user.userId) throw new AuthError(400, "cannot_disable_self", "You cannot disable your own account.");
          if (await lastOwner()) throw new AuthError(400, "last_owner", "Keep at least one active owner.");
          await db().prepare("UPDATE cms_users SET status = 'disabled', session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(at, id).run();
          await log("user_disable", id, {});
          return json({ ok: true, user: publicUser((await byId(id))!) });
        }
        case "enable": {
          await db().prepare("UPDATE cms_users SET status = 'active', updated_at = ? WHERE id = ?").bind(at, id).run();
          await log("user_enable", id, {});
          return json({ ok: true, user: publicUser((await byId(id))!) });
        }
        case "reset-password": {
          const generated = payload.password === undefined || payload.password === "" ? temporaryPassword() : undefined;
          const password = input(() => validatePassword(generated ?? payload.password));
          await db().prepare("UPDATE cms_users SET password_hash = ?, password_changed_at = ?, must_change_password = 1, session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(await hashPassword(password), at, at, id).run();
          await log("user_password_reset", id, {});
          return json({ ok: true, user: publicUser((await byId(id))!), ...(generated ? { temporaryPassword: generated } : {}) });
        }
        case "set-role": {
          if (payload.role !== "owner" && payload.role !== "editor") throw new AuthError(400, "invalid_role", "Role must be owner or editor.");
          if (payload.role === "editor" && (await lastOwner())) throw new AuthError(400, "last_owner", "Keep at least one active owner.");
          await db().prepare("UPDATE cms_users SET role = ?, updated_at = ? WHERE id = ?").bind(payload.role, at, id).run();
          await log("user_role_change", id, { from: target.role, to: payload.role });
          return json({ ok: true, user: publicUser((await byId(id))!) });
        }
        default: throw new AuthError(400, "unsupported_action", "action must be disable, enable, reset-password or set-role.");
      }
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error);
      if (/unique|constraint/i.test(error instanceof Error ? error.message : "")) return json({ error: "username_taken", message: "That username is already in use." }, 409);
      return json({ error: "internal_error", message: "Something went wrong managing people." }, 500);
    }
  };

  return { identify, handleAuth, people, session, ready };
};
