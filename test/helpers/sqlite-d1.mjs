// Node test helpers for P6: a D1-like database over node:sqlite with the package's real migrations applied, a KV with
// TTL, a rate limiter — all on an injectable clock — and the first site's password hashing, copied verbatim, to prove
// its existing hashes still sign in.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrations = new URL("../../migrations/", import.meta.url);

export const createSqliteD1 = () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  const norm = (value) => (value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value);
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values.map(norm)),
    first: async () => { const row = db.prepare(sql).get(...params); return row === undefined ? null : { ...row }; },
    all: async () => ({ results: db.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    run: async () => { const result = db.prepare(sql).run(...params); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => statement(sql), raw: db };
};

export const memoryKv = (now) => {
  const map = new Map();
  return {
    get: async (key) => { const entry = map.get(key); if (!entry) return null; if (entry.expires && entry.expires <= now()) { map.delete(key); return null; } return entry.value; },
    put: async (key, value, options = {}) => { map.set(key, { value, expires: options.expirationTtl ? now() + options.expirationTtl * 1000 : undefined }); },
    delete: async (key) => { map.delete(key); },
    keys: () => [...map.keys()],
  };
};

export const memoryLimiter = (limit, periodMs, now) => {
  const hits = new Map();
  return { limit: async ({ key }) => { const at = now(); const list = (hits.get(key) ?? []).filter((time) => time > at - periodMs); list.push(at); hits.set(key, list); return { success: list.length <= limit }; } };
};

// ---- the first site's hashPassword (src/lib/cloudflare/cms-auth.ts there), copied as is ----
const legacyEncodeBase64Url = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
export const legacyHashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256-v1$100000$${legacyEncodeBase64Url(salt)}$${legacyEncodeBase64Url(new Uint8Array(derived))}`;
};
