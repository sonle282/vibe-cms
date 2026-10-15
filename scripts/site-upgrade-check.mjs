// CI: installing the package into a site that already runs must not change anything the site has. The site is
// test/sites/existing-site — made up, no client data: the oldest Astro the package supports (7.2.1) and a lockfile
// that is not new (Vite 8.2.1, as a real site's was when 0.26.0's Vite peer made npm move it to the newest Vite).
// Steps: npm ci → npm i <the package, packed> → every package the site had keeps its version → npx vibe-cms check.
// Usage: node scripts/site-upgrade-check.mjs [<a .tgz or a release URL instead of packing this one>]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(here, "test", "sites", "existing-site");
const win = process.platform === "win32";
const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: win, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: "false", ASTRO_TELEMETRY_DISABLED: "1" } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${`${result.stdout}${result.stderr}`.split(/\r?\n/).slice(-20).join("\n")}`);
  return result.stdout;
};
const versions = (dir) => {
  const out = new Map();
  for (const [path, entry] of Object.entries(JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages ?? {})) if (path && !path.includes("node_modules/@sonle282/vibe-cms")) out.set(path, entry.version);
  return out;
};

const work = mkdtempSync(join(tmpdir(), "vibe-cms-upgrade-"));
try {
  let tarball = process.argv[2];
  if (!tarball) {
    run(here, "npm", ["pack", "--pack-destination", work]);
    tarball = join(work, readdirSync(work).find((name) => name.endsWith(".tgz")));
  }
  const site = join(work, "site");
  cpSync(fixture, site, { recursive: true, filter: (path) => !/[\\/](node_modules|dist|\.astro)([\\/]|$)/.test(path) });
  run(site, "npm", ["ci", "--no-audit", "--no-fund"]);
  const before = versions(site);
  run(site, "npm", ["i", tarball, "--no-audit", "--no-fund"]);
  const after = versions(site);
  const changed = [...before].filter(([path, version]) => after.has(path) && after.get(path) !== version).map(([path, version]) => `${path.replace(/^node_modules\//, "")} ${version} → ${after.get(path)}`);
  // A nested copy that is gone was deduped onto another version at the top (0.26.0: astro's Vite 8.2.1 → Vite 8.3.4).
  const removed = [...before.keys()].filter((path) => !after.has(path)).map((path) => {
    const top = `node_modules/${path.split("node_modules/").pop()}`;
    return `${path.replace(/^node_modules\//, "")} ${before.get(path)}${after.has(top) ? ` → ${top.replace(/^node_modules\//, "")} ${after.get(top)}` : " (removed)"}`;
  });
  assert.deepEqual(changed, [], "installing the package changed the version of packages the site had");
  assert.deepEqual(removed, [], "installing the package removed packages the site had");
  const check = run(site, "npx", ["vibe-cms", "check"]);
  assert.match(check, /check OK: 1 file, 0 collections, content checked, 1 record round-trip byte for byte \(1 file\); wiring for site "existing-site" \(D1, KV, R2, rate limits\)/, "vibe-cms check on the existing site (the oldest Astro loads cms.config.ts)");
  const added = [...after.keys()].filter((path) => !before.has(path)).length;
  console.log(`Site upgrade OK: Astro 7.2.1 site with its own lockfile — ${before.size} packages kept their versions (Vite ${before.get("node_modules/astro/node_modules/vite")} inside astro), ${added} added by the package; vibe-cms check passes.`);
} finally { rmSync(work, { recursive: true, force: true }); }
