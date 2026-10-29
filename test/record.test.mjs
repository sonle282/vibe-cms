// M9: the Mr Spa CMS's record editor (`layout: "record"`) on a fake DOM (happy-dom) through the REAL CMS API —
// the sections on the left, the form in cards ("* Required before you can publish"), and on the right "On the
// website" (pill, address, what it means now), "Ready to publish" / "Before you publish · N to do", Duplicate, Hide
// from website / Show on website again (one commit of the status, with a fake GitHub on 127.0.0.1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminBoot, startAdmin } from "../dist/admin/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (check, what) => { for (let i = 0; i < 300; i += 1) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };
/** Posts in the record editor too (for Hide / Show: they have a status with "archived"). */
const withRecordPosts = (settings) => ({ ...settings, collections: settings.collections.map((collection) => (collection.key === "posts" ? { ...collection, layout: "record", list: { ...collection.list, duplicate: true } } : collection)) });

const shell = async ({ settings = config, github, confirm = () => true } = {}) => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const drafts = createMemoryDraftStore();
  const user = { userId: "usr_owner", role: "owner" };
  const publisher = github ? createGitHubPublisher({ token: github.token, repo: settings.repo, apiUrl: github.url }) : undefined;
  const api = createCmsApi({ config: settings, source: createBundledSource(files), drafts, audit: createMemoryAuditLog(), identify: () => user, publisher });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const call = async (method, path, body) => (await fetch(`/api/cms${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const asked = [];
  const app = startAdmin({ root, boot: adminBoot(settings, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, storage: null, confirm: (message, choice) => { asked.push([message, choice]); return confirm(message); } });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  const side = () => root.querySelector(".vc-record-side");
  const ready = () => [...side().querySelectorAll(".vc-publish-check")].map((button) => [button.childNodes[1].textContent, button.hasAttribute("data-done")]);
  const type = (path, value) => { const input = root.querySelector(`[data-path="${path}"] input`); input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };
  return { window, root, drafts, call, go, app, side, ready, type, asked, toast: () => root.querySelector(".vc-toast")?.textContent ?? "" };
};

test("M9 config: layout / sections / ready are checked, with what to write instead", () => {
  const team = config.collections.find((collection) => collection.key === "team");
  const problems = (change) => checkCmsConfig({ ...config, collections: config.collections.map((collection) => (collection.key === "team" ? { ...team, ...change } : collection)) }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems({ ready: [{ field: "name", label: "Name" }, { field: "photo" }] }), []);
  assert.deepEqual(problems({ layout: "grid" }), ['collections[1].layout: "grid" is not a layout of a collection']);
  assert.deepEqual(problems({ layout: "page", preview: undefined }), ['collections[1].layout: "page" shows the record\'s page, so it needs a preview']);
  assert.deepEqual(problems({ ready: [{ field: "sku" }] }), ['collections[1].ready[0].field: "sku" is not a field of this collection']);
  assert.match(problems({ sections: [{ key: "a", label: "A", fields: ["nope"] }] }).join(), /collections\[1\]\.sections\[0\]\.fields\[0\]/);
});

test("M9 record editor (Mr Spa): sections on the left, cards, no ID / Status box; On the website + Ready to publish follow every change", async () => {
  const h = await shell();
  await h.go("/admin/catalog/team/alex");
  // No page on the canvas: the record editor.
  assert.equal(h.root.querySelector(".vc-preview"), null);
  const toc = [...h.root.querySelectorAll(".vc-record-toc-link")];
  assert.deepEqual(toc.map((button) => [button.textContent, button.getAttribute("aria-current")]), [["Basics", "true"], ["Photo", null], ["About", null]]);
  assert.equal(h.root.querySelector(".vc-record-toc").getAttribute("aria-label"), "Team member sections");
  assert.deepEqual([...h.root.querySelectorAll(".vc-record-form .vc-section-title")].map((node) => node.textContent), ["Basics", "Photo", "About"]);
  assert.equal(h.root.querySelector(".vc-record-required").textContent, "* Required before you can publish");
  assert.equal(h.root.querySelector('[data-path="id"]'), null, "no ID box");
  // A click on a section goes to its card.
  toc[2].click();
  assert.equal(toc[2].getAttribute("aria-current"), "true");
  assert.equal(h.window.document.activeElement, h.root.querySelector('.vc-section[data-section="about"]'));
  // On the website: Live, the address, "The website shows this version."
  const web = h.side().querySelector(".vc-record-side-card");
  assert.deepEqual([web.querySelector("h2").textContent, web.querySelector(".vc-content-status").textContent, web.querySelector(".vc-record-side-url").getAttribute("href"), web.querySelector(".vc-record-side-url").textContent, web.querySelector(".vc-record-side-note").textContent],
    ["On the website", "Live", "/team/", "demo.example/team", "The website shows this version."]);
  // Ready: the required name, then "No errors"; nothing to say under it while Publish has nothing to publish.
  assert.equal(h.side().querySelectorAll(".vc-record-side-card")[1].querySelector("h2").textContent, "Ready to publish");
  assert.deepEqual(h.ready(), [["Name", true], ["No errors", true]]);
  // An empty name: two to do, and the note says the website still shows the last version.
  h.type("name", "");
  assert.equal(h.side().querySelectorAll(".vc-record-side-card")[1].querySelector("h2").textContent, "Before you publish · 2 to do");
  assert.deepEqual(h.ready(), [["Name", false], ["No errors", false]]);
  assert.equal(web.querySelector(".vc-record-side-note").textContent, "You have unsaved changes. The website still shows the last published version.");
  // Clicking a to-do goes to its field.
  h.side().querySelector(".vc-publish-check").click();
  assert.equal(h.window.document.activeElement, h.root.querySelector('[data-path="name"] input'));
  // Everything done but not saved: Publish can go (it saves first).
  h.type("name", "Alex Again");
  assert.equal(h.side().querySelectorAll(".vc-record-side-card")[1].querySelector("h2").textContent, "Ready to publish");
  assert.equal(h.side().querySelector(".vc-record-ready-list + .vc-record-side-note").hidden, true, "F4: Publish saves them first: nothing to say");
  // Saved: a saved draft.
  [...h.root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  await until(() => web.querySelector(".vc-record-side-note").textContent.startsWith("You have a saved draft"), "the saved draft");
  assert.equal(web.querySelector(".vc-record-side-note").textContent, "You have a saved draft. The website still shows the last published version.");
  assert.equal(h.side().querySelector(".vc-record-ready-list + .vc-record-side-note").hidden, true, "Publish can go: nothing to say");
  // Team has no status and no Duplicate: no actions.
  assert.equal(h.side().querySelectorAll(".vc-record-side-action").length, 0);
});

test("M9 a new record (Mr Spa): Draft · “Not on the website yet. Publish adds it.”; the id comes from the name", async () => {
  const h = await shell();
  await h.go("/admin/catalog/team/new");
  const web = h.side().querySelector(".vc-record-side-card");
  assert.deepEqual([web.querySelector(".vc-content-status").textContent, web.querySelector(".vc-content-status").className, web.querySelector(".vc-record-side-url").hidden, web.querySelector(".vc-record-side-note").textContent],
    ["Draft", "vc-content-status is-draft", true, "Not on the website yet. Publish adds it."]);
  h.type("name", "Robin Example");
  [...h.root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  await until(() => h.window.location.pathname === "/admin/catalog/team/robin-example", "the new record's address");
  assert.equal((await h.drafts.get("usr_owner", "item:team:robin-example")).content.id, "robin-example");
});

test("M9 Hide from website / Show on website again (Mr Spa): asks, one commit of the status, my draft follows; Duplicate <item>", async () => {
  const settings = withRecordPosts(config);
  const github = await startFakeGitHub({ owner: settings.repo.owner, name: settings.repo.name, branch: settings.repo.branch, files });
  try {
    const start = github.head();
    let answer = false;
    const h = await shell({ settings, github, confirm: () => answer });
    // A saved draft of the post first: it must follow the change.
    const welcome = await h.call("GET", "/collections/posts/items/welcome");
    await h.call("PUT", "/collections/posts/items/welcome", { content: { ...welcome.content, title: "Welcome!" }, expectedRevision: 0, sourceVersion: welcome.version });
    await h.go("/admin/catalog/posts/welcome");
    const actions = () => [...h.side().querySelectorAll(".vc-record-side-actions > *")].filter((node) => !node.hidden).map((node) => node.textContent);
    assert.deepEqual(actions(), ["Duplicate post", "Hide from website", "Hiding keeps the post in the CMS as Archived. You can show it again any time."]);
    assert.equal(h.root.querySelector('[data-path="status"]'), null, "no Status box: Publish and Hide set it");
    const hide = () => [...h.side().querySelectorAll(".vc-record-side-action")].find((button) => /website/.test(button.textContent));
    hide().click();
    await settle();
    assert.deepEqual(h.asked.at(-1), ["Hide from website\n\nHide this post from the public website? It is kept in the CMS as Archived and can be shown again later.", { confirm: "Hide from website" }]);
    assert.deepEqual(github.commitsSince(start), [], "no: nothing changes");
    answer = true;
    hide().click();
    await until(() => /hidden from the website/.test(h.toast()), "the hide");
    assert.equal(h.toast(), "Post hidden from the website (Archived)");
    const last = github.commit();
    assert.equal(github.commitsSince(start).length, 1);
    assert.deepEqual(github.changedPaths(start), ["src/content/posts/welcome.md"]);
    assert.match(last.message, /^cms: hide Welcome to the demo blog from the website/);
    assert.match(github.files()["src/content/posts/welcome.md"], /^status: archived$/m);
    assert.doesNotMatch(github.files()["src/content/posts/welcome.md"], /Welcome!/, "only the status: my draft is not published");
    const draft = await h.drafts.get("usr_owner", "item:posts:welcome");
    assert.deepEqual([draft.content.title, draft.content.status], ["Welcome!", "archived"], "my draft follows");
    await until(() => h.side()?.querySelector(".vc-content-status")?.textContent === "Archived", "the editor again");
    assert.equal(h.side().querySelector(".vc-record-side-note").textContent, "Hidden from the website. It is kept here; show it again any time.");
    assert.deepEqual(actions(), ["Duplicate post", "Show on website again"]);
    // Show again.
    hide().click();
    await until(() => /shown on the website again/.test(h.toast()), "the show");
    assert.match(github.files()["src/content/posts/welcome.md"], /^status: published$/m);
    // Publishing my draft keeps what the website shows (the draft followed), and is not stale.
    const published = await h.call("POST", "/publish", { resources: ["item:posts:welcome"] });
    assert.equal(published.commitSha?.length, 40, JSON.stringify(published));
    assert.match(github.files()["src/content/posts/welcome.md"], /^status: published$/m);
    // The API refuses what it cannot do.
    assert.equal((await h.call("POST", "/collections/team/items/alex/visibility", { action: "archive" })).error, "no_archived_status");
    assert.equal((await h.call("POST", "/collections/posts/items/welcome/visibility", { action: "delete" })).error, "bad_request");
  } finally { await github.close(); }
});
