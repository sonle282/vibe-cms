/**
 * P11 `vibe-cms setup --site <site> [--account <id>] [--local]` (design §E.1 step 5, §E.1b): give the site its own
 * Cloudflare resources — D1 `<site>-cms`, KV `<site>-session`, R2 `<site>-media` — created only when missing, write the
 * CMS bindings into wrangler.jsonc and apply the package migrations. Idempotent: a second run creates nothing, leaves
 * wrangler.jsonc byte-identical and applies nothing. The site's Worker is kept as it is; nothing is ever deleted.
 * `--account` = the same on another account (hand-over): resources are found / created there and the ids follow.
 * `--local` = nothing remote: placeholder ids (kept if real ones are there) + migrations on the local D1 of wrangler dev.
 */
import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { applyMigrations, jsonOutput, must, type Wrangler } from "./wrangler.js";
import { BINDINGS, SECRETS, entryOf, findWranglerConfig, LIMITS, readWranglerConfig, upsertBindings, type Upsert, type WranglerConfig } from "./wrangler-config.js";
import { setAsideLegacyTables } from "./legacy.js";
import { CliError, migrationsDirFor, resourceNames, validateSite, type Log } from "./util.js";

export type SetupOptions = { root: string; site: string; account?: string; local?: boolean; config?: string; renameLegacy?: boolean; wrangler: Wrangler; log: Log };

/** Rate-limit namespaces are numbers unique in the account: derived from the site name (kept once written). */
export const limiterNamespaces = (site: string) => {
  let hash = 0x811c9dc5;
  for (const char of site) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  const base = 100_000 + (hash % 400_000) * 2;
  return { login: String(base), publish: String(base + 1) };
};

/** A CMS binding already pointing at another site's resource is never re-pointed silently. */
const guard = (config: WranglerConfig, names: ReturnType<typeof resourceNames>, file: string) => {
  const db = entryOf(config, "d1_databases", BINDINGS.db)?.database_name;
  if (db !== undefined && db !== names.db) throw new CliError(`${file}: ${BINDINGS.db} uses the database "${db}", not "${names.db}"`, `if this is the right site, change database_name to "${names.db}" (or fix --site); the CMS never shares a database between sites`);
  const bucket = entryOf(config, "r2_buckets", BINDINGS.media)?.bucket_name;
  if (bucket !== undefined && bucket !== names.media) throw new CliError(`${file}: ${BINDINGS.media} uses the bucket "${bucket}", not "${names.media}"`, `change bucket_name to "${names.media}" (or fix --site)`);
};

type Found = { id: string; created: boolean };

const ensureD1 = (wrangler: Wrangler, name: string, log: Log): Found => {
  const list = () => jsonOutput<Array<{ uuid: string; name: string }>>(must(wrangler, ["d1", "list", "--json"], "listing D1 databases"), "listing D1 databases").find((db) => db.name === name);
  const found = list();
  if (found) { log(`  D1 ${name}: already there (${found.uuid})`); return { id: found.uuid, created: false }; }
  must(wrangler, ["d1", "create", name], `creating D1 ${name}`);
  const made = list();
  if (!made) throw new CliError(`D1 ${name} was created but is not listed yet`, "run setup again in a minute");
  log(`  D1 ${name}: created (${made.uuid})`);
  return { id: made.uuid, created: true };
};

/** P21: the KV namespace the binding already uses, when it is in this account, is kept whatever its title (a site that had a CMS). */
const ensureKv = (wrangler: Wrangler, title: string, log: Log, current?: string): Found => {
  const all = () => jsonOutput<Array<{ id: string; title: string }>>(must(wrangler, ["kv", "namespace", "list"], "listing KV namespaces"), "listing KV namespaces");
  const list = () => all().find((ns) => ns.title === title);
  const namespaces = all();
  const kept = current ? namespaces.find((ns) => ns.id === current) : undefined;
  if (kept && kept.title !== title) { log(`  KV ${kept.title}: already used by ${BINDINGS.session}, kept (${kept.id})`); return { id: kept.id, created: false }; }
  const found = namespaces.find((ns) => ns.title === title);
  if (found) { log(`  KV ${title}: already there (${found.id})`); return { id: found.id, created: false }; }
  must(wrangler, ["kv", "namespace", "create", title], `creating KV ${title}`);
  const made = list();
  if (!made) throw new CliError(`KV ${title} was created but is not listed yet`, "run setup again in a minute");
  log(`  KV ${title}: created (${made.id})`);
  return { id: made.id, created: true };
};

/** `wrangler r2 bucket list` prints labelled blocks ("name:  my-bucket"); there is no JSON form. */
export const r2Names = (stdout: string) => [...stdout.matchAll(/^name:\s+(\S+)\s*$/gm)].map((match) => match[1]);

const ensureR2 = (wrangler: Wrangler, name: string, log: Log): { created: boolean } => {
  if (r2Names(must(wrangler, ["r2", "bucket", "list"], "listing R2 buckets")).includes(name)) { log(`  R2 ${name}: already there`); return { created: false }; }
  must(wrangler, ["r2", "bucket", "create", name], `creating R2 ${name}`);
  log(`  R2 ${name}: created`);
  return { created: true };
};

export const setup = ({ root, site: siteInput, account, local = false, config: configArg, renameLegacy = false, wrangler, log }: SetupOptions) => {
  const site = validateSite(siteInput);
  const file = findWranglerConfig(root, configArg);
  const configRel = relative(root, file).split("\\").join("/");
  const { text, data } = readWranglerConfig(file);
  const names = resourceNames(site);
  guard(data, names, configRel);
  log(`Vibe CMS setup · site "${site}" · ${local ? "local only (wrangler dev), nothing remote" : account ? `Cloudflare account ${account}` : "the Cloudflare account wrangler is signed in to"}`);

  let dbId: string, kvId: string;
  const created: string[] = [];
  if (local) {
    dbId = String(entryOf(data, "d1_databases", BINDINGS.db)?.database_id ?? `local-${names.db}`);
    kvId = String(entryOf(data, "kv_namespaces", BINDINGS.session)?.id ?? `local-${names.session}`);
  } else {
    const db = ensureD1(wrangler, names.db, log), kv = ensureKv(wrangler, names.session, log, entryOf(data, "kv_namespaces", BINDINGS.session)?.id as string | undefined), r2 = ensureR2(wrangler, names.media, log);
    if (db.created) created.push(`D1 ${names.db}`);
    if (kv.created) created.push(`KV ${names.session}`);
    if (r2.created) created.push(`R2 ${names.media}`);
    dbId = db.id; kvId = kv.id;
  }

  const limiters = limiterNamespaces(site);
  const keepNs = (name: string, fallback: string) => String(entryOf(data, "ratelimits", name)?.namespace_id ?? fallback);
  const upserts: Upsert[] = [
    { list: "d1_databases", name: BINDINGS.db, values: { database_name: names.db, database_id: dbId, migrations_dir: migrationsDirFor(file) } },
    { list: "kv_namespaces", name: BINDINGS.session, values: { id: kvId } },
    { list: "r2_buckets", name: BINDINGS.media, values: { bucket_name: names.media } },
    { list: "ratelimits", name: BINDINGS.login, values: { namespace_id: keepNs(BINDINGS.login, limiters.login), simple: LIMITS.login } },
    { list: "ratelimits", name: BINDINGS.publish, values: { namespace_id: keepNs(BINDINGS.publish, limiters.publish), simple: LIMITS.publish } },
  ];
  const { text: next, changes } = upsertBindings(text, configRel, upserts);
  if (next !== text) writeFileSync(file, next);
  log(changes.length ? `  ${configRel}: ${changes.length} change${changes.length === 1 ? "" : "s"}\n${changes.map((line) => `    ${line}`).join("\n")}` : `  ${configRel}: already up to date`);

  const renamed = setAsideLegacyTables({ wrangler, config: configRel, local, rename: renameLegacy, log });
  const applied = applyMigrations(wrangler, configRel, local);
  log(applied.length ? `  migrations applied (${local ? "local" : "remote"}): ${applied.join(", ")}` : `  migrations: up to date (${local ? "local" : "remote"})`);

  if (!local) log([
    "",
    "Next (docs: README → Install, design §E.1 steps 6–8) — run these yourself, the CLI never handles secrets:",
    `  npx wrangler secret put ${SECRETS.githubToken.padEnd(23)}# fine-grained, this one repository, Contents read/write (skip if it is set already)`,
    "  npx wrangler secret put CMS_BOOTSTRAP_USERNAME   # the first admin; delete both after the first sign-in",
    "  npx wrangler secret put CMS_BOOTSTRAP_PASSWORD",
    "  npx vibe-cms check",
  ].join("\n"));
  else log("\nLocal only: the ids are placeholders — run setup without --local before deploying.");
  return { site, file, created, changes, renamed, applied, unchanged: created.length === 0 && changes.length === 0 && renamed.length === 0 && applied.length === 0 };
};
