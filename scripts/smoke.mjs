// Smoke: run the built demo site locally (wrangler dev --local — no Cloudflare account, nothing remote) and check
// GET /admin → 200 with the config summary, GET /api/cms/health → the right counts, and the public pages are prerendered.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startWranglerDev } from "./lib/wrangler-dev.mjs";

const site = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const page of ["dist/client/index.html", "dist/client/services/index.html", "dist/server/wrangler.json"]) assert.ok(existsSync(site + page), `${page} exists (run npm run demo:build first)`);
assert.ok(!existsSync(site + "dist/client/admin/index.html"), "/admin is not prerendered");
// No Cloudflare IMAGES binding (imageService: "compile"); SESSION (KV) stays until P6 names it <site>-session.
const worker = JSON.parse(readFileSync(site + "dist/server/wrangler.json", "utf8"));
assert.equal(worker.images, undefined, "the generated wrangler.json has no IMAGES binding");
assert.equal(worker.previews?.images, undefined, "no IMAGES binding for previews either");

const { base, stop } = await startWranglerDev({ cwd: site, config: "dist/server/wrangler.json" });
try {
  const admin = await fetch(`${base}/admin`);
  const html = await admin.text();
  assert.equal(admin.status, 200, "GET /admin → 200");
  assert.match(html, /Vibe CMS — config OK: <!--.*?-->?1<!--.*?-->? files, <!--.*?-->?1<!--.*?-->? collections|Vibe CMS — config OK: 1 files, 1 collections/, "the admin page shows the config summary");

  const health = await fetch(`${base}/api/cms/health`);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.deepEqual(body, { ok: true, package: pkg.name, version: pkg.version, site: "Demo Salon", files: 1, collections: 1, sources: 2 });

  const home = await fetch(`${base}/`);
  assert.match(await home.text(), /Welcome to Demo Salon/, "the prerendered home page is served");
  console.log(`Smoke passed on ${base}: /admin 200 (config OK: 1 files, 1 collections), /api/cms/health ${JSON.stringify(body)}, / and /services/ prerendered.`);
} finally { stop(); }
process.exit(0);
