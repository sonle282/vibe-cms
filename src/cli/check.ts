/**
 * P11 `vibe-cms check [--site <site>]`: what the build checks (cms.config.ts + the content, P2) plus the site's wiring —
 * the CMS bindings exist and point only at this site's own resources (design §F: `<site>-cms`, `<site>-session`,
 * `<site>-media`; one site never reaches another's data), migrations are wired, rate limits are there (production
 * answers 503 without them), and the package is installed from a release URL (no token anywhere).
 * Errors exit 1; warnings are printed. Reads files only — nothing remote, nothing written.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BINDINGS, entryOf, findWranglerConfig, readWranglerConfig } from "./wrangler-config.js";
import { CliError, PACKAGE_NAME, resourceNames, SITE_NAME, type Log } from "./util.js";

export type CheckOptions = { root: string; site?: string; config?: string; cmsConfig?: string; log: Log };
type Problem = { where: string; message: string; hint?: string };

export const RELEASE_URL = /^https:\/\/github\.com\/sonle282\/vibe-cms\/releases\/download\/v(\d+\.\d+\.\d+)\/vibe-cms-\1\.tgz$/;

/** The wiring part, on its own (unit-tested without a build). */
export const checkWiring = (root: string, configFile: string, siteArg?: string) => {
  const errors: Problem[] = [], warnings: Problem[] = [];
  const where = configFile.slice(root.length + 1).split("\\").join("/") || configFile;
  const { data } = readWranglerConfig(configFile);
  const db = entryOf(data, "d1_databases", BINDINGS.db);
  const dbName = typeof db?.database_name === "string" ? db.database_name : undefined;
  const site = siteArg ?? (dbName?.endsWith("-cms") ? dbName.slice(0, -4) : undefined);
  if (!site || !SITE_NAME.test(site)) {
    errors.push({ where, message: `${BINDINGS.db} (D1) is missing${dbName ? ` or not named <site>-cms (it is "${dbName}")` : ""}`, hint: "npx vibe-cms setup --site <site>" });
    return { site, errors, warnings };
  }
  const names = resourceNames(site);
  const placeholder = (value: unknown) => typeof value === "string" && value.startsWith("local-");

  if (!db) errors.push({ where, message: `${BINDINGS.db} (D1 ${names.db}) is missing`, hint: `npx vibe-cms setup --site ${site}` });
  else {
    if (dbName !== names.db) errors.push({ where, message: `${BINDINGS.db} uses the database "${dbName}", not "${names.db}" — another site's data`, hint: `fix database_name, or pass the right --site` });
    if (!db.database_id) errors.push({ where, message: `${BINDINGS.db} has no database_id`, hint: `npx vibe-cms setup --site ${site}` });
    else if (placeholder(db.database_id)) warnings.push({ where, message: `${BINDINGS.db} has a local placeholder id (${db.database_id}): fine for wrangler dev, a deploy fails`, hint: `npx vibe-cms setup --site ${site} (without --local)` });
    const dir = typeof db.migrations_dir === "string" ? db.migrations_dir : undefined;
    if (!dir) errors.push({ where, message: `${BINDINGS.db} has no migrations_dir, so \`vibe-cms migrate\` cannot find the package migrations`, hint: `npx vibe-cms setup --site ${site}` });
    else if (!existsSync(join(resolve(dirname(configFile), dir), "0001_draft_index.sql"))) errors.push({ where, message: `${BINDINGS.db}.migrations_dir "${dir}" holds no CMS migrations`, hint: "npm install, then npx vibe-cms setup again" });
  }

  const kv = entryOf(data, "kv_namespaces", BINDINGS.session);
  if (!kv?.id) errors.push({ where, message: `${BINDINGS.session} (KV ${names.session}) is missing — nobody can sign in`, hint: `npx vibe-cms setup --site ${site}` });
  else if (placeholder(kv.id)) warnings.push({ where, message: `${BINDINGS.session} has a local placeholder id: fine for wrangler dev, a deploy fails`, hint: `npx vibe-cms setup --site ${site}` });

  const media = entryOf(data, "r2_buckets", BINDINGS.media);
  if (!media) warnings.push({ where, message: `${BINDINGS.media} (R2 ${names.media}) is missing: uploading images is off (everything else works)`, hint: `npx vibe-cms setup --site ${site}` });
  else if (media.bucket_name !== names.media) errors.push({ where, message: `${BINDINGS.media} uses the bucket "${String(media.bucket_name)}", not "${names.media}" — another site's images`, hint: "fix bucket_name, or pass the right --site" });

  for (const name of [BINDINGS.login, BINDINGS.publish]) if (!entryOf(data, "ratelimits", name)) errors.push({ where, message: `rate limit ${name} is missing: production answers 503 to ${name === BINDINGS.login ? "sign-in" : "publish"}`, hint: `npx vibe-cms setup --site ${site}` });

  const pkgFile = join(root, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8").replace(/^\uFEFF/, "")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const spec = pkg.dependencies?.[PACKAGE_NAME] ?? pkg.devDependencies?.[PACKAGE_NAME];
    if (!spec) errors.push({ where: "package.json", message: `${PACKAGE_NAME} is not a dependency`, hint: "install it from its release URL (README → Install)" });
    else if (!RELEASE_URL.test(spec)) warnings.push({ where: "package.json", message: `${PACKAGE_NAME} is "${spec}", not a release URL — fine while developing, a site installs a release`, hint: "npx vibe-cms update <version>" });
  }
  if (existsSync(join(root, ".npmrc")) && /_authToken|NODE_AUTH_TOKEN/.test(readFileSync(join(root, ".npmrc"), "utf8"))) warnings.push({ where: ".npmrc", message: "holds a registry token; the CMS needs none (release URLs are public)", hint: "remove it unless the site needs it for something else" });
  return { site, errors, warnings };
};

const print = (log: Log, title: string, problems: Problem[]) => {
  if (!problems.length) return;
  log(`${title} (${problems.length}):`);
  for (const problem of problems) log(`  - ${problem.where}: ${problem.message}${problem.hint ? ` → ${problem.hint}` : ""}`);
};

export const check = async ({ root, site, config, cmsConfig = "cms.config.ts", log }: CheckOptions) => {
  if (site !== undefined && !SITE_NAME.test(site)) throw new CliError(`--site must be a short name (got ${JSON.stringify(site)})`);
  const { checkSite } = await import("../load-config.js");
  const errors: Problem[] = [], warnings: Problem[] = [];
  let summary = "";
  try {
    const loaded = await checkSite(join(root, cmsConfig), { onWarnings: (found, file) => warnings.push(...found.map((item) => ({ where: item.path || file, message: item.message, hint: item.hint }))) });
    summary = `${loaded.files.length} files, ${loaded.collections.length} collections, content checked`;
    // P20: every record written back unchanged gives its file byte for byte (what a publish would do to the rest).
    const { checkRoundTrip } = await import("../check/roundtrip.js");
    const trip = checkRoundTrip(loaded, root);
    errors.push(...trip.problems.map((item) => ({ where: item.path, message: item.message, hint: "keep the file as the writer writes it (e.g. JSON.stringify(…, null, 2)), or tell us" })));
    if (!trip.problems.length) summary += `, ${trip.records} records round-trip byte for byte (${trip.files} files)`;
  } catch (error) {
    const problems = (error as { problems?: Array<{ path: string; message: string; hint?: string }> }).problems;
    if (problems) errors.push(...problems.map((item) => ({ where: item.path || cmsConfig, message: item.message, hint: item.hint })));
    else errors.push({ where: cmsConfig, message: (error as Error).message });
  }
  const wiring = checkWiring(root, findWranglerConfig(root, config), site);
  errors.push(...wiring.errors); warnings.push(...wiring.warnings);
  print(log, "Warnings", warnings);
  print(log, "Errors", errors);
  if (!errors.length) log(`check OK: ${summary}; wiring for site "${wiring.site}" (D1, KV, R2, rate limits)${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}`);
  return { ok: errors.length === 0, errors, warnings, site: wiring.site };
};
