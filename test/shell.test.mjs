// M1: the frame of the Mr Spa CMS — addresses by path, the one save state, the tooltip, the preview's devices, and
// collections shown as tabs of another (`under`); the shell on a fake DOM (happy-dom) against the REAL CMS API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminBoot, adminHref, applyLeafChanges, createTooltipScheduler, deriveSaveState, legacyHashPath, parseAdminPath, previewScale, publishBlockReason, startAdmin, tooltipText, unsavedLeafChanges } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("routes: every screen has its address, and the hash addresses of before still open it", () => {
  assert.deepEqual(parseAdminPath("/admin"), { kind: "home" });
  assert.deepEqual(parseAdminPath("/admin/"), { kind: "home" });
  assert.deepEqual(parseAdminPath("/admin/pages"), { kind: "pages" });
  assert.deepEqual(parseAdminPath("/admin/pages/home"), { kind: "file", key: "home" });
  assert.deepEqual(parseAdminPath("/admin/catalog/products"), { kind: "list", key: "products" });
  assert.deepEqual(parseAdminPath("/admin/catalog/products/new"), { kind: "new", key: "products" });
  assert.deepEqual(parseAdminPath("/admin/catalog/products/spax%20px"), { kind: "item", key: "products", id: "spax px" });
  assert.deepEqual(parseAdminPath("/admin/drafts/review/file%3Ahome"), { kind: "review", resource: "file:home" });
  assert.deepEqual(parseAdminPath("/admin/audit/publish"), { kind: "audit", filter: "publish" });
  assert.deepEqual(parseAdminPath("/admin/history/item%3Aservices%3Aa"), { kind: "history", resource: "item:services:a" });
  assert.deepEqual(parseAdminPath("/admin/nope/x/y"), { kind: "unknown" });
  assert.deepEqual(parseAdminPath("/elsewhere"), { kind: "unknown" });
  assert.equal(adminHref.item("services", "gel off"), "/admin/catalog/services/gel%20off");
  for (const [hash, path] of [["#/", "/admin/pages"], ["#/files/site", "/admin/pages/site"], ["#/collections/services", "/admin/catalog/services"], ["#/collections/services/new", "/admin/catalog/services/new"],
    ["#/collections/services/items/gel-off", "/admin/catalog/services/gel-off"], ["#/publish/file%3Asite", "/admin/drafts/review/file%3Asite"], ["#/people", "/admin/users"], ["#/activity/publish", "/admin/audit/publish"], ["#/account", "/admin/account"]]) {
    assert.equal(legacyHashPath(hash), path, hash);
  }
  assert.equal(legacyHashPath("#section"), undefined, "an anchor is not an address of before");
});

test("save state: the Mr Spa CMS's words, its short words, and when Save / Publish are on", () => {
  const base = { unsaved: 0, hasDraft: false, canSave: true, publishBlockReason: null, host: "demo.example" };
  const state = (extra) => { const result = deriveSaveState({ ...base, ...extra }); return [result.kind, result.label, result.shortLabel]; };
  assert.deepEqual(state({}), ["none", "No changes", "No changes"]);
  assert.deepEqual(state({ unsaved: 1 }), ["unsaved", "1 unsaved change", "1 unsaved"]);
  assert.deepEqual(state({ unsaved: 3 }), ["unsaved", "3 unsaved changes", "3 unsaved"]);
  assert.deepEqual(state({ unsaved: null }), ["unsaved", "Unsaved changes", "Unsaved"]);
  assert.deepEqual(state({ hasDraft: true }), ["saved", "Draft saved · not live yet", "Draft saved"]);
  assert.deepEqual(state({ hasDraft: true, recordLive: true }), ["saved", "Draft saved · changes not live yet", "Draft saved"]);
  assert.deepEqual(state({ published: "publishing" }), ["published", "Publishing… this usually takes a few minutes", "Publishing…"]);
  assert.deepEqual(state({ published: "live" }), ["published", "Live on demo.example", "Live"]);
  assert.deepEqual(state({ published: "waiting" }), ["published", "Still publishing — check again in a few minutes", "Still publishing"]);
  assert.deepEqual(state({ busy: "Saving draft…" }), ["busy", "Saving draft…", "Saving draft…"]);
  assert.deepEqual(state({ problem: "2 validation errors", unsaved: 1 }), ["problem", "2 validation errors", "Needs attention"]);
  // Save: only with changes, never while busy; a problem with changes keeps it on (try again).
  assert.equal(deriveSaveState({ ...base, unsaved: 1 }).saveEnabled, true);
  assert.equal(deriveSaveState({ ...base, unsaved: 1, canSave: false }).saveEnabled, false);
  assert.equal(deriveSaveState({ ...base, unsaved: 1, busy: "Saving draft…" }).saveEnabled, false);
  assert.equal(deriveSaveState({ ...base, unsaved: 1, problem: "x" }).saveEnabled, true);
  // Publish: a saved draft, nothing unsaved, no reason.
  assert.equal(deriveSaveState({ ...base, hasDraft: true }).publishEnabled, true);
  assert.equal(deriveSaveState({ ...base, hasDraft: true }).publishTooltip, "Review changes before publishing.");
  assert.deepEqual([deriveSaveState({ ...base, hasDraft: true, unsaved: 2 }).publishEnabled, deriveSaveState({ ...base, hasDraft: true, unsaved: 2 }).publishTooltip], [false, "Save a draft first"]);
  assert.equal(deriveSaveState({ ...base, hasDraft: true, publishBlockReason: "No changes to publish yet." }).publishTooltip, "No changes to publish yet.");
  // The reasons, in the Mr Spa CMS's order.
  const reason = (facts) => publishBlockReason({ conflict: false, dirty: false, hasDraft: true, invalid: false, changes: 1, ...facts });
  assert.equal(reason({ conflict: true, dirty: true }), "Someone else changed this content. Reload before publishing.");
  assert.equal(reason({ dirty: true, hasDraft: false }), "Save your changes before publishing.");
  assert.equal(reason({ hasDraft: false }), "Save a draft before publishing.");
  assert.equal(reason({ invalid: true }), "Fix the highlighted fields before publishing.");
  assert.equal(reason({ changes: 0 }), "No changes to publish yet.");
  assert.equal(reason({}), null);
  // "Reload and keep my changes": my leaf changes go back on a newer version; others' changes stay.
  const mine = unsavedLeafChanges({ a: 1, b: { c: "x", d: "y" }, list: [1] }, { a: 1, b: { c: "mine", d: "y" }, list: [1, 2] });
  assert.deepEqual(mine, [{ path: ["b", "c"], value: "mine" }, { path: ["list"], value: [1, 2] }]);
  assert.deepEqual(applyLeafChanges({ a: 2, b: { c: "x", d: "theirs" }, list: [1] }, mine), { a: 2, b: { c: "mine", d: "theirs" }, list: [1, 2] });
});

test("tooltip: 400 ms on hover, at once on focus; moving across controls shows nothing; a button's title moves into it", () => {
  const timers = new Map();
  let next = 1;
  const shown = [];
  const scheduler = createTooltipScheduler({ show: (target) => shown.push(target), hide: () => shown.push("hide"), timer: { set: (run, ms) => { timers.set(next, { run, ms }); return next++; }, clear: (id) => timers.delete(id) } });
  scheduler.enter("a");
  assert.deepEqual([...timers.values()].map((entry) => entry.ms), [400]);
  scheduler.enter("b");
  assert.equal(timers.size, 1, "the first is forgotten");
  scheduler.leave("b");
  assert.equal(timers.size, 0);
  assert.deepEqual(shown, []);
  scheduler.enter("c");
  [...timers.values()][0].run();
  assert.deepEqual(shown, ["c"]);
  scheduler.focus("d");
  assert.deepEqual(shown, ["c", "d"]);
  const { document } = new Window();
  const button = document.createElement("button");
  button.setAttribute("title", "Discard draft");
  assert.equal(tooltipText(button), "Discard draft");
  assert.equal(button.getAttribute("title"), null);
  assert.equal(button.getAttribute("aria-label"), "Discard draft", "its name stays for screen readers");
});

test("preview: Laptop 1280 × 800, Tablet 768 × 1024, Mobile 390 × 844, scaled down to fit the canvas (24 px padding), never up", () => {
  assert.equal(previewScale("laptop", { width: 1328, height: 900 }), 1);
  assert.equal(previewScale("laptop", { width: 688, height: 900 }), 0.5);
  assert.equal(previewScale("tablet", { width: 2000, height: 560 }), 0.5);
  assert.equal(previewScale("mobile", { width: 2000, height: 2000 }), 1);
});

test("config: `under` makes a collection a tab of another (one level deep)", () => {
  const with_ = (collections) => checkCmsConfig({ ...config, collections }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  const [services, team, posts] = config.collections;
  assert.deepEqual(with_([services, { ...team, under: "services" }, posts]), []);
  assert.deepEqual(with_([services, { ...team, under: "nothing" }, posts]), ['collections[1].under: "nothing" is not a collection of this config']);
  assert.deepEqual(with_([services, { ...team, under: "team" }, posts]), ["collections[1].under: a collection cannot be a tab of itself"]);
  assert.deepEqual(with_([{ ...services, under: "posts" }, { ...team, under: "services" }, posts]), ['collections[1].under: "services" is itself a tab of "posts"']);
});

const shell = async ({ collections } = {}) => {
  const window = new Window({ url: "http://localhost/admin", width: 1440, height: 900, settings: { disableIframePageLoading: true } });
  const document = window.document;
  const site = collections ? { ...config, collections: collections(config.collections) } : config;
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config: site, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const root = document.createElement("div");
  document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(site, { id: user.userId, username: "lan.showroom", displayName: "Lan", role: "owner" }), fetch, window, confirm: () => true });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  return { window, document, root, app, go, rail: () => [...root.querySelectorAll(".vc-rail a.vc-rail-item")].map((item) => [item.querySelector(".vc-rail-label").textContent, item.getAttribute("aria-current") === "page"]) };
};

test("shell: a collection `under` another is a tab there (Mr Spa: Products · Categories · Collections), not a place on the rail", async () => {
  const h = await shell({ collections: ([services, team, posts]) => [services, { ...team, under: "services" }, posts] });
  assert.deepEqual(h.rail().map(([label]) => label), ["Pages", "Services", "Blog", "Media", "Drafts", "Users"]);
  await h.go("/admin/catalog/team");
  const tabs = [...h.root.querySelectorAll(".vc-tabs .vc-tab")];
  assert.deepEqual(tabs.map((tab) => [tab.textContent, tab.getAttribute("href"), tab.getAttribute("aria-current")]), [["Services", "/admin/catalog/services", null], ["Team", "/admin/catalog/team", "page"]]);
  assert.equal(h.root.querySelector(".vc-crumbs").textContent, "Services/Team");
  assert.deepEqual(h.rail().find(([, on]) => on), ["Services", true], "the rail marks the head");
  await h.go("/admin/catalog/team/alex");
  assert.deepEqual(h.rail().find(([, on]) => on), ["Services", true]);
  assert.match(h.root.querySelector(".vc-crumbs").textContent, /^Services\/Team\//);
  // A link in the admin opens its screen without reloading the page.
  await h.go("/admin/catalog/team");
  h.root.querySelector('.vc-tabs a[href="/admin/catalog/services"]').click();
  await settle(); await h.app.idle();
  assert.equal(h.window.location.pathname, "/admin/catalog/services");
  assert.deepEqual(h.root.querySelector('.vc-tab[aria-current="page"]').textContent, "Services");
});

test("shell: the top bar of an editor — the save state, View live, Version history, Discard draft; ⋯ holds them on a narrow bar", async () => {
  const h = await shell();
  assert.equal(h.window.location.pathname, "/admin/pages/site");
  const top = h.root.querySelector(".vc-top");
  const icon = (name) => top.querySelector(`[data-action="${name}"]`);
  assert.equal(icon("view-live").getAttribute("href"), "/");
  assert.equal(icon("view-live").getAttribute("target"), "_blank");
  assert.equal(icon("history").dataset.tooltip, "Version history");
  assert.equal(icon("discard").hidden, true, "nothing to discard");
  assert.equal(icon("reload-keep").hidden, true);
  assert.equal(icon("check-again").hidden, true);
  assert.equal(top.querySelector(".vc-top-more-toggle").hidden, false, "⋯ is there (CSS shows it only on a narrow bar)");
  assert.deepEqual([...top.querySelectorAll(".vc-actions button")].map((button) => button.textContent), ["Save draft", "Publish"]);
  assert.equal(top.querySelector(".vc-save-state").dataset.kind, "none");
  assert.equal(top.querySelector(".vc-state-long").textContent, "No changes");
  // Unsaved edits only: Discard asks "Discard unsaved changes?" and shows the last saved version again.
  const input = h.root.querySelector('[data-path="tagline"] input');
  input.value = "Changed"; input.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(icon("discard").hidden, false);
  assert.equal(top.querySelector(".vc-state-short").textContent, "1 unsaved");
  icon("discard").click();
  await settle(); await settle(); await h.app.idle();
  assert.notEqual(h.root.querySelector('[data-path="tagline"] input').value, "Changed");
  assert.equal(h.root.querySelector(".vc-state-long").textContent, "No changes");
  // ⋯ opens and closes (Escape), its items close it.
  const toggle = top.querySelector(".vc-top-more-toggle");
  toggle.click();
  assert.equal(top.querySelector(".vc-top-more").classList.contains("vc-open"), true);
  top.querySelector(".vc-top-more").dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(top.querySelector(".vc-top-more").classList.contains("vc-open"), false);
  // The account: two letters of the username; Change password comes with M2.
  assert.equal(h.root.querySelector(".vc-avatar").textContent, "LA");
  assert.equal(h.root.querySelector(".vc-avatar").dataset.tooltip, "Account");
  // No skip link, no Preview toggle, no line under the top bar (Mr Spa has none).
  assert.equal(h.root.querySelector(".vc-skip, .vc-live, [data-action=preview]"), null);
});
