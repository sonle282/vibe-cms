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

// VIBE_CMS_DEV_USER is set on purpose: a production build must ignore it (the dev identity needs import.meta.env.DEV).
const { base, stop } = await startWranglerDev({ cwd: site, config: "dist/server/wrangler.json", args: ["--var", "VIBE_CMS_DEV_USER:usr_dev:owner"] });
try {
  const admin = await fetch(`${base}/admin`);
  const html = await admin.text();
  assert.equal(admin.status, 200, "GET /admin → 200");
  assert.match(html, /Vibe CMS — config OK: <!--.*?-->?1<!--.*?-->? files, <!--.*?-->?1<!--.*?-->? collections|Vibe CMS — config OK: 1 files, 1 collections/, "the admin page shows the config summary");

  const health = await fetch(`${base}/api/cms/health`);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.deepEqual(body, { ok: true, package: pkg.name, version: pkg.version, site: "Demo Salon", files: 1, collections: 1, sources: 2 });

  // The CMS API is closed until sign-in exists (P6) — even with the dev variable set, because this is a production build.
  for (const [method, path] of [["GET", "/api/cms/content"], ["GET", "/api/cms/files/site"], ["POST", "/api/cms/publish"]]) {
    const response = await fetch(`${base}${path}`, { method, headers: { origin: base }, ...(method === "POST" ? { body: JSON.stringify({ resources: ["file:site"] }) } : {}) });
    const body = await response.json();
    assert.equal(response.status, 503, `${method} ${path} → 503`);
    assert.equal(body.error, "auth_not_configured");
    if (method === "GET") assert.match(response.headers.get("x-cms-live-version") ?? "", /^sha256:[0-9a-f]{64}$/, "GET carries x-cms-live-version");
  }

  // Sign-in (P6) is closed too when the site has no CMS_DB / SESSION bindings; /admin says so instead of a login form.
  const signIn = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ username: "someone", password: "some-password-1" }) });
  assert.deepEqual([signIn.status, (await signIn.json()).error], [503, "auth_not_configured"], "POST /api/auth/login → 503 without bindings");
  assert.match(html, /data-state="not-configured"/, "/admin shows that sign-in is not set up");

  const home = await fetch(`${base}/`);
  assert.match(await home.text(), /Welcome to Demo Salon/, "the prerendered home page is served");
  console.log(`Smoke passed on ${base}: /admin 200 (config OK: 1 files, 1 collections), /api/cms/health ${JSON.stringify(body)}, / and /services/ prerendered; /api/cms/* → 503 auth_not_configured (dev variable ignored in a production build); /api/auth/login → 503 and /admin says sign-in is not set up (no bindings).`);
} finally { stop(); }
process.exit(0);
