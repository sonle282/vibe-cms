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
    api: () => api,
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
    assert.equal(checks.length, 58);
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

test("P8: GET /drafts lists my drafts (label, group, new / stale) — someone else's drafts are not mine", async () => {
  const h = await harness();
  try {
    const site = (await h.request("GET", "/api/cms/files/site", { user: "usr_a:owner" })).body;
    await h.request("PUT", "/api/cms/files/site", { user: "usr_a:owner", body: { content: { ...site.content, tagline: "A" }, expectedRevision: 0, sourceVersion: site.version } });
    await h.request("PUT", "/api/cms/collections/services/items/gel-off", { user: "usr_a:owner", body: { content: { id: "gel-off", name: "Gel Off" }, expectedRevision: 0, sourceVersion: "new" } });
    await h.request("PUT", "/api/cms/files/site", { user: "usr_b:editor", body: { content: { ...site.content, tagline: "B" }, expectedRevision: 0, sourceVersion: site.version } });
    const mine = await h.request("GET", "/api/cms/drafts", { user: "usr_a:owner" });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.drafts.map((row) => [row.resource, row.label, row.group, row.isNew, row.stale]).sort(), [
      ["file:site", "Salon info", "Salon info", false, false],
      ["item:services:gel-off", "Gel Off", "Services", true, false],
    ]);
    assert.ok(!JSON.stringify(mine.body).includes("tagline"), "no content in the list");
    // Someone publishes another field of the salon info: my draft is carried over (F3), not stale.
    h.github.pushOther({ "src/data/site.json": h.github.files()["src/data/site.json"].replace("Demo Salon", "Demo Salon 2") });
    await h.redeploy();
    const after = await h.request("GET", "/api/cms/drafts", { user: "usr_a:owner" });
    assert.equal(after.body.drafts.find((row) => row.resource === "file:site").stale, false);
    // …and the tagline too: both changed it → stale, naming it.
    h.github.pushOther({ "src/data/site.json": h.github.files()["src/data/site.json"].replace(/"tagline": "[^"]*"/, '"tagline": "Theirs"') });
    await h.redeploy();
    const stale = (await h.request("GET", "/api/cms/drafts", { user: "usr_a:owner" })).body.drafts.find((row) => row.resource === "file:site");
    assert.deepEqual([stale.stale, stale.conflicts], [true, ["Tagline"]]);
  } finally { await h.close(); }
});

test("P8: the GitHub API URL can only be redirected to this machine (tests); anything else means api.github.com", async () => {
  const { loopbackApiUrl } = await import("../dist/api/index.js");
  assert.equal(loopbackApiUrl("http://127.0.0.1:9123/x"), "http://127.0.0.1:9123");
  assert.equal(loopbackApiUrl("http://localhost:8080"), "http://localhost:8080");
  for (const value of ["https://evil.example", "http://10.0.0.1", "http://127.0.0.1.evil.example", "http://user:pw@127.0.0.1", "https://127.0.0.1", "", undefined, 42]) assert.equal(loopbackApiUrl(value), undefined, String(value));
});

test("F12: schedule a draft (WordPress's Schedule) — the cron publishes it when due, as its person; one that cannot go out says why", async () => {
  const h = await harness();
  try {
    let clock = Date.parse("2026-11-05T09:00:00Z");
    const roles = new Map([["usr_a", "owner"]]);
    h.rebuild({ now: () => new Date(clock).toISOString(), userRole: async (id) => roles.get(id) });
    const user = "usr_a:owner";
    const site = (await h.request("GET", "/api/cms/files/site", { user })).body;
    const noDraft = await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: "2026-11-06T02:00:00Z" } });
    assert.deepEqual([noDraft.status, noDraft.body.error], [404, "no_draft"]);
    await h.request("PUT", "/api/cms/files/site", { user, body: { content: { ...site.content, tagline: "Scheduled tagline" }, expectedRevision: 0, sourceVersion: site.version } });
    const past = await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: "2026-11-05T09:00:30Z" } });
    assert.deepEqual([past.status, past.body.error], [422, "schedule_in_past"]);
    const set = await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: "2026-11-06T09:00:00+07:00" } });
    assert.deepEqual([set.status, set.body.publishAt], [200, "2026-11-06T02:00:00.000Z"]);
    assert.equal((await h.request("GET", "/api/cms/files/site", { user })).body.draft.publishAt, "2026-11-06T02:00:00.000Z");
    assert.equal((await h.request("GET", "/api/cms/drafts", { user })).body.drafts[0].publishAt, "2026-11-06T02:00:00.000Z");
    // A save keeps the schedule.
    const draft = (await h.request("GET", "/api/cms/files/site", { user })).body.draft;
    await h.request("PUT", "/api/cms/files/site", { user, body: { content: { ...draft.content, tagline: "Scheduled tagline 2" }, expectedRevision: draft.revision } });
    assert.equal((await h.request("GET", "/api/cms/files/site", { user })).body.draft.publishAt, "2026-11-06T02:00:00.000Z");
    // Not due yet: nothing happens.
    const head = h.github.head();
    assert.deepEqual(await h.api().runScheduled(new Date("2026-11-06T01:59:00Z")), { published: [], failed: [] });
    assert.equal(h.github.head(), head);
    // Due: published, the draft (and its schedule) is gone, the activity log says it was scheduled.
    clock = Date.parse("2026-11-06T02:03:00Z");
    assert.deepEqual(await h.api().runScheduled(new Date(clock)), { published: ["file:site"], failed: [] });
    assert.match(h.github.files()["src/data/site.json"], /Scheduled tagline 2/);
    assert.equal((await h.request("GET", "/api/cms/files/site", { user })).body.draft, null);
    assert.ok((await h.auditRows()).some((row) => row.action === "succeeded" && row.detail.scheduled === true));
    // Someone who can no longer sign in: not published, the schedule comes off, the draft says why.
    await h.redeploy();
    h.rebuild({ now: () => new Date(clock).toISOString(), userRole: async (id) => roles.get(id) });
    const again = (await h.request("GET", "/api/cms/files/site", { user })).body;
    await h.request("PUT", "/api/cms/files/site", { user, body: { content: { ...again.content, tagline: "Never" }, expectedRevision: 0, sourceVersion: again.version } });
    await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: "2026-11-06T03:00:00Z" } });
    roles.delete("usr_a");
    assert.deepEqual(await h.api().runScheduled(new Date("2026-11-06T03:01:00Z")), { published: [], failed: ["file:site"] });
    const kept = (await h.request("GET", "/api/cms/files/site", { user })).body.draft;
    assert.deepEqual([kept.publishAt, kept.scheduleNote, kept.content.tagline], [undefined, "The person who scheduled it can no longer sign in, so it was not published.", "Never"]);
    // null takes a schedule off.
    await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: "2026-11-06T05:00:00Z" } });
    const off = await h.request("PUT", "/api/cms/schedule", { user, body: { resource: "file:site", at: null } });
    assert.deepEqual([off.status, off.body.publishAt, (await h.request("GET", "/api/cms/files/site", { user })).body.draft.publishAt], [200, null, undefined]);
  } finally { await h.close(); }
});
