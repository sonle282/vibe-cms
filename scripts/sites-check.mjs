// Before a release: the package as it is now, installed into a copy of each real site that runs it — run on the
// maintainer's machine, never in CI (the package's checks do not read a client site's data). Per site, in a temporary
// copy of its last commit (the site's folder is not touched):
//   1. npm ci, then build: the site as it is (its own release of the package);
//   2. npm i <this package, packed>: no package the site already had may change version (the Vite peer of 0.26.0 did);
//   3. npx vibe-cms check (config, every record round-trip, wiring);
//   4. build again: every public HTML page, sitemap / robots and every file those pages use stays identical byte for
//      byte; files only the admin uses (its script, its fonts) are listed.
// Sites: arguments (folders), or .sites.local.json (git-ignored): [{ "path": "../my-site", "config": "wrangler.jsonc",
// "site": "my-site" }]. Options: --no-build (steps 1 and 4 skipped), --keep (leave the copies, for a look).
// Usage: npm run sites:check [-- ../site-a ../site-b] [--no-build] [--keep]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const build = !flags.has("--no-build");
const listed = args.filter((arg) => !arg.startsWith("--"));
const sites = listed.length ? listed.map((path) => ({ path })) : existsSync(join(here, ".sites.local.json")) ? JSON.parse(readFileSync(join(here, ".sites.local.json"), "utf8")) : [];
if (!sites.length) { console.error("No sites: pass their folders, or list them in .sites.local.json (see the top of this file)."); process.exit(2); }

const win = process.platform === "win32";
const run = (cwd, command, commandArgs, { quiet = true } = {}) => {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8", shell: win, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: "false", ASTRO_TELEMETRY_DISABLED: "1" } });
  if (!quiet || result.status !== 0) process.stdout.write(`${result.stdout ?? ""}${result.stderr ?? ""}`.split(/\r?\n/).slice(-25).join("\n") + "\n");
  return result;
};
const must = (cwd, command, commandArgs, what) => { const result = run(cwd, command, commandArgs); if (result.status !== 0) throw new Error(`${what} failed`); return result.stdout; };

/** Every file under a folder → sha256. */
const hashes = (root) => {
  const out = new Map();
  const walk = (dir) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full); else out.set(relative(root, full).split("\\").join("/"), createHash("sha256").update(readFileSync(full)).digest("hex")); } };
  if (existsSync(root)) walk(root);
  return out;
};
/** The versions in a lockfile: "node_modules/x" → version (the package's own install is left out). */
const versions = (lock) => {
  const out = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) if (path && !path.includes("node_modules/@sonle282/vibe-cms")) out.set(path, entry.version);
  return out;
};
/** The files a public page uses: /_astro/…, and other site paths in src / href of the built HTML. */
const usedBy = (client, files) => {
  const used = new Set();
  for (const file of files) if (/\.(html|xml|txt|webmanifest)$/.test(file)) {
    const text = readFileSync(join(client, file), "utf8");
    for (const match of text.matchAll(/(?:src|href|content|srcset)=["']([^"']+)["']/g)) for (const part of match[1].split(",")) {
      const path = part.trim().split(/\s+/)[0];
      if (path.startsWith("/") && !path.startsWith("//")) used.add(decodeURIComponent(path.split(/[?#]/)[0]).replace(/^\//, ""));
    }
  }
  return used;
};
const clientOf = (root) => [join(root, "dist", "client"), join(root, "dist")].find((dir) => existsSync(dir));

console.log(`Packing @sonle282/vibe-cms (${JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version}) from ${here}`);
const packDir = mkdtempSync(join(tmpdir(), "vibe-cms-pack-"));
must(here, "npm", ["pack", "--pack-destination", packDir], "npm pack");
const tarball = join(packDir, readdirSync(packDir).find((name) => name.endsWith(".tgz")));

const results = [];
for (const entry of sites) {
  const site = resolve(here, entry.path);
  const name = entry.site ?? site.split(/[\\/]/).pop();
  const lines = [];
  const say = (ok, text) => { lines.push(`${ok === true ? "✔" : ok === false ? "✘" : "·"} ${text}`); console.log(`  ${lines.at(-1)}`); };
  console.log(`\n${name} — ${site}`);
  const copy = mkdtempSync(join(tmpdir(), `vibe-cms-site-${name}-`));
  try {
    const head = must(site, "git", ["rev-parse", "--short", "HEAD"], "git rev-parse").trim();
    const branch = must(site, "git", ["rev-parse", "--abbrev-ref", "HEAD"], "git rev-parse").trim();
    // The last commit only (what is deployed, not what is being edited); no node_modules, no .dev.vars.
    // (A relative path for tar: Git Bash's tar reads "C:\…" as a remote host.)
    const archive = join(copy, "..", `${name}-${head}.tar`);
    must(site, "git", ["archive", "--format=tar", "-o", archive, "HEAD"], "git archive");
    must(copy, "tar", ["-xf", `../${name}-${head}.tar`], "tar");
    rmSync(archive, { force: true });
    const before = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
    const was = (before.dependencies ?? {})["@sonle282/vibe-cms"] ?? (before.devDependencies ?? {})["@sonle282/vibe-cms"] ?? "(none)";
    say(undefined, `${branch} @ ${head}; package now: ${was.replace(/^.*\/download\//, "").replace(/\/.*$/, "")}`);
    must(copy, "npm", ["ci", "--no-audit", "--no-fund"], "npm ci");
    let baseline;
    if (build) {
      must(copy, "npm", ["run", "build"], "build (as it is)");
      baseline = { client: hashes(clientOf(copy)) };
      cpSync(clientOf(copy), join(copy, "..", `${name}-base-client`), { recursive: true });
      baseline.dir = join(copy, "..", `${name}-base-client`);
    }
    const lockBefore = versions(JSON.parse(readFileSync(join(copy, "package-lock.json"), "utf8")));
    must(copy, "npm", ["i", tarball, "--no-audit", "--no-fund"], "npm i (this package)");
    const lockAfter = versions(JSON.parse(readFileSync(join(copy, "package-lock.json"), "utf8")));
    const changed = [...lockBefore].filter(([path, version]) => lockAfter.has(path) && lockAfter.get(path) !== version).map(([path, version]) => `${path.replace(/^node_modules\//, "")} ${version} → ${lockAfter.get(path)}`);
    const gone = [...lockBefore.keys()].filter((path) => !lockAfter.has(path));
    const added = [...lockAfter.keys()].filter((path) => !lockBefore.has(path));
    say(changed.length === 0, changed.length ? `packages the site had changed version: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", …" : ""}` : `no package the site had changed version (${added.length} added, ${gone.length} no longer needed)`);
    const check = run(copy, "npx", ["vibe-cms", "check", ...(entry.config ? ["--config", entry.config] : []), ...(entry.site ? ["--site", entry.site] : [])]);
    const summary = `${check.stdout}`.split(/\r?\n/).reverse().find((line) => /^check (OK|failed)/.test(line)) ?? `exit ${check.status}`;
    say(check.status === 0, `vibe-cms check: ${summary.replace(/^check /, "")}`);
    if (build) {
      const built = run(copy, "npm", ["run", "build"]);
      if (built.status !== 0) say(false, "build with this package failed");
      else {
        const after = hashes(clientOf(copy));
        const used = new Set([...usedBy(baseline.dir, [...baseline.client.keys()]), ...usedBy(clientOf(copy), [...after.keys()])]);
        const pages = [...baseline.client.keys()].filter((file) => /\.(html|xml|txt|webmanifest)$/.test(file));
        const pageDiffs = pages.filter((file) => after.get(file) !== baseline.client.get(file));
        const assetDiffs = [...used].filter((file) => baseline.client.has(file) && after.get(file) !== baseline.client.get(file));
        const adminOnly = [...new Set([...baseline.client.keys(), ...after.keys()])].filter((file) => !used.has(file) && !pages.includes(file) && after.get(file) !== baseline.client.get(file));
        say(pageDiffs.length === 0 && assetDiffs.length === 0, pageDiffs.length || assetDiffs.length
          ? `public output changed: ${[...pageDiffs, ...assetDiffs].slice(0, 6).join(", ")}${pageDiffs.length + assetDiffs.length > 6 ? ", …" : ""}`
          : `${pages.length} public pages and the ${[...used].filter((file) => baseline.client.has(file)).length} files they use identical byte for byte`);
        if (adminOnly.length) say(undefined, `${adminOnly.length} files only the admin uses differ (its script, styles, fonts)`);
      }
    }
  } catch (error) { say(false, error.message); }
  finally { if (!flags.has("--keep")) { rmSync(copy, { recursive: true, force: true }); rmSync(join(copy, "..", `${name}-base-client`), { recursive: true, force: true }); } else console.log(`  (kept: ${copy})`); }
  results.push({ name, ok: lines.every((line) => !line.startsWith("✘")), lines });
}
rmSync(packDir, { recursive: true, force: true });
console.log(`\n${results.map((result) => `${result.ok ? "✔" : "✘"} ${result.name}`).join("\n")}`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
