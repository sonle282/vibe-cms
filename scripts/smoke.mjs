// Smoke: run the built demo site locally (wrangler dev --local — no Cloudflare account, nothing remote) and check
// GET /admin (and every /admin/… address) → 200 with the config summary, GET /api/cms/health → the right counts, and the public pages are prerendered.
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
  assert.match(html, /<title>Demo Salon CMS<\/title>/, "the admin page is the site's CMS");
  assert.equal(admin.headers.get("x-frame-options"), "DENY", "/admin cannot be framed by another site");
  // M1: every screen has its own address, served by the same page (a link can be opened in a new tab or reloaded).
  for (const path of ["/admin/pages/site", "/admin/catalog/services/spa-pedicure", "/admin/drafts"]) {
    const deep = await fetch(`${base}${path}`);
    assert.equal(deep.status, 200, `GET ${path} → 200`);
    assert.equal(deep.headers.get("x-frame-options"), "DENY");
  }

  const health = await fetch(`${base}/api/cms/health`);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.deepEqual(body, { ok: true, package: pkg.name, version: pkg.version, site: "Demo Salon", files: 1, collections: 3, sources: 5 });

  // The CMS API is closed until sign-in exists (P6) — even with the dev variable set, because this is a production build.
  for (const [method, path] of [["GET", "/api/cms/content"], ["GET", "/api/cms/files/site"], ["POST", "/api/cms/publish"]]) {
    const response = await fetch(`${base}${path}`, { method, headers: { origin: base }, ...(method === "POST" ? { body: JSON.stringify({ resources: ["file:site"] }) } : {}) });
    const body = await response.json();
    assert.equal(response.status, 503, `${method} ${path} → 503`);
    assert.equal(body.error, "auth_not_configured");
    if (method === "GET") assert.match(response.headers.get("x-cms-live-version") ?? "", /^sha256:[0-9a-f]{64}$/, "GET carries x-cms-live-version");
  }

  // Sign-in (P6) is closed too when the site has no CMS_DB / SESSION bindings; /admin says so instead of a login form.
  // Local workerd sometimes answers the first request on a fresh route with "Network connection lost" (plain text,
  // not from the site): ask again a few times before judging the answer.
  let signIn; let signInBody;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    signIn = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ username: "someone", password: "some-password-1" }) });
    const text = await signIn.text();
    try { signInBody = JSON.parse(text); break; } catch { if (!/Network connection lost/.test(text) || attempt === 3) throw new Error(`/api/auth/login answered: ${text.slice(0, 200)}`); await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  assert.deepEqual([signIn.status, signInBody.error], [503, "auth_not_configured"], "POST /api/auth/login → 503 without bindings");
  assert.match(html, /data-state="not-configured"/, "/admin shows that sign-in is not set up");

  const upload = await fetch(`${base}/assets/uploads/2026/03/photo-0123abcd.webp`);
  assert.equal(upload.status, 404, "an upload address without the R2 bucket → 404 (P10)");
  const image = await fetch(`${base}/images/hero.svg`);
  assert.equal(image.status, 200, "the site's own images are still served as static files");
  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  assert.match(homeHtml, /Welcome to Demo Salon/, "the prerendered home page is served");
  // P9: the preview adds nothing to public pages — only the template's data-cms-* attributes are there, no CMS script.
  assert.match(homeHtml, /data-cms-field="site.hero.title"/, "the template marks its fields");
  assert.doesNotMatch(homeHtml, /<script|cmsPreview|vibe-cms/i, "no CMS script or preview code on a public page");
  console.log(`Smoke passed on ${base}: /admin 200 (not framable), /api/cms/health ${JSON.stringify(body)}, / and /services/ prerendered; /api/cms/* → 503 auth_not_configured (dev variable ignored in a production build); /api/auth/login → 503 and /admin says sign-in is not set up (no bindings); upload addresses 404 without R2; public pages carry no CMS script.`);
} finally { stop(); }
process.exit(0);
