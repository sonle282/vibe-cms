/**
 * P11: the `vibe-cms` command (bin/vibe-cms.mjs → run()). Runs in the site's folder; prints what it did and what to do
 * next. It never asks for, prints or stores a token or a secret: Cloudflare goes through the site's wrangler and the
 * login of whoever runs it; GitHub releases are public.
 */
import { parseArgs } from "node:util";
import { check } from "./check.js";
import { exportData, importData } from "./data.js";
import { importLegacyUsers } from "./legacy.js";
import { resetOwnerPassword } from "./owner.js";
import { setup } from "./setup.js";
import { update } from "./update.js";
import { CliError, packageVersion, type Log } from "./util.js";
import { applyMigrations, createWrangler } from "./wrangler.js";
import { findWranglerConfig } from "./wrangler-config.js";

export { checkWiring, RELEASE_URL } from "./check.js";
export { limiterNamespaces, r2Names } from "./setup.js";
export { releaseUrl, siteActions } from "./update.js";
export { upsertBindings, parseWranglerConfig } from "./wrangler-config.js";
export { CliError } from "./util.js";

export const HELP = `vibe-cms ${"<version>"} — run in the site's folder

  setup --site <site> [--account <id>] [--local]
      Create (only if missing) D1 <site>-cms, KV <site>-session, R2 <site>-media; write the CMS bindings into
      wrangler.jsonc; apply the migrations. Safe to run again. --account: another Cloudflare account (hand-over).
      --local: nothing remote (placeholder ids + the local D1 of wrangler dev).
  migrate [--local]                 Apply the package migrations to CMS_DB (adds tables / columns, never deletes).
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

const COMMANDS = ["setup", "migrate", "check", "export", "import", "update", "reset-admin-password", "reset-owner-password", "import-legacy-users"] as const;

export const run = async (argv: string[], { root = process.cwd(), log = console.log as Log, error = console.error as Log } = {}) => {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") { log(HELP.replace("<version>", packageVersion())); return 0; }
  if (command === "--version" || command === "-v") { log(packageVersion()); return 0; }
  try {
    if (!(COMMANDS as readonly string[]).includes(command)) throw new CliError(`unknown command "${command}"`, "npx vibe-cms help");
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: command === "update", strict: true,
      options: { site: { type: "string" }, account: { type: "string" }, local: { type: "boolean" }, config: { type: "string" }, out: { type: "string" }, file: { type: "string" }, username: { type: "string" }, from: { type: "string" }, "from-config": { type: "string" }, "dry-run": { type: "boolean" } },
    });
    if (values.account !== undefined && !/^[0-9a-f]{32}$/.test(values.account)) throw new CliError("--account must be a Cloudflare account id (32 hex characters)");
    const local = values.local ?? false;
    const wrangler = () => createWrangler(root, values.account);
    switch (command) {
      case "setup":
        setup({ root, site: values.site ?? "", account: values.account, local, config: values.config, wrangler: wrangler(), log });
        return 0;
      case "migrate": {
        const configRel = findWranglerConfig(root, values.config).slice(root.length + 1).split("\\").join("/");
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
