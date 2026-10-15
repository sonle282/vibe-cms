/**
 * P11: the `vibe-cms` command (bin/vibe-cms.mjs → run()). Runs in the site's folder; prints what it did and what to do
 * next. It never asks for, prints or stores a token or a secret: Cloudflare goes through the site's wrangler and the
 * login of whoever runs it; GitHub releases are public.
 */
import { parseArgs } from "node:util";
import { check } from "./check.js";
import { exportData, importData } from "./data.js";
import { importLegacyUsers, setAsideLegacyTables } from "./legacy.js";
import { resetOwnerPassword } from "./owner.js";
import { init } from "./init.js";
import { setup } from "./setup.js";
import { update } from "./update.js";
import { CliError, packageVersion, type Log } from "./util.js";
import { applyMigrations, createWrangler } from "./wrangler.js";
import { findWranglerConfig, useSiteNames } from "./wrangler-config.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export { checkWiring, RELEASE_URL } from "./check.js";
export { BINDINGS, SECRETS, useSiteNames } from "./wrangler-config.js";
export { limiterNamespaces, r2Names } from "./setup.js";
export { releaseUrl, siteActions } from "./update.js";
export { upsertBindings, parseWranglerConfig } from "./wrangler-config.js";
export { CliError } from "./util.js";

export const HELP = `vibe-cms ${"<version>"} — run in the site's folder

  init [--data <folders>] [--out <file>] [--dry-run] [--force] [--name <site name>] [--url <address>] [--repo <owner/name>] [--branch <branch>]
      A first draft of cms.config.ts from the site's JSON content (src/data, src/content): pages, collections, sections
      and every field, guessed and checked against the content; lists where the templates print a value
      (data-cms-field for the preview). Never replaces cms.config.ts without --force.
  setup --site <site> [--account <id>] [--local] [--rename-legacy]
      Create (only if missing) D1 <site>-cms, KV <site>-session, R2 <site>-media; write the CMS bindings into
      wrangler.jsonc; apply the migrations. Safe to run again. --account: another Cloudflare account (hand-over).
      --local: nothing remote (placeholder ids + the local D1 of wrangler dev). A site that had a CMS keeps the
      KV its binding uses; --rename-legacy: its old CMS's tables in CMS_DB become legacy_cms_* (rows kept).
  migrate [--local] [--rename-legacy]  Apply the package migrations to CMS_DB (adds tables / columns, never deletes).
  check [--site <site>]             cms.config.ts + content (as the build) + bindings point only at this site.
  export --out <dir> [--local]      D1 rows → <dir>/<site>-cms.sql + .counts.json (R2 is counted, not copied).
  import --file <sql> [--local]     Into an empty, set-up CMS database; compares the rows with the counts file.
  update [version]                  Point package.json at that release (default: the latest), npm install.
  reset-admin-password [--username <name>] [--local]
      A temporary password for an admin, shown once; they change it at the next sign-in. (Old name:
      reset-owner-password.)
  import-legacy-users --from <old D1> [--from-config <file>] [--local] [--dry-run]
      The people of the CMS the site ran before → this empty CMS database: same passwords, admins stay admins.

Common: --config <wrangler.jsonc> · --account <id> (default: the account wrangler is signed in to — npx wrangler login).`;

const COMMANDS = ["init", "setup", "migrate", "check", "export", "import", "update", "reset-admin-password", "reset-owner-password", "import-legacy-users"] as const;

/** P21: the site's own binding / secret names from its cms.config.ts (defaults when it has none or cannot load). */
const readSiteNames = async (root: string) => {
  const file = join(root, "cms.config.ts");
  if (!existsSync(file)) return;
  try {
    const { loadCmsConfig } = await import("../load-config.js");
    const { siteNames } = await import("../config/index.js");
    useSiteNames(siteNames(await loadCmsConfig(file)));
  } catch { /* the command says what is wrong with the config where it matters (check) */ }
};

export const run = async (argv: string[], { root = process.cwd(), log = console.log as Log, error = console.error as Log } = {}) => {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") { log(HELP.replace("<version>", packageVersion())); return 0; }
  if (command === "--version" || command === "-v") { log(packageVersion()); return 0; }
  try {
    if (!(COMMANDS as readonly string[]).includes(command)) throw new CliError(`unknown command "${command}"`, "npx vibe-cms help");
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: command === "update", strict: true,
      options: { site: { type: "string" }, account: { type: "string" }, local: { type: "boolean" }, config: { type: "string" }, out: { type: "string" }, file: { type: "string" }, username: { type: "string" }, from: { type: "string" }, "from-config": { type: "string" }, "dry-run": { type: "boolean" }, "rename-legacy": { type: "boolean" }, data: { type: "string" }, force: { type: "boolean" }, name: { type: "string" }, url: { type: "string" }, repo: { type: "string" }, branch: { type: "string" } },
    });
    if (values.account !== undefined && !/^[0-9a-f]{32}$/.test(values.account)) throw new CliError("--account must be a Cloudflare account id (32 hex characters)");
    const local = values.local ?? false;
    const wrangler = () => createWrangler(root, values.account);
    // P21: a site that had a CMS keeps its binding / secret names (cms.config.ts `bindings`, `secrets`).
    if (command !== "init" && command !== "update") await readSiteNames(root);
    switch (command) {
      case "init":
        init({ root, log, data: values.data, out: values.out, force: values.force, dryRun: values["dry-run"], name: values.name, url: values.url, repo: values.repo, branch: values.branch });
        return 0;
      case "setup":
        setup({ root, site: values.site ?? "", account: values.account, local, config: values.config, renameLegacy: values["rename-legacy"] ?? false, wrangler: wrangler(), log });
        return 0;
      case "migrate": {
        const configRel = findWranglerConfig(root, values.config).slice(root.length + 1).split("\\").join("/");
        setAsideLegacyTables({ wrangler: wrangler(), config: configRel, local, rename: values["rename-legacy"] ?? false, log });
        const applied = applyMigrations(wrangler(), configRel, local);
        log(applied.length ? `Migrations applied (${local ? "local" : "remote"}): ${applied.join(", ")}` : `Migrations: up to date (${local ? "local" : "remote"}).`);
        return 0;
      }
      case "check":
        return (await check({ root, site: values.site, config: values.config, log })).ok ? 0 : 1;
      case "export":
        if (!values.out) throw new CliError("export needs --out <folder>", "npx vibe-cms export --out ../backup");
        exportData({ root, out: values.out, local, config: values.config, wrangler: wrangler(), log });
        return 0;
      case "import":
        if (!values.file) throw new CliError("import needs --file <export.sql>");
        importData({ root, file: values.file, local, config: values.config, wrangler: wrangler(), log });
        return 0;
      case "update":
        if (positionals.length > 1) throw new CliError("update takes one version", "npx vibe-cms update 0.14.0");
        await update({ root, version: positionals[0], log });
        return 0;
      case "import-legacy-users":
        if (!values.from) throw new CliError("import-legacy-users needs --from <the old CMS's D1 name or binding>");
        importLegacyUsers({ root, from: values.from, fromConfig: values["from-config"], local, config: values.config, dryRun: values["dry-run"] ?? false, wrangler: wrangler(), log });
        return 0;
      // M2: Admin is the role's name; reset-owner-password is its old name.
      case "reset-admin-password":
      case "reset-owner-password":
        await resetOwnerPassword({ root, username: values.username, local, config: values.config, wrangler: wrangler(), log });
        return 0;
    }
    return 1;
  } catch (caught) {
    if (caught instanceof CliError) { error(`✘ ${caught.message}${caught.hint ? `\n→ ${caught.hint}` : ""}`); return 1; }
    if ((caught as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) { error(`✘ ${(caught as Error).message}\n→ npx vibe-cms help`); return 1; }
    throw caught;
  }
};
