/**
 * P12e `vibe-cms import-legacy-users --from <database> [--from-config <file>] [--local] [--dry-run]`: bring the people
 * of the CMS a site ran before (the hand-copied CMS of the first site: cms_users with numeric ids, roles admin / editor)
 * into this site's set-up, still empty Vibe CMS database. Same password hashes (same format, same check) → nobody resets
 * a password; admin → owner; disabled stays disabled; "must change the temporary password" carries over; the old id is
 * kept as legacy_id. When an owner comes over, the bootstrap is marked used (the bootstrap secrets can no longer create
 * a second owner). One audit row per person (people · user_create, by "cli"). Sign-in sessions do not move: everyone
 * signs in again once. Nothing is written with --dry-run, nor when anything looks wrong.
 *
 * P21: the old CMS's D1 can be the site's CMS_DB itself (Mr Spa's mrspainc-cms). Its tables have the package's names
 * (cms_users, cms_auth_state, cms_draft_index, cms_audit_log) with other columns, so `setup` / `migrate
 * --rename-legacy` renames them legacy_cms_* in place — every row kept, nothing deleted, no new database — and the
 * import reads legacy_cms_users there.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userFromLegacyRow, type LegacyUserRow, type UserRow } from "../auth/index.js";
import { HASH_VERSION, normalizeUsername, PBKDF2_ITERATIONS } from "../auth/password.js";
import { must, query, type Wrangler } from "./wrangler.js";
import { BINDINGS, findWranglerConfig } from "./wrangler-config.js";
import { CliError, packageRoot, type Log } from "./util.js";

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const COLUMNS = ["id", "username", "display_name", "password_hash", "role", "status", "must_change_password", "session_version", "created_at", "updated_at", "last_login_at", "password_changed_at", "legacy_id"] as const;

/** The package's tables an older CMS may also have (same names, other columns), and a column only the package's has. */
const SHARED_TABLES = { cms_users: "display_name", cms_auth_state: undefined, cms_draft_index: "user_id", cms_audit_log: "stage" } as const;
export const LEGACY_PREFIX = "legacy_";

/** Run SQL statements on CMS_DB from one file (no shell quoting). */
const executeFile = (wrangler: Wrangler, config: string, local: boolean, sql: string, what: string) => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-cms-sql-"));
  try {
    const file = join(dir, "statements.sql");
    writeFileSync(file, sql);
    must(wrangler, ["d1", "execute", BINDINGS.db, local ? "--local" : "--remote", "--config", config, "--file", file, "-y"], what);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

/**
 * P21, before the package's migrations: CMS_DB holds the tables of the CMS the site ran before (cms_users without
 * display_name)? Without `rename` nothing changes and the command stops, saying what to do; with it they become
 * legacy_cms_* (ALTER TABLE … RENAME: rows and indexes kept). Returns the tables renamed now (empty = nothing to do).
 */
export const setAsideLegacyTables = ({ wrangler, config, local, rename, log }: { wrangler: Wrangler; config: string; local: boolean; rename: boolean; log: Log }) => {
  const tables = query<{ name: string }>(wrangler, config, local, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name));
  if (!tables.includes("cms_users")) return [];
  const columns = (table: string) => query<{ name: string }>(wrangler, config, local, `PRAGMA table_info(${table})`).map((row) => String(row.name));
  if (columns("cms_users").includes(SHARED_TABLES.cms_users)) return [];
  const old = Object.keys(SHARED_TABLES).filter((table) => tables.includes(table));
  const renamed = old.map((table) => `${table} → ${LEGACY_PREFIX}${table}`).join(", ");
  const taken = old.filter((table) => tables.includes(LEGACY_PREFIX + table));
  if (taken.length) throw new CliError(`${BINDINGS.db} has both ${taken.join(", ")} of an older CMS and ${taken.map((table) => LEGACY_PREFIX + table).join(", ")} — nothing was changed`, "look at the database: the old tables were set aside once already");
  const ours = readdirSync(join(packageRoot, "migrations")).filter((name) => name.endsWith(".sql"));
  const done = tables.includes("d1_migrations") ? query<{ name: string }>(wrangler, config, local, "SELECT name FROM d1_migrations").map((row) => String(row.name)) : [];
  const clash = ours.filter((name) => done.includes(name));
  if (clash.length) throw new CliError(`${BINDINGS.db} lists ${clash.join(", ")} as applied, but its tables are an older CMS's — nothing was changed`, "the package's migrations would be skipped: look at d1_migrations first");
  if (!rename) throw new CliError(
    `${BINDINGS.db} has the tables of the CMS this site ran before (${old.join(", ")}): the package's have the same names — nothing was changed`,
    `when switching to the package, run this again with --rename-legacy: ${renamed} in the same database (every row kept, nothing deleted), then npx vibe-cms import-legacy-users --from ${BINDINGS.db} --from-config <wrangler file>. The old CMS stops working from then on.`,
  );
  executeFile(wrangler, config, local, `${old.map((table) => `ALTER TABLE ${table} RENAME TO ${LEGACY_PREFIX}${table};`).join("\n")}\n`, "renaming the old CMS's tables");
  log(`  ${BINDINGS.db}: the old CMS's tables renamed, every row kept (${local ? "local" : "remote"}): ${renamed}`);
  return old;
};

/** A SQL literal: text in single quotes (quotes doubled), numbers as they are, null as NULL. */
export const sqlValue = (value: unknown) => (value === null || value === undefined ? "NULL" : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : `'${String(value).replace(/'/g, "''")}'`);

/** Why an old row cannot come over as it is (undefined = it can). */
export const legacyProblem = (row: LegacyUserRow) => {
  if (!Number.isSafeInteger(row.id)) return "its id is not a number (is this an older CMS's database?)";
  if (!USERNAME.test(normalizeUsername(row.username))) return `the username ${JSON.stringify(row.username)} is not 3–32 letters, digits, . _ -`;
  const [version, iterations] = String(row.password_hash ?? "").split("$");
  if (version !== HASH_VERSION || !(Number(iterations) >= PBKDF2_ITERATIONS)) return "its password is not stored in the format this CMS checks (pbkdf2-sha256-v1, ≥ 100,000 rounds)";
  if (row.role !== "admin" && row.role !== "editor") return `its role is ${JSON.stringify(row.role)}, not admin / editor`;
  if (row.status !== "active" && row.status !== "disabled") return `its status is ${JSON.stringify(row.status)}`;
  if (!row.created_at || !row.updated_at || !row.password_changed_at) return "it has no created / updated / password-changed dates";
  return undefined;
};

/** The SQL that writes the people (+ the bootstrap mark + one audit row each). */
export const legacyImportSql = (rows: UserRow[], at: string) => {
  const lines = rows.map((row) => `INSERT INTO cms_users (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map((column) => sqlValue(row[column])).join(", ")});`);
  if (rows.some((row) => row.role === "owner")) lines.push(`INSERT INTO cms_auth_state (key, value, updated_at) VALUES ('bootstrap_completed', 'true', ${sqlValue(at)}) ON CONFLICT (key) DO NOTHING;`);
  for (const row of rows) lines.push(`INSERT INTO cms_audit_log (at, user_id, role, action, stage, resource, detail) VALUES (${sqlValue(at)}, ${sqlValue(row.id)}, 'owner', 'user_create', 'people', ${sqlValue(`user:${row.id}`)}, ${sqlValue(JSON.stringify({ by: "cli", imported: true, legacyId: row.legacy_id, role: row.role }))});`);
  return `${lines.join("\n")}\n`;
};

export const importLegacyUsers = ({ root, from, fromConfig, local = false, config, dryRun = false, wrangler, log }: {
  root: string; from: string; fromConfig?: string; local?: boolean; config?: string; dryRun?: boolean; wrangler: Wrangler; log: Log;
}) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(from)) throw new CliError("--from must be the old D1 database's name or binding", "e.g. --from innovatesalon-cms");
  if (local && !fromConfig) throw new CliError("--local needs --from-config: the wrangler file that knows the old database", "e.g. --from CMS_DB --from-config wrangler.toml");
  const targetConfig = findWranglerConfig(root, config).slice(root.length + 1).split("\\").join("/");
  const source = (sql: string) => query<Record<string, unknown>>(wrangler, fromConfig, local, sql, from);

  // 1. The source must be an older CMS's people table (numeric ids, admin / editor), not a Vibe CMS one — set aside as
  //    legacy_cms_users when it is the site's own CMS_DB (P21).
  const aside = source(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${LEGACY_PREFIX}cms_users'`).length > 0;
  const users = aside ? `${LEGACY_PREFIX}cms_users` : "cms_users", authState = aside ? `${LEGACY_PREFIX}cms_auth_state` : "cms_auth_state";
  const columns = source(`PRAGMA table_info(${users})`).map((column) => String(column.name));
  if (!columns.length) throw new CliError(`${from} has no cms_users table`, "check --from (the old CMS's D1) and --from-config");
  if (columns.includes("display_name")) throw new CliError(`${from} is already a Vibe CMS database`, "move it with npx vibe-cms export / import instead");
  for (const needed of ["id", "username", "password_hash", "role", "status", "created_at", "updated_at", "password_changed_at"]) if (!columns.includes(needed)) throw new CliError(`${from}.${users} has no ${needed} column — not the CMS this command knows`);
  const wanted = ["id", "username", "password_hash", "role", "status", "created_at", "updated_at", "last_login_at", "password_changed_at", "session_version"].filter((column) => columns.includes(column));
  const legacy = source(`SELECT ${wanted.join(", ")} FROM ${users} ORDER BY id`) as unknown as LegacyUserRow[];
  if (!legacy.length) throw new CliError(`${from} has no people to import`);
  const state = source(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${authState}'`).length
    ? source(`SELECT key FROM ${authState}`).map((row) => String(row.key)) : [];
  const problems = legacy.map((row) => [row, legacyProblem(row)] as const).filter((entry): entry is readonly [LegacyUserRow, string] => entry[1] !== undefined);
  if (problems.length) throw new CliError(`some people cannot come over as they are — nothing was imported:\n${problems.map(([row, problem]) => `  ${row.username ?? row.id}: ${problem}`).join("\n")}`, "fix them in the old CMS (or remove them), then run this again");
  const seen = new Set<string>();
  for (const row of legacy) { const name = normalizeUsername(row.username); if (seen.has(name)) throw new CliError(`two people are called "${name}" (usernames ignore case here)`, "rename one in the old CMS first"); seen.add(name); }

  // 2. The target: this site's Vibe CMS database, migrated and with nobody in it yet.
  const targetColumns = query<{ name: string }>(wrangler, targetConfig, local, "PRAGMA table_info(cms_users)").map((column) => column.name);
  if (!targetColumns.includes("display_name")) throw new CliError(`${BINDINGS.db} is not set up for Vibe CMS yet`, "npx vibe-cms setup --site <site> (or migrate)");
  const already = Number(query<{ n: number }>(wrangler, targetConfig, local, "SELECT COUNT(*) AS n FROM cms_users")[0]?.n ?? 0);
  if (already > 0) throw new CliError(`${BINDINGS.db} already has ${already} ${already === 1 ? "person" : "people"} — the import only goes into a database nobody uses yet`, "import before anyone signs in to the new CMS");

  // 3. Map (same hash, admin → owner, legacy_id) and write in one file.
  const rows = legacy.map((row) => ({ ...userFromLegacyRow(row), must_change_password: state.includes(`password_reset_required:${row.id}`) ? 1 : 0 }) as UserRow);
  const table = rows.map((row) => `  ${row.username.padEnd(24)} ${row.role.padEnd(6)} ${row.status.padEnd(9)}${row.must_change_password ? " must change the temporary password" : ""}`).join("\n");
  log(`${dryRun ? "Would import" : "Importing"} ${rows.length} ${rows.length === 1 ? "person" : "people"} from ${from} (${local ? "local" : "remote"}) into ${BINDINGS.db}:\n${table}`);
  if (!rows.some((row) => row.role === "owner")) log("Note: nobody is an admin in the old CMS, so there is no admin yet — sign in with the bootstrap secrets once to create one.");
  if (dryRun) { log("Dry run: nothing was written."); return { rows, written: false }; }
  executeFile(wrangler, targetConfig, local, legacyImportSql(rows, new Date().toISOString()), "writing the people");
  const now = Number(query<{ n: number }>(wrangler, targetConfig, local, "SELECT COUNT(*) AS n FROM cms_users")[0]?.n ?? 0);
  if (now !== rows.length) throw new CliError(`${BINDINGS.db} has ${now} people after the import, expected ${rows.length}`, "check the database before anyone signs in");
  log(`Imported ${rows.length}. Passwords are unchanged; everyone signs in again once (sessions do not move).${rows.some((row) => row.role === "owner") ? " The bootstrap is marked as used." : ""}`);
  return { rows, written: true };
};
