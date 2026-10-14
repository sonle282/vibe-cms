// M8: a collection's list, as in the Mr Spa CMS (Products / Projects / Blog): config `list` (columns, filters,
// search, detail, duplicate), `labels`, `status.archived`; the API's values / status per record; the screen on a fake
// DOM (happy-dom) through the REAL CMS API (in-memory stores) — columns, Live / Draft / Archived, "Unpublished
// changes", search, filters, the count and the empty words, ⋯ Edit / Duplicate / View on website.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminBoot, startAdmin } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (check, what) => { for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };
const archivedPost = "---\nslug: old-news\ntitle: Old news\nstatus: archived\n---\nGone from the website, kept here.\n";

const shell = async ({ confirm = () => true, content = files, settings = config } = {}) => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const drafts = createMemoryDraftStore();
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config: settings, source: createBundledSource(content), drafts, audit: createMemoryAuditLog(), identify: () => user, publisher: undefined });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const call = async (method, path, body) => (await fetch(`/api/cms${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const asked = [];
  const app = startAdmin({ root, boot: adminBoot(settings, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, storage: null, confirm: (message, choice) => { asked.push([message, choice]); return confirm(message); } });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  const rows = () => [...root.querySelectorAll(".vc-list-table tbody tr.vc-list-row")];
  const cells = (row) => [...row.querySelectorAll("td")].slice(0, -1).map((cell) => cell.textContent.trim());
  const typeSearch = (text) => { const input = root.querySelector(".vc-list-search input"); input.value = text; input.dispatchEvent(new window.Event("input", { bubbles: true })); };
  return { window, root, drafts, call, go, app, rows, cells, typeSearch, asked, count: () => root.querySelector(".vc-list-count").textContent };
};

test("M8 config: list / labels / status.archived are checked, with what to write instead", () => {
  const base = (collection) => ({ ...config, collections: [{ ...config.collections[0], ...collection }] });
  const problems = (collection) => checkCmsConfig(base(collection)).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems({ list: { columns: [{ field: "category" }, { field: "price", label: "Price" }], filters: [{ field: "category", all: "All categories" }], search: ["description"], detail: "{price} · {category}", duplicate: { clear: ["price"] } }, labels: { add: "Add service", search: "Search by name", many: "services" } }), []);
  assert.deepEqual(problems({ list: { columns: [{ field: "nope" }] } }), ['collections[0].list.columns[0].field: "nope" is not a field of this collection']);
  assert.deepEqual(problems({ list: { filters: [{ field: "description" }] } }), ["collections[0].list.filters[0].field: a text field cannot be a filter"]);
  assert.deepEqual(problems({ list: { detail: "SKU {sku}" } }), ["collections[0].list.detail: {sku} is not a field of this collection"]);
  assert.deepEqual(problems({ list: { duplicate: true }, fixed: true }), ["collections[0].list.duplicate: a fixed collection gets no new record, so no copy either"]);
  assert.deepEqual(problems({ list: { sort: "name" } }), ["collections[0].list.sort: unknown setting"]);
  assert.deepEqual(problems({ labels: { button: "Add" } }), ["collections[0].labels.button: unknown setting"]);
  const posts = config.collections.find((collection) => collection.key === "posts");
  const statusProblems = (status) => checkCmsConfig({ ...config, collections: config.collections.map((collection) => (collection.key === "posts" ? { ...posts, status } : collection)) }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(statusProblems({ field: "status", live: "published", draft: "draft", archived: "gone" }), ['collections[2].status.archived: "gone" is not an option of the "status" select']);
  assert.deepEqual(statusProblems({ field: "status", live: "published", draft: "draft", archived: "draft" }), ['collections[2].status.archived: must differ from live and draft (got "draft")']);
});

test("M8 API: each record's status on the website, the values its list shows, when my draft was saved", async () => {
  const h = await shell({ content: { ...files, "src/content/posts/old-news.md": archivedPost } });
  const posts = await h.call("GET", "/collections/posts");
  assert.deepEqual(posts.items.map((item) => [item.id, item.status, item.values.tags ?? null]), [["old-news", "archived", null], ["spring-colours", "draft", null], ["welcome", "live", ["news", "demo"]]]);
  const services = await h.call("GET", "/collections/services");
  assert.deepEqual(Object.keys(services.items[0].values).sort(), ["category", "price"]);
  assert.equal(services.items[0].status, "live", "no status setting: every record is live");
  const one = await h.call("GET", "/collections/services/items/nail-art");
  await h.call("PUT", "/collections/services/items/nail-art", { content: { ...one.content, name: "Nail Art+" }, expectedRevision: 0, sourceVersion: one.version });
  const after = (await h.call("GET", "/collections/services")).items.find((item) => item.id === "nail-art");
  assert.equal(after.hasDraft, true);
  assert.match(after.draftSavedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("M8 list (Mr Spa): columns, Live / Draft / Archived, Unpublished changes, the count, search, filters, empty words", async () => {
  const h = await shell({ content: { ...files, "src/content/posts/old-news.md": archivedPost } });
  await h.go("/admin/catalog/services");
  assert.deepEqual([...h.root.querySelectorAll(".vc-list-table thead th")].map((th) => th.textContent), ["Service", "Category", "Price", "Status", "Actions"], "no ID column");
  assert.deepEqual(h.rows().map(h.cells), [["Classic Manicure", "Nails", "$20", "Live"], ["Spa Pedicure", "Spa", "$35", "Live"], ["Nail Art", "Nails", "$5+", "Live"]]);
  assert.equal(h.count(), "3 services");
  assert.equal(h.root.querySelector(".vc-list-search input").placeholder, "Search services");
  assert.equal([...h.root.querySelectorAll(".vc-actions a")].map((link) => link.textContent).join(), "Add service");
  // Search: every word, anywhere in the row (name, id, columns).
  h.typeSearch("nails art");
  assert.deepEqual(h.rows().map((row) => row.dataset.id), ["nail-art"]);
  assert.equal(h.count(), "1 of 3 services");
  h.typeSearch("");
  // A filter with a few choices is buttons: All · Nails · Spa.
  const segments = [...h.root.querySelectorAll('.vc-list-segmented[aria-label="Category"] .vc-list-segment')];
  assert.deepEqual(segments.map((button) => [button.textContent, button.getAttribute("aria-checked")]), [["All", "true"], ["Nails", "false"], ["Spa", "false"]]);
  segments[2].click();
  assert.deepEqual(h.rows().map((row) => row.dataset.id), ["spa-pedicure"]);
  assert.equal(h.count(), "1 of 3 services");
  h.typeSearch("manicure");
  assert.equal(h.root.querySelector(".vc-list-empty").textContent, "No services match these filters.");
  assert.equal(h.count(), "0 of 3 services");

  // Blog: All · Live · Draft · Archived; the status words; "New post"; a saved draft says "Unpublished changes".
  const welcome = await h.call("GET", "/collections/posts/items/welcome");
  await h.call("PUT", "/collections/posts/items/welcome", { content: { ...welcome.content, title: "Welcome!" }, expectedRevision: 0, sourceVersion: welcome.version });
  await h.go("/admin/catalog/posts");
  assert.deepEqual([...h.root.querySelectorAll(".vc-list-table thead th")].map((th) => th.textContent), ["Post", "Tags", "Status", "Actions"]);
  assert.deepEqual(h.rows().map(h.cells), [["Old news", "—", "Archived"], ["Spring colours (draft)", "—", "Draft"], ["Welcome to the demo blog", "news, demo", "LiveUnpublished changes"]]);
  assert.match(h.root.querySelector('tr[data-id="welcome"] .vc-list-status-note').title, /^Draft saved [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
  assert.equal(h.root.querySelector('tr[data-id="old-news"] .vc-content-status').className, "vc-content-status is-archived");
  assert.equal(h.count(), "3 posts");
  assert.equal([...h.root.querySelectorAll(".vc-actions a")].map((link) => link.textContent).join(), "New post", "labels.add");
  const status = [...h.root.querySelectorAll('.vc-list-segmented[aria-label="Status"] .vc-list-segment')];
  assert.deepEqual(status.map((button) => button.textContent), ["All", "Live", "Draft", "Archived"]);
  status[3].click();
  assert.deepEqual(h.rows().map((row) => row.dataset.id), ["old-news"]);
  // Arrow keys move along the buttons and choose (Mr Spa).
  status[3].dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(h.root.querySelector('.vc-list-segmented[aria-label="Status"] [aria-checked="true"]').textContent, "All");
  assert.equal(h.rows().length, 3);
  // A new record's draft is not a row (Mr Spa: it is on Drafts until it is published).
  await h.call("PUT", "/collections/posts/items/brand-new", { content: { slug: "brand-new", title: "Brand new", status: "draft", body: "Hi" }, expectedRevision: 0, sourceVersion: "new" });
  await h.go("/admin/catalog/posts");
  assert.equal(h.rows().length, 3);
  assert.equal(h.count(), "3 posts");
});

test("M8 ⋯ (Mr Spa): Edit · Duplicate · View on website (only when Live); Duplicate makes an unpublished “Copy of …” and opens it", async () => {
  let answer = false;
  const h = await shell({ confirm: () => answer });
  await h.go("/admin/catalog/services");
  const menu = (id) => h.root.querySelector(`tr[data-id="${id}"] .vc-row-menu`);
  const trigger = menu("spa-pedicure").querySelector(".vc-row-menu-button");
  assert.deepEqual([trigger.getAttribute("aria-label"), trigger.dataset.tooltip], ["More actions for Spa Pedicure", "More"]);
  trigger.click();
  const items = [...menu("spa-pedicure").querySelectorAll(".vc-row-menu-item")];
  assert.deepEqual(items.map((item) => [item.tagName, item.textContent]), [["BUTTON", "Edit"], ["BUTTON", "Duplicate"], ["A", "View on website"]]);
  assert.deepEqual([items[2].getAttribute("href"), items[2].getAttribute("target")], ["/services/", "_blank"]);
  // Duplicate asks first; no keeps everything as it is.
  items[1].click();
  await settle();
  assert.deepEqual(h.asked.at(-1), ['Duplicate service\n\nCreate a new, unpublished service from "Spa Pedicure"? The name starts as "Copy of …"; everything else is kept. The original service is not changed.', { confirm: "Create copy" }]);
  assert.equal((await h.drafts.mine("usr_owner")).length, 0);
  // Yes: a new draft "Copy of Spa Pedicure" (id from the name), the same price and category, opened in the editor.
  answer = true;
  menu("spa-pedicure").querySelector(".vc-row-menu-button").click();
  [...menu("spa-pedicure").querySelectorAll(".vc-row-menu-item")].find((item) => item.textContent === "Duplicate").click();
  await until(() => h.window.location.pathname === "/admin/catalog/services/copy-of-spa-pedicure", "the copy's editor");
  const copy = await h.drafts.get("usr_owner", "item:services:copy-of-spa-pedicure");
  assert.deepEqual([copy.content.name, copy.content.price, copy.content.category, copy.content.id], ["Copy of Spa Pedicure", "$35", "Spa", "copy-of-spa-pedicure"]);
  // A second copy gets its own address.
  await h.go("/admin/catalog/services");
  menu("spa-pedicure").querySelector(".vc-row-menu-button").click();
  [...menu("spa-pedicure").querySelectorAll(".vc-row-menu-item")].find((item) => item.textContent === "Duplicate").click();
  await until(() => h.window.location.pathname === "/admin/catalog/services/copy-of-spa-pedicure-2", "the second copy");
  // Blog has no Duplicate (not configured); a post that is not Live has no View on website.
  await h.go("/admin/catalog/posts");
  menu("spring-colours").querySelector(".vc-row-menu-button").click();
  assert.deepEqual([...menu("spring-colours").querySelectorAll(".vc-row-menu-item")].map((item) => item.textContent), ["Edit"]);
  menu("welcome").querySelector(".vc-row-menu-button").click();
  assert.deepEqual([...menu("welcome").querySelectorAll(".vc-row-menu-item")].map((item) => [item.textContent, item.getAttribute("href")]), [["Edit", null], ["View on website", "/blog/welcome/"]]);
});

test("M8: a second line under the name ({field} words, only when every word has a value); many choices are a dropdown", async () => {
  const options = ["Nails", "Spa", "Waxing", "Lashes", "Brows", "Kids"];
  const settings = { ...config, collections: config.collections.map((collection) => (collection.key === "services"
    ? { ...collection, fields: { ...collection.fields, category: { ...collection.fields.category, options } }, list: { detail: "{category} · {price}", filters: [{ field: "category", all: "All categories" }] } }
    : collection)) };
  const content = { ...files, "src/data/services.json": JSON.stringify([{ id: "a", name: "Gel", price: "$30", category: "Nails" }, { id: "b", name: "Brow tint", price: "", category: "Brows" }], null, 2) };
  const h = await shell({ settings, content });
  await h.go("/admin/catalog/services");
  assert.deepEqual(h.rows().map((row) => row.querySelector(".vc-list-name-detail")?.textContent ?? null), ["Nails · $30", null], "no price: no second line");
  const select = h.root.querySelector(".vc-list-filter select");
  assert.deepEqual([...select.options].map((option) => option.textContent), ["All categories", ...options]);
  assert.equal(h.root.querySelector(".vc-list-filter .vc-sr-only").textContent, "Category");
  select.value = "Brows"; select.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  assert.deepEqual(h.rows().map((row) => row.dataset.id), ["b"]);
  assert.equal(h.count(), "1 of 2 services");
  h.typeSearch("$30");
  assert.equal(h.root.querySelector(".vc-list-empty").textContent, "No services match these filters.");
});
