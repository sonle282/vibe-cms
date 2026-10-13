// P12b: generic options a real site needs — fixed lists (nobody adds / removes / moves items), fixed collections (no new
// record), owner-only files / collections (editors do not see them; 403 + audit), and the Activity screen (owners read
// the audit log in pages). On the demo site's config with these options turned on in the test only (the demo stays as it
// is), through the REAL API (memory stores, fake GitHub) and the admin on a fake DOM (happy-dom).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f, loadCmsConfig } from "../dist/index.js";
import { checkFixedLists } from "../dist/check/structure.js";
import { adminBoot, createForm, startAdmin } from "../dist/admin/index.js";
import { describeActivity } from "../dist/admin/activity.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let demo; let config; let files; let site;
before(async () => {
  demo = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(demo, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
  site = JSON.parse(files["src/data/site.json"]);
  // The test's site: footer link GROUPS are fixed (the links inside them are not), the services are a fixed set, the team is owner-only.
  const siteFile = demo.files[0];
  const footer = siteFile.fields.footerLinks;
  config = {
    ...demo,
    files: [{ ...siteFile, fields: { ...siteFile.fields, footerLinks: { ...footer, fixed: true, max: undefined } } }],
    collections: demo.collections.map((collection) => (collection.key === "services" ? { ...collection, fixed: true } : collection.key === "team" ? { ...collection, access: "admin" } : collection)),
  };
  delete config.files[0].fields.footerLinks.max;
});

const users = { owner: { userId: "usr_owner", role: "owner" }, editor: { userId: "usr_editor", role: "editor" } };
const harness = async () => {
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files });
  const drafts = createMemoryDraftStore(); const audit = createMemoryAuditLog();
  const publisher = createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url });
  const build = (withConfig = config) => createCmsApi({
    config: withConfig, source: createBundledSource(files), drafts, audit, publisher,
    identify: (request) => users[request.headers.get("x-as") ?? "owner"],
    userNames: async () => [{ id: "usr_owner", username: "olivia", displayName: "Olivia" }, { id: "usr_editor", username: "eddie", displayName: "Eddie" }],
  });
  let api = build();
  const call = async (method, path, { as = "owner", body } = {}) => {
    const response = await api.handle(new Request(`http://localhost/api/cms${path}`, { method, headers: { "x-as": as, origin: "http://localhost", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  const version = async (path, as = "owner") => (await call("GET", path, { as })).body.version;
  return { github, drafts, audit, call, version, rebuild: (withConfig) => { api = build(withConfig); }, close: () => github.close() };
};

// ------------------------------------------------------------------ config

test("config: fixed (list, collection) and access (file, collection) are checked", () => {
  const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
  const file = (extra, fields = { items: f.list(f.text({ label: "Item" }), { label: "Items", fixed: true }) }) => ({ ...base, files: [{ key: "site", label: "Site", path: "src/data/site.json", format: "json", fields, ...extra }] });
  assert.deepEqual(checkCmsConfig(file({ access: "admin" })).errors, []);
  assert.match(checkCmsConfig(file({ access: "editor" })).errors[0].message, /only "admin" is allowed/);
  // M2: "owner" is the old name — it works, with one warning that names the place.
  const old = checkCmsConfig(file({ access: "owner" }));
  assert.deepEqual([old.errors, old.warnings.map((warning) => `${warning.path}: ${warning.message}`)], [[], ['files[0].access: "owner" is the old name of "admin" (1 place: files[0].access)']]);
  assert.match(checkCmsConfig(file({}, { items: f.list(f.text({ label: "Item" }), { label: "Items", fixed: "yes" }) })).errors[0].message, /must be true or false/);
  assert.match(checkCmsConfig(file({}, { items: f.list(f.text({ label: "Item" }), { label: "Items", fixed: true, max: 3 }) })).warnings[0].message, /min \/ max have no effect/);
  const collection = (extra) => ({ ...base, files: [], collections: [{ key: "menu", label: "Menu", itemLabel: "Dish", store: { kind: "json-array", path: "src/data/menu.json", idField: "id" }, fields: { name: f.text({ label: "Name" }) }, ...extra }] });
  assert.deepEqual(checkCmsConfig(collection({ fixed: true, access: "admin" })).errors, []);
  assert.match(checkCmsConfig(collection({ fixed: 1 })).errors[0].path, /collections\[0\]\.fixed/);
});

// ------------------------------------------------------------------ fixed lists (pure)

test("checkFixedLists: same items in the same place; values may change; lists inside items are free unless fixed", () => {
  const fields = { groups: f.list(f.object({ label: "Group", fields: { id: f.text({ label: "Id" }), title: f.text({ label: "Title" }), items: f.list(f.text({ label: "Item" }), { label: "Items" }) } }), { label: "Groups", fixed: true }) };
  const before = { groups: [{ id: "a", title: "A", items: ["x"] }, { id: "b", title: "B", items: [] }] };
  const edit = (change) => { const after = structuredClone(before); change(after); return checkFixedLists(fields, before, after); };
  assert.deepEqual(edit((after) => { after.groups[0].title = "A2"; after.groups[1].items.push("y", "z"); after.groups[0].items = []; }), [], "values and inner (not fixed) lists may change");
  assert.match(edit((after) => after.groups.push({ id: "c", title: "C", items: [] }))[0].message, /fixed set of 2 group — it cannot be added to/);
  assert.match(edit((after) => after.groups.pop())[0].message, /cannot be made shorter/);
  const moved = edit((after) => after.groups.reverse());
  assert.deepEqual([moved[0].path, /cannot be moved or replaced/.test(moved[0].message)], ["groups[0]", true]);
  assert.equal(edit((after) => { after.groups[1].id = "z"; }).length, 1, "an item with another id in the same place = replaced");
  assert.deepEqual(checkFixedLists(fields, undefined, { groups: [] }), [], "a new record has nothing to keep");
  const nested = { menu: f.list(f.object({ label: "Section", fields: { id: f.text({ label: "Id" }), dishes: f.list(f.text({ label: "Dish" }), { label: "Dishes", fixed: true }) } }), { label: "Sections" }) };
  const menu = { menu: [{ id: "s1", dishes: ["a", "b"] }] };
  assert.match(checkFixedLists(nested, menu, { menu: [{ id: "s1", dishes: ["a"] }] })[0].path, /^menu\[0\]\.dishes$/, "a fixed list inside an item, paired by id");
  assert.deepEqual(checkFixedLists(nested, menu, { menu: [{ id: "s2", dishes: [] }, { id: "s1", dishes: ["a", "c"] }] }), [], "a new item's fixed list has nothing to keep; the moved one keeps its 2");
});

// ------------------------------------------------------------------ API

test("API: fixed list and fixed collection hold for the owner too, at save and again at publish", async () => {
  const h = await harness();
  try {
    const sourceVersion = await h.version("/files/site");
    const withGroup = { ...site, footerLinks: [...site.footerLinks, { title: "More", links: [] }] };
    const refused = await h.call("PUT", "/files/site", { body: { content: withGroup, expectedRevision: 0, sourceVersion } });
    assert.deepEqual([refused.status, refused.body.error, refused.body.errors[0].path], [422, "fixed_list", "footerLinks"]);
    assert.match(refused.body.message, /Footer links has a fixed set of 1 group/);
    const moreLinks = structuredClone(site); moreLinks.footerLinks[0].links.push({ label: "Blog", href: "/blog/" }); moreLinks.footerLinks[0].title = "Visit us";
    assert.equal((await h.call("PUT", "/files/site", { body: { content: moreLinks, expectedRevision: 0, sourceVersion } })).status, 200, "links inside a group are not fixed; titles change");

    const service = { id: "gel-polish", name: "Gel polish", price: "$30", category: "Nails" };
    const newOne = await h.call("PUT", "/collections/services/items/gel-polish", { body: { content: service, expectedRevision: 0, sourceVersion: "new" } });
    assert.deepEqual([newOne.status, newOne.body.error], [422, "fixed_collection"]);
    assert.match(newOne.body.message, /Services has a fixed set of records — a new service cannot be added/);
    const first = JSON.parse(files["src/data/services.json"])[0];
    assert.equal((await h.call("PUT", `/collections/services/items/${first.id}`, { body: { content: { ...first, name: "Renamed" }, expectedRevision: 0, sourceVersion: await h.version(`/collections/services/items/${first.id}`) } })).status, 200);

    // A draft saved before the site made the list fixed is refused at publish (the branch decides) and audited as failed.
    const headBefore = h.github.head();
    h.rebuild(demo);
    const old = (await h.call("GET", "/files/site")).body.draft;
    assert.equal((await h.call("PUT", "/files/site", { body: { content: withGroup, expectedRevision: old.revision } })).status, 200, "the demo's config has no fixed list");
    h.rebuild(config);
    const published = await h.call("POST", "/publish", { body: { resources: ["file:site"] } });
    assert.deepEqual([published.status, published.body.error, published.body.resource], [422, "fixed_list", "file:site"]);
    assert.deepEqual(h.audit.entries.slice(-2).map((row) => [row.action, row.detail.code ?? null]), [["started", null], ["failed", "fixed_list"]]);
    assert.equal(h.github.head(), headBefore, "nothing was committed");
  } finally { h.close(); }
});

test("API: owner-only collection — editors do not see it and get 403 owner_only (save / publish audited); owners work as usual", async () => {
  const h = await harness();
  try {
    const content = (await h.call("GET", "/content", { as: "editor" })).body;
    assert.deepEqual(content.collections.map((entry) => entry.key), ["services", "posts"], "not in the editor's overview");
    assert.deepEqual((await h.call("GET", "/content")).body.collections.map((entry) => entry.key), ["services", "team", "posts"]);
    const member = JSON.parse(files["src/data/team.json"])[0];
    for (const [method, path] of [["GET", "/collections/team"], ["GET", `/collections/team/items/${member.id}`], ["DELETE", `/collections/team/items/${member.id}`]]) {
      const answer = await h.call(method, path, { as: "editor" });
      assert.deepEqual([answer.status, answer.body.error], [403, "owner_only"], `${method} ${path}`);
    }
    const before = h.audit.entries.length;
    const save = await h.call("PUT", `/collections/team/items/${member.id}`, { as: "editor", body: { content: { ...member, name: "X" }, expectedRevision: 0, sourceVersion: "new" } });
    assert.deepEqual([save.status, save.body.error, save.body.message], [403, "owner_only", "Only an admin can open or change Team."]);
    assert.deepEqual(h.audit.entries.slice(before).map((row) => [row.action, row.stage, row.resource, row.detail.reason]), [["denied", "draft", `item:team:${member.id}`, "owner_only"]]);
    const ownerVersion = await h.version(`/collections/team/items/${member.id}`);
    assert.equal((await h.call("PUT", `/collections/team/items/${member.id}`, { body: { content: { ...member, name: "Owner edit" }, expectedRevision: 0, sourceVersion: ownerVersion } })).status, 200);
    // An editor who somehow has a draft of it (an owner turned editor) cannot publish it, and it is not in their list.
    await h.drafts.save({ userId: "usr_editor", resource: `item:team:${member.id}`, label: "x", content: { ...member, name: "Y" }, sourceVersion: ownerVersion, expectedRevision: 0 });
    assert.deepEqual((await h.call("GET", "/drafts", { as: "editor" })).body.drafts, []);
    const publish = await h.call("POST", "/publish", { as: "editor", body: { resources: [`item:team:${member.id}`] } });
    assert.deepEqual([publish.status, publish.body.error], [403, "owner_only"]);
    assert.deepEqual(h.audit.entries.at(-1).stage, "publish");
    assert.ok(!h.audit.entries.some((row) => row.action === "started" && row.userId === "usr_editor"), "refused before anything started");
    const boot = adminBoot(config, { id: "usr_editor", username: "eddie", displayName: "Eddie", role: "editor" });
    assert.deepEqual(boot.collections.map((entry) => [entry.key, entry.fixed ?? false]), [["services", true], ["posts", false]], "editor boot: no team; services fixed");
  } finally { h.close(); }
});

test("API: /activity — owners only, plain filters, 50 a page with `before`, names and resource labels", async () => {
  const h = await harness();
  try {
    assert.deepEqual([(await h.call("GET", "/activity", { as: "editor" })).status], [403]);
    const at = "2026-10-12T08:00:00.000Z";
    await h.audit.record({ at, userId: "usr_owner", role: "owner", action: "login", stage: "auth", resource: "auth", detail: {} });
    await h.audit.record({ at, userId: "usr_owner", role: "owner", action: "started", stage: "publish", resource: "file:site", detail: { publishId: "p" } });
    await h.audit.record({ at, userId: "usr_owner", role: "owner", action: "succeeded", stage: "publish", resource: "file:site", detail: { publishId: "p", commitSha: "abcdef1234567" } });
    await h.audit.record({ at, userId: "usr_editor", role: "editor", action: "denied", stage: "draft", resource: "item:services:spa-pedicure", detail: { reason: "locked_field", fields: [{ path: "price", field: "Price", reason: "changed" }] } });
    await h.audit.record({ at, userId: "usr_owner", role: "owner", action: "user_role_change", stage: "people", resource: "user:usr_editor", detail: { from: "owner", to: "editor" } });
    await h.audit.record({ at, userId: "anonymous", role: "anonymous", action: "login_failed", stage: "auth", resource: "auth", detail: { reason: "unknown_user" } });
    const all = (await h.call("GET", "/activity")).body;
    assert.deepEqual(all.entries.map((row) => [row.action, row.who, row.what]), [
      ["login_failed", null, "auth"], ["user_role_change", "Olivia", "Eddie"], ["denied", "Eddie", "Service · spa-pedicure"], ["succeeded", "Olivia", "Salon info"], ["login", "Olivia", "auth"],
    ], "newest first, no 'started' rows, names and labels");
    assert.equal(all.next, null);
    const words = all.entries.map((row) => describeActivity(row).text);
    assert.deepEqual(words, ["Failed sign-in (unknown username)", "Changed the role of Eddie to editor", "Refused to save Service · spa-pedicure: Price is for admins only", "Published Salon info (abcdef1)", "Signed in"]);
    assert.deepEqual((await h.call("GET", "/activity?kind=publish")).body.entries.map((row) => row.action), ["succeeded"]);
    assert.deepEqual((await h.call("GET", "/activity?kind=denied")).body.entries.map((row) => row.action), ["login_failed", "denied"]);
    assert.deepEqual((await h.call("GET", "/activity?kind=people")).body.entries.map((row) => row.action), ["user_role_change"]);
    assert.equal((await h.call("GET", "/activity?kind=nope")).status, 400);
    assert.equal((await h.call("GET", "/activity?before=-1")).status, 400);
    for (let index = 0; index < 60; index += 1) await h.audit.record({ at, userId: "usr_owner", role: "owner", action: "login", stage: "auth", resource: "auth", detail: {} });
    const page1 = (await h.call("GET", "/activity?kind=signin")).body;
    assert.equal(page1.entries.length, 50);
    const page2 = (await h.call("GET", `/activity?kind=signin&before=${page1.next}`)).body;
    assert.deepEqual([page2.entries.length, page2.next], [12, null], "62 sign-in rows (61 sign-ins + 1 failed): 50 + 12");
    assert.ok(page2.entries.every((row) => row.id < page1.next));
  } finally { h.close(); }
});

// ------------------------------------------------------------------ admin (fake DOM)

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const shell = async (role) => {
  const h = await harness();
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const fetch = async (url, init = {}) => apiFetch(h, new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost", "x-as": role } }));
  const boot = adminBoot(config, { id: users[role].userId, username: role, displayName: role === "owner" ? "Olivia" : "Eddie", role });
  const app = startAdmin({ root, boot, fetch, window, confirm: () => true, storage: null });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  return { h, window, root, app, go };
};
/** The admin's fetch goes to the same API the harness uses (role from the x-as header). */
const apiFetch = async (h, request) => {
  const url = new URL(request.url);
  const result = await h.call(request.method, url.pathname.replace(/^\/api\/cms/, "") + url.search, { as: request.headers.get("x-as"), body: request.body ? JSON.parse(await request.text()) : undefined });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
};

test("admin: a fixed list has no add / remove / move buttons and no count (Mr Spa); values stay editable", () => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const form = createForm({ doc: window.document, fields: config.files[0].fields, sections: config.files[0].sections, value: site, role: "owner", references: {} });
  const footer = form.element.querySelector('[data-path="footerLinks"]');
  const labels = [...footer.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent.trim());
  assert.ok(!labels.some((label) => /^(Add group|Delete Group|Move Group)/.test(label)), `no group controls: ${labels.join(" | ")}`);
  assert.ok(labels.some((label) => /Add link/i.test(label)), "the links inside a group can still be added");
  assert.equal(footer.querySelector(".vc-list-count").hidden, true, "a fixed set has no count");
  assert.ok(form.element.querySelector('[data-path="footerLinks[0].title"] input'), "the group's title is editable");
});

test("admin: editor — no owner-only section, no Activity; fixed collection has no Add; owner sees Activity in plain words", async () => {
  const editor = await shell("editor");
  try {
    const nav = [...editor.root.querySelectorAll(".vc-rail a.vc-rail-item")].map((link) => link.textContent.trim());
    assert.ok(!nav.includes("Team") && !nav.includes("Activity") && !nav.includes("Users"), nav.join(", "));
    await editor.go("/admin/catalog/services");
    assert.ok(![...editor.root.querySelectorAll(".vc-actions a")].some((link) => /^Add /.test(link.textContent)), "no Add for a fixed collection");
    await editor.go("/admin/catalog/services/new");
    assert.match(editor.root.textContent, /Services is a fixed set/);
    await editor.go("/admin/audit");
    assert.match(editor.root.textContent, /Only an admin can see the activity log/);
  } finally { editor.h.close(); }

  const owner = await shell("owner");
  try {
    await owner.h.audit.record({ at: "2026-10-12T08:00:00.000Z", userId: "usr_editor", role: "editor", action: "denied", stage: "publish", resource: "item:team:sam", detail: { reason: "owner_only" } });
    // U4: Activity is the second tab of People (Mr Spa 19 / 20).
    assert.ok([...owner.root.querySelectorAll(".vc-rail a.vc-rail-item")].some((link) => link.textContent.trim() === "Users"));
    await owner.go("/admin/audit");
    const rows = [...owner.root.querySelectorAll(".vc-activity tbody tr")].map((row) => [...row.querySelectorAll("td")].slice(1).map((cell) => cell.textContent.trim()));
    assert.deepEqual(rows, [["Eddie Editor", "Refused to publish Team member · sam: only admins can change it", "—", "Failed"]]);
    assert.equal(owner.root.querySelector('.vc-tabs [aria-current="page"]').textContent, "Activity");
    assert.equal(owner.root.querySelector('.vc-filters [aria-current="page"]').textContent, "All");
    await owner.go("/admin/audit/publish");
    assert.match(owner.root.textContent, /Nothing of this kind yet/);
    assert.equal(owner.root.querySelector('.vc-rail a[aria-current="page"]').textContent, "Users");
  } finally { owner.h.close(); }
});

test("D1 audit log: pages with `before`, filters by stage and action (real SQL on node:sqlite with the package migrations)", async () => {
  const { createSqliteD1 } = await import("./helpers/sqlite-d1.mjs");
  const { createD1AuditLog } = await import("../dist/index.js");
  const audit = createD1AuditLog(createSqliteD1());
  const at = "2026-10-12T08:00:00.000Z";
  for (const [action, stage] of [["login", "auth"], ["started", "publish"], ["succeeded", "publish"], ["denied", "draft"], ["login", "auth"], ["user_create", "people"]]) await audit.record({ at, userId: "usr_owner", role: "owner", action, stage, resource: "x", detail: {} });
  assert.deepEqual((await audit.list()).map((row) => row.id), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual((await audit.list({ before: 5, limit: 2 })).map((row) => row.id), [4, 3]);
  assert.deepEqual((await audit.list({ stages: ["auth"] })).map((row) => row.id), [5, 1]);
  assert.deepEqual((await audit.list({ actions: ["succeeded", "denied"] })).map((row) => row.action), ["denied", "succeeded"]);
  assert.deepEqual((await audit.list({ stages: ["publish"], actions: ["succeeded", "failed"], before: 10 })).map((row) => row.id), [3]);
});
