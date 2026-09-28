// P5: the CMS API in Node (memory stores + a fake GitHub on 127.0.0.1). The same scenario runs against a Worker in
// `wrangler dev --local` (scripts/api-local.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, devIdentity, loadCmsConfig } from "../dist/index.js";
import { runApiScenario } from "./helpers/api-scenario.mjs";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let demoFiles;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  demoFiles = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});

const testIdentity = (request) => {
  const value = request.headers.get("x-test-user");
  if (!value) return null;
  const [userId, role] = value.split(":");
  return { userId, role };
};

/** Harness: api.handle in Node; "live" content = a map that redeploy() refreshes from the branch head. */
const harness = async ({ token } = {}) => {
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files: demoFiles });
  const drafts = createMemoryDraftStore(); const audit = createMemoryAuditLog();
  const publisher = createGitHubPublisher({ token: token ?? github.token, repo: config.repo, apiUrl: github.url });
  let live = { ...demoFiles };
  const build = (extra = {}) => createCmsApi({ config, source: createBundledSource(live), drafts, audit, publisher, identify: testIdentity, ...extra });
  let api = build();
  const request = async (method, path, { body, user, origin = "http://localhost", raw, headers = {} } = {}) => {
    const init = { method, headers: { ...(user ? { "x-test-user": user } : {}), ...(origin ? { origin } : {}), ...headers } };
    if (raw !== undefined || body !== undefined) { init.body = raw ?? JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    const response = await api.handle(new Request(`http://localhost${path}`, init));
    return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
  };
  return {
    github, drafts, audit, request,
    rebuild: (extra) => { api = build(extra); },
    redeploy: async () => { live = { ...github.files() }; api = build(); },
    auditRows: async () => audit.entries,
    close: () => github.close(),
  };
};

test("end-to-end: draft → publish → fake GitHub (every check)", async () => {
  const h = await harness();
  try {
    const checks = await runApiScenario(h);
    assert.deepEqual(checks.filter((check) => !check.ok), []);
    assert.equal(checks.length, 50);
  } finally { await h.close(); }
});

test("without sign-in configured every route answers 503 auth_not_configured (health is a separate route)", async () => {
  const api = createCmsApi({ config, source: createBundledSource(demoFiles), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => undefined });
  for (const [method, path] of [["GET", "/api/cms/content"], ["GET", "/api/cms/files/site"], ["PUT", "/api/cms/files/site"], ["POST", "/api/cms/publish"], ["GET", "/api/cms/live-version"]]) {
    const response = await api.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://localhost" }, ...(method === "GET" ? {} : { body: "{}" }) }));
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.equal((await response.json()).error, "auth_not_configured");
  }
});

test("dev identity: only when enabled (import.meta.env.DEV) AND the request is for localhost", async () => {
  const on = devIdentity({ enabled: true, value: "usr_dev:owner" });
  assert.deepEqual(await on(new Request("http://localhost:4321/api/cms/content")), { userId: "usr_dev", role: "owner" });
  assert.deepEqual(await on(new Request("http://127.0.0.1:8787/api/cms/content")), { userId: "usr_dev", role: "owner" });
  assert.equal(await on(new Request("https://demo.example/api/cms/content")), undefined, "a real host never gets the dev identity");
  assert.equal(await devIdentity({ enabled: false, value: "usr_dev:owner" })(new Request("http://localhost/api/cms/content")), undefined, "production build (DEV false) ignores the variable");
  assert.equal(await devIdentity({ enabled: true, value: undefined })(new Request("http://localhost/api/cms/content")), undefined);
  assert.equal((await devIdentity({ enabled: true, value: "usr_dev" })(new Request("http://localhost/"))).role, "editor", "role defaults to editor");
  assert.throws(() => devIdentity({ enabled: true, value: "me@example.com:owner" })(new Request("http://localhost/")), /never an email/);
  const api = createCmsApi({ config, source: createBundledSource(demoFiles), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: devIdentity({ enabled: false, value: "usr_dev:owner" }) });
  assert.equal((await api.handle(new Request("http://localhost/api/cms/content"))).status, 503);
});

test("storage or publisher missing → 503 with a clear code", async () => {
  const noStorage = createCmsApi({ config, source: createBundledSource(demoFiles), identify: () => ({ userId: "usr_a", role: "owner" }) });
  const response = await noStorage.handle(new Request("http://localhost/api/cms/content"));
  assert.deepEqual([response.status, (await response.json()).error], [503, "storage_not_configured"]);
  const noPublisher = createCmsApi({ config, source: createBundledSource(demoFiles), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_a", role: "owner" }) });
  const publish = await noPublisher.handle(new Request("http://localhost/api/cms/publish", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ resources: ["file:site"] }) }));
  assert.deepEqual([publish.status, (await publish.json()).error], [503, "publisher_not_configured"]);
});

test("a wrong GitHub token → 502 github_unauthorized; the token never appears in the response or audit", async () => {
  const h = await harness({ token: "ghp_WRONG_TOKEN_should_never_leak" });
  try {
    const site = (await h.request("GET", "/api/cms/files/site", { user: "usr_owner1:owner" })).body;
    await h.request("PUT", "/api/cms/files/site", { user: "usr_owner1:owner", body: { content: { ...site.content, tagline: "x" }, expectedRevision: 0, sourceVersion: site.version } });
    const result = await h.request("POST", "/api/cms/publish", { user: "usr_owner1:owner", body: { resources: ["file:site"] } });
    assert.deepEqual([result.status, result.body.error], [502, "github_unauthorized"]);
    assert.ok(!JSON.stringify(result).includes("WRONG_TOKEN") && !JSON.stringify(h.audit.entries).includes("WRONG_TOKEN"));
    assert.equal(h.audit.entries.at(-1).detail.code, "github_unauthorized");
    assert.ok(!/\bat \w+ \(|\.js:\d+/.test(JSON.stringify(result.body)), "no stack trace");
  } finally { await h.close(); }
});

test("when the writer had to re-write a whole file: the publish succeeds, warns, and audits it", async () => {
  const h = await harness();
  try {
    h.rebuild({ write: (_kind, _text, _id, content) => ({ text: `${JSON.stringify(content, null, 2)}\n`, rewroteWholeFile: true }) });
    const site = (await h.request("GET", "/api/cms/files/site", { user: "usr_owner1:owner" })).body;
    await h.request("PUT", "/api/cms/files/site", { user: "usr_owner1:owner", body: { content: { ...site.content, tagline: "Rewritten" }, expectedRevision: 0, sourceVersion: site.version } });
    const result = await h.request("POST", "/api/cms/publish", { user: "usr_owner1:owner", body: { resources: ["file:site"] } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.warnings, [{ resource: "file:site", code: "rewrote_whole_file" }]);
    assert.equal(h.audit.entries.find((row) => row.action === "succeeded").detail.warning, "rewrote_whole_file");
  } finally { await h.close(); }
});

test("an unexpected failure is a plain 500 JSON without internals", async () => {
  const broken = { ...createMemoryDraftStore(), mine: async () => { throw new Error("secret internal detail at /srv/x.js:12"); } };
  const api = createCmsApi({ config, source: createBundledSource(demoFiles), drafts: broken, audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_a", role: "owner" }) });
  const response = await api.handle(new Request("http://localhost/api/cms/content"));
  const body = await response.json();
  assert.deepEqual([response.status, body.error], [500, "internal_error"]);
  assert.ok(!JSON.stringify(body).includes("secret internal detail"));
});
