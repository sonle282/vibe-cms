// P1 smoke: run the built demo site locally (wrangler dev --local — no Cloudflare account, nothing remote) and check
// GET /admin → 200 with the config summary, GET /api/cms/health → the right counts, and the public pages are prerendered.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const page of ["dist/client/index.html", "dist/client/services/index.html", "dist/server/wrangler.json"]) assert.ok(existsSync(site + page), `${page} exists (run npm run demo:build first)`);
assert.ok(!existsSync(site + "dist/client/admin/index.html"), "/admin is not prerendered");

const port = 8700 + Math.floor(Math.random() * 200);
const windows = process.platform === "win32";
const child = spawn(windows ? "npx.cmd" : "npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", String(port), "--local", "--ip", "127.0.0.1"], { cwd: site, stdio: ["ignore", "pipe", "pipe"], shell: windows, detached: !windows, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
let log = ""; child.stdout.on("data", (chunk) => { log += chunk; }); child.stderr.on("data", (chunk) => { log += chunk; });
// Stop the whole tree (npx → wrangler → workerd): taskkill /T on Windows, the process group elsewhere (detached above).
const stop = () => {
  if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  child.stdout.destroy(); child.stderr.destroy();
};
const base = `http://127.0.0.1:${port}`;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { await new Promise((resolve) => setTimeout(resolve, 500)); up = await fetch(`${base}/`).then((response) => response.ok, () => false); }
  assert.ok(up, `wrangler dev did not start:\n${log.slice(-2000)}`);

  const admin = await fetch(`${base}/admin`);
  const html = await admin.text();
  assert.equal(admin.status, 200, "GET /admin → 200");
  assert.match(html, /Vibe CMS — config OK: <!--.*?-->?1<!--.*?-->? files, <!--.*?-->?1<!--.*?-->? collections|Vibe CMS — config OK: 1 files, 1 collections/, "the admin page shows the config summary");

  const health = await fetch(`${base}/api/cms/health`);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.deepEqual(body, { ok: true, package: pkg.name, version: pkg.version, site: "Demo Salon", files: 1, collections: 1 });

  const home = await fetch(`${base}/`);
  assert.match(await home.text(), /Welcome to Demo Salon/, "the prerendered home page is served");
  console.log(`Smoke passed on ${base}: /admin 200 (config OK: 1 files, 1 collections), /api/cms/health ${JSON.stringify(body)}, / and /services/ prerendered.`);
} finally { stop(); }
process.exit(0);
