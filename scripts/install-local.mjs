// P11: install the demo site FROM SCRATCH the way the README says — `npm i <release URL>`, `npx vibe-cms setup`, check,
// build — with the package served as a GitHub-Release-shaped URL on 127.0.0.1 (npm pack of this checkout) and NO token:
// an empty npm user config, no NODE_AUTH_TOKEN / NPM_TOKEN, no npm_* variables. Then on the built site in
// `wrangler dev --local`: the first owner signs in (bootstrap), `vibe-cms reset-owner-password` gives a temporary password
// that signs in (the old one no longer does), `export` / `import` into a fresh local D1 match row for row, and `update`
// moves to a newer release (latest from a fake GitHub API) and prints its "Site action". Everything local; temp folders.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startWranglerDev } from "./lib/wrangler-dev.mjs";

const windows = process.platform === "win32";
const repo = fileURLToPath(new URL("../", import.meta.url));
const demo = join(repo, "fixtures/demo-site");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
// The versions this checkout is tested with (its lockfile): the newest adapter can need a newer astro than the newest astro 7.
const locked = (name) => JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")).packages[`node_modules/${name}`].version;
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next = `${major}.${minor}.${patch + 1}`;
const work = mkdtempSync(join(tmpdir(), "vibe-cms-install-"));
const started = Date.now();

// No token anywhere: a clean environment for npm / npx (no npm_* from the parent `npm run`, no auth variables).
const userconfig = join(work, "empty.npmrc");
writeFileSync(userconfig, "");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_|^NODE_AUTH_TOKEN$|^NPM_TOKEN$|^VIBE_CMS_/i.test(key)));
Object.assign(env, { npm_config_userconfig: userconfig, WRANGLER_SEND_METRICS: "false" });
// Async on purpose: the fake release server below runs in this process and must keep answering while npm runs.
const sh = (command, args, cwd, extra = {}) => new Promise((resolve) => {
  const child = spawn(windows ? `${command}.cmd` : command, args, { cwd, shell: windows, env: { ...env, ...extra } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});
const ok = (result, what) => { assert.equal(result.status, 0, `${what} failed:\n${result.stdout}\n${result.stderr}`); return result.stdout; };
const vibe = (args, cwd, extra) => sh("npx", ["--no-install", "vibe-cms", ...args], cwd, extra);

// 1. Two releases on a local "GitHub": this checkout (X.Y.Z) and the same code as X.Y.(Z+1) with a CHANGELOG site action.
const releases = join(work, "releases");
const packInto = async (from, version) => {
  const out = join(releases, `v${version}`);
  mkdirSync(out, { recursive: true });
  const [packed] = JSON.parse(ok(await sh("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", out], from), `npm pack ${version}`));
  assert.equal(packed.filename, `sonle282-vibe-cms-${version}.tgz`);
  cpSync(join(out, packed.filename), join(out, `vibe-cms-${version}.tgz`));
  rmSync(join(out, packed.filename));
  return packed;
};
const current = await packInto(repo, pkg.version);
const nextSrc = join(work, "next-src");
for (const file of current.files) { mkdirSync(dirname(join(nextSrc, file.path)), { recursive: true }); cpSync(join(repo, file.path), join(nextSrc, file.path)); }
writeFileSync(join(nextSrc, "package.json"), JSON.stringify({ ...pkg, version: next }, null, 2));
writeFileSync(join(nextSrc, "docs/CHANGELOG.md"), readFileSync(join(repo, "docs/CHANGELOG.md"), "utf8").replace(/^## /m, `## ${next} — install test\n\n- Site action: install-test note.\n\n## `));
await packInto(nextSrc, next);

const server = createServer((request, response) => {
  if (request.url === "/repos/sonle282/vibe-cms/releases/latest") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ tag_name: `v${next}` })); return; }
  const file = join(releases, decodeURIComponent(request.url ?? "/").replace(/^\/+/, ""));
  if (!/^\/v\d+\.\d+\.\d+\/vibe-cms-\d+\.\d+\.\d+\.tgz$/.test(request.url ?? "") || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "application/octet-stream", "content-length": statSync(file).size });
  if (request.method === "HEAD") response.end(); else createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const url = (version) => `${base}/v${version}/vibe-cms-${version}.tgz`;
const stops = [];

try {
  // 2. A site that does not have the CMS yet: the demo's pages + config, astro + wrangler only.
  const site = join(work, "site");
  for (const name of ["src", "public", "astro.config.mjs", "cms.config.ts", "tsconfig.json", "wrangler.jsonc"]) cpSync(join(demo, name), join(site, name), { recursive: true });
  writeFileSync(join(site, "package.json"), `${JSON.stringify({ name: "install-test-site", private: true, type: "module", scripts: { build: "astro build" }, dependencies: { astro: locked("astro") }, devDependencies: { wrangler: locked("wrangler") } }, null, 2)}\n`);

  // README → Install step 1: npm i <release URL> @astrojs/cloudflare
  ok(await sh("npm", ["i", url(pkg.version), `@astrojs/cloudflare@${locked("@astrojs/cloudflare")}`, "--no-audit", "--no-fund"], site), "npm i <release URL>");
  const sitePkg = JSON.parse(readFileSync(join(site, "package.json"), "utf8"));
  assert.equal(sitePkg.dependencies["@sonle282/vibe-cms"], url(pkg.version), "package.json pins the release URL");
  const lock = JSON.parse(readFileSync(join(site, "package-lock.json"), "utf8")).packages["node_modules/@sonle282/vibe-cms"];
  assert.deepEqual([lock.resolved, lock.version, /^sha512-/.test(lock.integrity)], [url(pkg.version), pkg.version, true], "package-lock records the URL + integrity");

  // README → step 4: setup (local: no account) — twice, the second changes nothing.
  const setup1 = ok(await vibe(["setup", "--site", "demo", "--local"], site), "vibe-cms setup");
  assert.match(setup1, /wrangler\.jsonc: 5 changes[\s\S]*migrations applied \(local\): 0001_draft_index\.sql, .*0005_audit_log_auth\.sql/);
  const wrangler1 = readFileSync(join(site, "wrangler.jsonc"), "utf8");
  assert.match(wrangler1, /"migrations_dir": "node_modules\/@sonle282\/vibe-cms\/migrations"/, "migrations come from the installed package");
  const setup2 = ok(await vibe(["setup", "--site", "demo", "--local"], site), "vibe-cms setup (again)");
  assert.match(setup2, /wrangler\.jsonc: already up to date[\s\S]*migrations: up to date \(local\)/);
  assert.equal(readFileSync(join(site, "wrangler.jsonc"), "utf8"), wrangler1, "second setup: wrangler.jsonc identical");

  const checked = await vibe(["check"], site);
  assert.equal(checked.status, 0, `vibe-cms check:\n${checked.stdout}\n${checked.stderr}`);
  assert.match(checked.stdout, /check OK: 1 files, 3 collections, content checked; wiring for site "demo"/);
  ok(await sh("npm", ["run", "build"], site), "astro build");
  const built = JSON.parse(readFileSync(join(site, "dist/server/wrangler.json"), "utf8"));
  assert.deepEqual([built.d1_databases?.[0]?.binding, built.kv_namespaces?.find((kv) => kv.binding === "SESSION")?.id, built.r2_buckets?.[0]?.bucket_name, built.ratelimits?.length, built.images], ["CMS_DB", "local-demo-session", "demo-media", 2, undefined], "the built Worker carries the bindings setup wrote (and no IMAGES)");

  // 3. The built site: bootstrap owner → reset-owner-password → only the temporary password signs in.
  const persist = join(site, ".wrangler/state");
  const OWNER = { username: "olivia", password: "bootstrap-password-123" };
  const dev = async () => { const server = await startWranglerDev({ cwd: site, config: "dist/server/wrangler.json", ready: "/api/cms/health", args: ["--persist-to", persist, "--var", `CMS_BOOTSTRAP_USERNAME:${OWNER.username}`, "--var", `CMS_BOOTSTRAP_PASSWORD:${OWNER.password}`] }); stops.push(server.stop); return server; };
  const login = (base, password) => fetch(`${base}/api/auth/login`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ username: OWNER.username, password }) });
  let running = await dev();
  const health = await (await fetch(`${running.base}/api/cms/health`)).json();
  assert.deepEqual([health.ok, health.version], [true, pkg.version], "/api/cms/health answers from the installed release");
  const first = await login(running.base, OWNER.password);
  assert.equal(first.status, 200, "the bootstrap owner signs in");
  assert.equal((await first.json()).mustChangePassword, true);
  running.stop();

  const reset = ok(await vibe(["reset-owner-password", "--local"], site), "vibe-cms reset-owner-password");
  const temporary = /\n {2}(\S{20})\n/.exec(reset)?.[1];
  assert.ok(temporary, `a 20-character temporary password is printed:\n${reset}`);
  running = await dev();
  assert.equal((await login(running.base, OWNER.password)).status, 401, "the old password no longer signs in");
  const second = await login(running.base, temporary);
  assert.equal(second.status, 200, "the temporary password signs in");
  assert.equal((await second.json()).mustChangePassword, true, "…and must be changed");
  running.stop();

  // 4. export → import into a fresh local D1 (another database id = another local database): rows match.
  const exported = ok(await vibe(["export", "--out", "backup", "--local"], site), "vibe-cms export");
  const counts = JSON.parse(readFileSync(join(site, "backup/demo-cms.counts.json"), "utf8"));
  assert.ok(counts.tables.cms_users === 1 && counts.tables.cms_audit_log >= 3 && counts.tables.cms_auth_state === 1, `counts: ${JSON.stringify(counts.tables)}`);
  assert.match(exported, /keep it private/);
  writeFileSync(join(site, "wrangler.import.jsonc"), wrangler1.replace('"local-demo-cms"', '"local-demo-cms-import"'));
  ok(await vibe(["migrate", "--local", "--config", "wrangler.import.jsonc"], site), "vibe-cms migrate (fresh database)");
  const imported = ok(await vibe(["import", "--file", "backup/demo-cms.sql", "--local", "--config", "wrangler.import.jsonc"], site), "vibe-cms import");
  assert.match(imported, /Row counts match/);
  const again = await vibe(["import", "--file", "backup/demo-cms.sql", "--local", "--config", "wrangler.import.jsonc"], site);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has data/, "a second import is refused");

  // 5. update: latest (fake GitHub API) → X.Y.(Z+1), its site action printed; same version again = nothing; unknown = nothing.
  const overrides = { VIBE_CMS_RELEASES_URL: base, VIBE_CMS_GITHUB_API_URL: base };
  const updated = ok(await vibe(["update"], site, overrides), "vibe-cms update");
  assert.match(updated, new RegExp(`Installed @sonle282/vibe-cms ${next.replace(/\./g, "\\.")}[\\s\\S]*${next.replace(/\./g, "\\.")}: install-test note\\.`));
  assert.equal(JSON.parse(readFileSync(join(site, "package.json"), "utf8")).dependencies["@sonle282/vibe-cms"], url(next));
  assert.equal(JSON.parse(readFileSync(join(site, "node_modules/@sonle282/vibe-cms/package.json"), "utf8")).version, next);
  assert.match(ok(await vibe(["update", next], site, overrides), "vibe-cms update (same)"), /Already on/);
  const before = readFileSync(join(site, "package.json"), "utf8");
  const missing = await vibe(["update", "9.9.9"], site, overrides);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /release v9\.9\.9 not found .* nothing changed/);
  assert.equal(readFileSync(join(site, "package.json"), "utf8"), before);

  console.log(`Install (local) OK in ${Math.round((Date.now() - started) / 1000)} s: npm i <release URL> with no token → setup ×2 (second: no change) → check → build → bootstrap owner signs in → reset-owner-password (old password 401, temporary 200 + must change) → export / import ${Object.values(counts.tables).reduce((a, b) => a + b, 0)} rows match → update ${pkg.version} → ${next} (latest, site action shown).`);
} finally {
  stops.forEach((stop) => stop());
  server.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(0);
