// P7 e2e helpers: run the BUILT demo site (fixtures/demo-site/dist) in `wrangler dev --local` with the CMS bindings
// (local D1 with the package migrations, local KV, local R2 for uploads (P10), local rate limits — placeholder ids, nothing remote, nothing
// deployed), and find a Chrome / Chromium to drive headless with playwright-core (no browser download).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { npx, startWranglerDev } from "./wrangler-dev.mjs";

export const site = fileURLToPath(new URL("../../fixtures/demo-site/", import.meta.url));
const migrations = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Chrome / Chromium for headless runs: CHROME_PATH, the sandbox's pre-installed Chromium, or the CI runner's Chrome. */
export const findChrome = () => {
  const candidates = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`No Chrome / Chromium found (tried ${candidates.join(", ")}). Set CHROME_PATH.`);
  return found;
};

/** Start the built demo with CMS bindings; vars = extra --var values (test values only). */
export const startDemoWithCms = async (vars = {}) => {
  const built = join(site, "dist/server/wrangler.json");
  assert.ok(existsSync(built), "dist/server/wrangler.json exists (run npm run demo:build first)");
  const config = JSON.parse(readFileSync(built, "utf8"));
  const e2eConfig = {
    ...config,
    d1_databases: [{ binding: "CMS_DB", database_name: "vibe-cms-e2e", database_id: "local-only-e2e", migrations_dir: migrations }],
    kv_namespaces: [{ binding: "SESSION", id: "local-only-e2e-sessions" }],
    r2_buckets: [{ binding: "CMS_MEDIA", bucket_name: "vibe-cms-e2e-media" }],
    ratelimits: [
      { name: "CMS_LOGIN_LIMITER", namespace_id: "9101", simple: { limit: 10, period: 60 } },
      { name: "CMS_PUBLISH_LIMITER", namespace_id: "9102", simple: { limit: 20, period: 60 } },
    ],
  };
  delete e2eConfig.configPath; delete e2eConfig.userConfigPath; delete e2eConfig.previews;
  const file = "dist/server/wrangler.e2e.json";
  writeFileSync(join(site, file), JSON.stringify(e2eConfig));
  const persist = mkdtempSync(join(tmpdir(), "vibe-cms-e2e-"));
  const applied = npx(["wrangler", "d1", "migrations", "apply", "CMS_DB", "--local", "--persist-to", persist, "--config", file], { cwd: site, input: "y\n" });
  assert.equal(applied.status, 0, `migrations apply failed:\n${applied.stdout}\n${applied.stderr}`);
  const server = await startWranglerDev({ cwd: site, config: file, ready: "/api/cms/health", args: ["--persist-to", persist, ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`])] });
  return { ...server, stop: () => { server.stop(); rmSync(persist, { recursive: true, force: true }); rmSync(join(site, file), { force: true }); } };
};
