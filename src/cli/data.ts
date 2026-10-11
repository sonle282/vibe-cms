/**
 * P11 `vibe-cms export --out <dir>` / `vibe-cms import --file <sql>` (design §E.1b, hand-over to another account):
 * the CMS data of D1 (drafts, audit, people) as SQL, plus a counts file — rows per table and the migrations the data
 * belongs to. Only rows are exported (`--no-schema`): the target is made by `vibe-cms setup` (same migrations), and the
 * import refuses a target with other migrations or with data already in it, then compares the rows table by table.
 * R2 (images) is counted, not copied — copying needs the bucket's own S3 keys (§E.1b step 3). KV holds only sign-in
 * sessions and is not moved: people sign in again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { jsonOutput, must, query, type Wrangler } from "./wrangler.js";
import { BINDINGS, entryOf, findWranglerConfig, readWranglerConfig } from "./wrangler-config.js";
import { CliError, readJsonFile, type Log } from "./util.js";

export type Counts = { site: string; exportedAt: string; source: "local" | "remote"; migrations: string[]; tables: Record<string, number>; r2?: { bucket: string; objects: number; bytes: number } };
type DataOptions = { root: string; local?: boolean; config?: string; wrangler: Wrangler; log: Log };

const TABLE = /^cms_[a-z0-9_]+$/;

const target = (root: string, config?: string) => {
  const file = findWranglerConfig(root, config);
  const db = entryOf(readWranglerConfig(file).data, "d1_databases", BINDINGS.db);
  const name = typeof db?.database_name === "string" ? db.database_name : "";
  if (!name.endsWith("-cms")) throw new CliError(`${BINDINGS.db} is not set up in ${relative(root, file)}`, "npx vibe-cms setup --site <site>");
  return { configRel: relative(root, file).split("\\").join("/"), site: name.slice(0, -4), db: name };
};

/** The CMS tables (cms_*), the migrations applied, rows per table. */
export const snapshot = (wrangler: Wrangler, configRel: string, local: boolean) => {
  const tables = query<{ name: string }>(wrangler, configRel, local, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name).filter((name) => TABLE.test(name));
  if (!tables.length) throw new CliError("the CMS database has no CMS tables", "npx vibe-cms migrate");
  const migrations = query<{ name: string }>(wrangler, configRel, local, "SELECT name FROM d1_migrations ORDER BY id").map((row) => row.name);
  const rows = query<{ t: string; n: number }>(wrangler, configRel, local, tables.map((name) => `SELECT '${name}' AS t, COUNT(*) AS n FROM ${name}`).join(" UNION ALL "));
  return { tables, migrations, counts: Object.fromEntries(tables.map((name) => [name, Number(rows.find((row) => row.t === name)?.n ?? 0)])) as Record<string, number> };
};

const table = (counts: Record<string, number>, other?: Record<string, number>) =>
  Object.entries(counts).map(([name, count]) => `  ${name.padEnd(22)} ${String(count).padStart(7)}${other ? `  ${String(other[name] ?? "—").padStart(7)}${other[name] === count ? "  ✓" : "  ✘"}` : ""}`).join("\n");

export const exportData = ({ root, out, local = false, config, wrangler, log }: DataOptions & { out: string }) => {
  const { configRel, site, db } = target(root, config);
  const dir = resolve(root, out);
  mkdirSync(dir, { recursive: true });
  const sqlFile = join(dir, `${db}.sql`), countsFile = join(dir, `${db}.counts.json`);
  if (!local) log("Exporting the remote D1: it does not answer queries while the export runs (seconds for a small site).");
  const { tables, migrations, counts } = snapshot(wrangler, configRel, local);
  must(wrangler, ["d1", "export", BINDINGS.db, local ? "--local" : "--remote", "--config", configRel, "--output", sqlFile, "--no-schema", "-y", ...tables.flatMap((name) => ["--table", name])], "exporting D1");
  if (!existsSync(sqlFile)) throw new CliError(`wrangler reported success but wrote no ${sqlFile}`);
  const result: Counts = { site, exportedAt: new Date().toISOString(), source: local ? "local" : "remote", migrations, tables: counts };
  if (!local) {
    const media = entryOf(readWranglerConfig(findWranglerConfig(root, config)).data, "r2_buckets", BINDINGS.media)?.bucket_name;
    if (typeof media === "string") {
      const info = jsonOutput<{ object_count?: string | number; bucket_size?: string | number }>(must(wrangler, ["r2", "bucket", "info", media, "--json"], `reading R2 ${media}`), `reading R2 ${media}`);
      result.r2 = { bucket: media, objects: Number(String(info.object_count ?? 0).replace(/[^\d]/g, "")), bytes: Number(String(info.bucket_size ?? 0).replace(/[^\d.]/g, "")) || 0 };
    }
  }
  writeFileSync(countsFile, `${JSON.stringify(result, null, 2)}\n`);
  log(`Exported ${db} (${result.source}) → ${relative(root, sqlFile)}\n${table(counts)}\n  migrations: ${migrations.join(", ")}\nCounts → ${relative(root, countsFile)} (import compares against it).`);
  if (result.r2) log(`R2 ${result.r2.bucket}: ${result.r2.objects} objects, ${result.r2.bytes} bytes — not copied by this command; copy with the bucket's S3 keys (read-only on the source, write-only on the target) and compare these numbers (design §E.1b step 3).`);
  log("The file holds people's password hashes and drafts: keep it private, delete it after the import.");
  return { sqlFile, countsFile, counts: result };
};

export const importData = ({ root, file, local = false, config, wrangler, log }: DataOptions & { file: string }) => {
  const { configRel, db } = target(root, config);
  const sqlFile = resolve(root, file);
  if (!existsSync(sqlFile)) throw new CliError(`${file} not found`);
  const expected = readJsonFile<Counts>(sqlFile.replace(/\.sql$/i, ".counts.json"), "the counts file next to the export");
  const before = snapshot(wrangler, configRel, local);
  if (before.migrations.join() !== expected.migrations.join()) throw new CliError(`the target database has migrations [${before.migrations.join(", ")}], the export [${expected.migrations.join(", ")}]`, "use the same package version on both sides, then npx vibe-cms migrate");
  const filled = Object.entries(before.counts).filter(([, count]) => count > 0);
  if (filled.length) throw new CliError(`the target ${db} already has data (${filled.map(([name, count]) => `${name}: ${count}`).join(", ")}) — the import only goes into an empty CMS database`, "import into a freshly set-up database; never merge two sites");
  const missing = Object.keys(expected.tables).filter((name) => !before.tables.includes(name));
  if (missing.length) throw new CliError(`the target has no table ${missing.join(", ")}`, "npx vibe-cms migrate");
  if (/^(CREATE|DROP)\s+TABLE\b/im.test(readFileSync(sqlFile, "utf8"))) throw new CliError(`${file} holds table definitions — not a \`vibe-cms export\` (rows only)`, "export again with npx vibe-cms export");
  must(wrangler, ["d1", "execute", BINDINGS.db, local ? "--local" : "--remote", "--config", configRel, "--file", sqlFile, "-y"], "importing into D1");
  const after = snapshot(wrangler, configRel, local);
  const ok = Object.entries(expected.tables).every(([name, count]) => after.counts[name] === count);
  log(`Imported into ${db} (${local ? "local" : "remote"}) — rows: export vs now\n${table(expected.tables, after.counts)}`);
  if (!ok) throw new CliError("the row counts differ from the export", "do not use this database; set up a fresh one and import again");
  log("Row counts match. Sign-in sessions are not moved: people sign in again.");
  return { counts: after.counts };
};
