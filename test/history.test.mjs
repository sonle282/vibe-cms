// P12c: History + Restore as draft — versions from the branch's commits (CMS publishes and edits in the code), a JSON
// list's record only where IT changed, restore as a draft that is then published like any draft; M12: every role (an
// admin-only resource: admins), and a Version history dialog over the editor as in the Mr Spa CMS.
// The REAL API on memory stores with a fake GitHub on 127.0.0.1, and the admin on a fake DOM (happy-dom).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminBoot, startAdmin } from "../dist/admin/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files; let site; let services;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
  site = JSON.parse(files["src/data/site.json"]);
  services = JSON.parse(files["src/data/services.json"]);
});

const users = { owner: { userId: "usr_owner", role: "owner" }, editor: { userId: "usr_editor", role: "editor" } };
/** The site after each publish: live content = the fake branch (redeploy), like Workers Builds would. */
const harness = async () => {
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files });
  const drafts = createMemoryDraftStore(); const audit = createMemoryAuditLog();
  const publisher = createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url });
  let live = { ...files };
  let withConfig = config;
  const build = () => createCmsApi({
    config: withConfig, source: createBundledSource(live), drafts, audit, publisher,
    identify: (request) => users[request.headers.get("x-as") ?? "owner"],
    userNames: async () => [{ id: "usr_owner", username: "olivia", displayName: "Olivia" }],
  });
  let api = build();
  const call = async (method, path, { as = "owner", body } = {}) => {
    const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { "x-as": as, origin: "http://localhost", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  const redeploy = () => { live = { ...github.files() }; api = build(); };
  /** Save a draft of `resource` (GET for the version first) and publish it; then redeploy. */
  const publishChange = async (path, resource, content) => {
    const current = (await call("GET", path)).body;
    const saved = await call("PUT", path, { body: { content, expectedRevision: current.draft?.revision ?? 0, ...(current.draft ? {} : { sourceVersion: current.version ?? "new" }) } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const published = await call("POST", "/publish", { body: { resources: [resource] } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    redeploy();
    return published.body.commitSha;
  };
  return { github, drafts, call, redeploy, publishChange, setConfig: (next) => { withConfig = next; api = build(); }, close: () => github.close() };
};

test("history of a file: CMS publishes and code edits, newest first, who did it; every role (M12), admin-only files: admins", async () => {
  const h = await harness();
  try {
    const first = await h.publishChange("/files/site", "file:site", { ...site, tagline: "First change" });
    h.github.pushOther({ "src/data/site.json": JSON.stringify({ ...site, tagline: "Edited in the code" }, null, 2) + "\n" }, "Fix the tagline by hand");
    h.github.pushOther({ "src/data/team.json": files["src/data/team.json"].replace("\n", "\n ") }, "An unrelated file");
    h.redeploy();
    const history = await h.call("GET", `/history?resource=${encodeURIComponent("file:site")}`);
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.deepEqual(history.body.versions.map((version) => [version.title, version.who, version.viaCms]), [
      ["Fix the tagline by hand", "Other", false],
      ["cms: publish Salon info", "Olivia", true],
      ["initial", "Init", false],
    ], "the unrelated commit is not listed; the CMS commit names the person");
    assert.equal(history.body.versions[1].commit, first);
    // M12: 10 by default (?limit=1..25); contents=1 adds each version's value and the live one.
    const withContents = (await h.call("GET", "/history?resource=file%3Asite&limit=2&contents=1")).body;
    assert.deepEqual([withContents.versions.length, withContents.versions[1].content.tagline, withContents.live.tagline], [2, "First change", "Edited in the code"]);
    assert.equal(history.body.live, undefined, "no contents unless asked");
    // M12 (Mr Spa's top bar): editors see the history and restore as their own draft…
    assert.deepEqual([(await h.call("GET", "/history?resource=file%3Asite", { as: "editor" })).status, (await h.call("POST", "/history/restore", { as: "editor", body: { resource: "file:site", commit: first } })).status], [200, 200]);
    assert.equal((await h.drafts.get("usr_editor", "file:site")).content.tagline, "First change");
    // …but not of an admin-only file.
    h.setConfig({ ...config, files: config.files.map((file, index) => (index === 0 ? { ...file, access: "admin" } : file)) });
    assert.deepEqual([(await h.call("GET", "/history?resource=file%3Asite", { as: "editor" })).body.error, (await h.call("POST", "/history/restore", { as: "editor", body: { resource: "file:site", commit: first, replace: true } })).body.error], ["owner_only", "owner_only"]);
    h.setConfig(config);
    assert.equal((await h.call("GET", "/history")).status, 400);
    assert.equal((await h.call("GET", "/history/version?resource=file%3Asite&commit=nothex")).status, 400);
  } finally { await h.close(); }
});

test("history of one record in a shared JSON list: only the commits that changed THAT record", async () => {
  const h = await harness();
  try {
    const [classic, spa] = services;
    await h.publishChange(`/collections/services/items/${spa.id}`, `item:services:${spa.id}`, { ...spa, name: "Spa Pedicure Deluxe" });
    await h.publishChange(`/collections/services/items/${classic.id}`, `item:services:${classic.id}`, { ...classic, name: "Classic Manicure Plus" });
    const history = (await h.call("GET", `/history?resource=${encodeURIComponent(`item:services:${spa.id}`)}`)).body;
    assert.deepEqual(history.versions.map((version) => version.title), ["cms: publish Spa Pedicure Deluxe", "initial"], "the other record's publish is not in this record's history");
    const version = (await h.call("GET", `/history/version?resource=${encodeURIComponent(`item:services:${spa.id}`)}&commit=${history.versions[1].commit}`)).body;
    assert.deepEqual([version.content, version.sameAsLive], [spa, false]);
    assert.equal((await h.call("GET", `/history/version?resource=${encodeURIComponent(`item:services:${spa.id}`)}&commit=${history.versions[0].commit}`)).body.sameAsLive, true);
  } finally { await h.close(); }
});

test("restore as draft → review → publish puts the old version back; refusals say why", async () => {
  const h = await harness();
  try {
    await h.publishChange("/files/site", "file:site", { ...site, tagline: "A new tagline" });
    const versions = (await h.call("GET", "/history?resource=file%3Asite")).body.versions;
    const initial = versions.at(-1).commit;
    assert.deepEqual((await h.call("POST", "/history/restore", { body: { resource: "file:site", commit: versions[0].commit } })).body.error, "same_as_live");

    const restored = await h.call("POST", "/history/restore", { body: { resource: "file:site", commit: initial } });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual([restored.body.draft.content.tagline, restored.body.draft.stale], [site.tagline, false], "the draft holds the old content, based on what is live now");
    const again = await h.call("POST", "/history/restore", { body: { resource: "file:site", commit: initial } });
    assert.deepEqual([again.status, again.body.error, again.body.needsConfirmation], [409, "draft_exists", true]);
    assert.equal((await h.call("POST", "/history/restore", { body: { resource: "file:site", commit: initial, replace: true } })).status, 200);

    const published = await h.call("POST", "/publish", { body: { resources: ["file:site"] } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(h.github.files()["src/data/site.json"], files["src/data/site.json"], "the file is back exactly as it was (same bytes)");

    // A version the current config no longer accepts is refused with the reason.
    h.redeploy();
    const strict = { ...config, files: [{ ...config.files[0], fields: { ...config.files[0].fields, tagline: { ...config.files[0].fields.tagline, maxLength: 5 } } }] };
    await h.publishChange("/files/site", "file:site", { ...site, tagline: "Short" });
    h.setConfig(strict);
    const refused = await h.call("POST", "/history/restore", { body: { resource: "file:site", commit: initial } });
    assert.deepEqual([refused.status, refused.body.error, refused.body.errors[0].path], [422, "invalid_content", "tagline"]);
    assert.match(refused.body.message, /no longer fits the site's fields/);

    // A record that did not exist in a version.
    h.setConfig(config);
    const fresh = { id: "gel-polish", name: "Gel Polish", price: "$30", category: "Nails" };
    await h.publishChange("/collections/services/items/gel-polish", "item:services:gel-polish", fresh);
    const missing = await h.call("POST", "/history/restore", { body: { resource: "item:services:gel-polish", commit: initial } });
    assert.deepEqual([missing.status, missing.body.error], [404, "not_in_version"]);
  } finally { await h.close(); }
});

test("M12 admin: Version history is a dialog over the editor (Mr Spa) — what restoring changes, Restore as draft, asks only over a draft", async () => {
  const h = await harness();
  try {
    await h.publishChange("/files/site", "file:site", { ...site, tagline: "A new tagline" });
    const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
    const root = window.document.createElement("div");
    window.document.body.append(root);
    const fetch = async (url, init = {}) => {
      const target = new URL(url, "http://localhost");
      const result = await h.call(init.method ?? "GET", target.pathname.replace(/^\/api\/cms/, "") + target.search, { as: "editor", body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
    };
    const asked = [];
    let answer = false;
    const app = startAdmin({ root, boot: adminBoot(config, { id: "usr_editor", username: "eddie", displayName: "Eddie", role: "editor" }), fetch, window, confirm: (message) => { asked.push(message); return answer; }, storage: null });
    await app.ready;
    const wait = async (test, what) => { for (let i = 0; i < 200; i += 1) { if (test()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };
    const go = async (path) => { await app.go(path); await new Promise((resolve) => setTimeout(resolve, 0)); await app.idle(); };
    await go("/admin/pages/site");
    const button = root.querySelector('[data-action="history"]');
    assert.deepEqual([button.tagName, button.getAttribute("aria-label"), button.dataset.tooltip], ["BUTTON", "View version history", "Version history"], "an editor has it too");
    button.click();
    const dialog = window.document.querySelector(".vc-dialog.vc-history-dialog");
    assert.equal(dialog.querySelector(".vc-dialog-title").textContent, "Version history");
    assert.equal(dialog.querySelector(".vc-dialog-text").textContent, "Published versions for this resource. Choosing Restore creates a draft only.");
    await wait(() => /^[0-9]+ published version/.test(dialog.querySelector(".vc-history-status").textContent), "the versions");
    assert.equal(dialog.querySelector(".vc-history-status").textContent, "2 published versions.");
    const entries = [...dialog.querySelectorAll(".vc-history-entry")];
    assert.match(entries[0].querySelector(".vc-history-entry-head").textContent, /by Olivia$/);
    assert.equal(entries[0].querySelector("p").textContent, "Nothing is different from what the website shows now.");
    assert.equal(entries[1].querySelector("p").textContent, "Changed: Tagline");
    assert.equal(entries[1].querySelector("code").textContent.length, 8);
    assert.deepEqual([...dialog.querySelectorAll(".vc-dialog-actions button")].map((element) => element.textContent), ["Close"]);
    const restore = () => [...entries[1].querySelectorAll("button")].find((element) => element.textContent === "Restore as draft").click();
    restore();
    await wait(() => !window.document.querySelector(".vc-history-dialog"), "the dialog to close");
    await app.idle();
    assert.equal(window.location.pathname, "/admin/pages/site");
    assert.equal((await h.drafts.get("usr_editor", "file:site")).content.tagline, site.tagline, "the old version is my draft");
    assert.equal(asked.length, 0, "no question without a draft");
    // Over a draft: "Replace current draft" — No keeps it ("Restore cancelled.").
    root.querySelector('[data-action="history"]').click();
    const again = window.document.querySelector(".vc-history-dialog");
    await wait(() => again.querySelectorAll(".vc-history-entry").length === 2, "the versions again");
    [...again.querySelectorAll(".vc-history-entry")[1].querySelectorAll("button")].find((element) => element.textContent === "Restore as draft").click();
    await wait(() => again.querySelector(".vc-history-status").textContent === "Restore cancelled.", "the cancel");
    assert.equal(asked.at(-1), "Replace current draft\n\nThis resource already has a draft. Replace it with this historical version?");
    again.querySelector('.vc-dialog-actions [data-value="close"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(window.document.querySelectorAll(".vc-history-dialog").length, 0, "closed");
    // The History address of before opens the editor with the dialog.
    await go("/admin/history/file%3Asite");
    assert.equal(window.location.pathname, "/admin/pages/site");
    assert.ok(window.document.querySelector(".vc-history-dialog"));
  } finally { await h.close(); }
});
