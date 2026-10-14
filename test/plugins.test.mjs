// M14: a site's own admin code — cms.config.ts `admin.plugins` (browser modules bundled into /admin) giving controls
// (a field's `control: "<name>"`, wrapping the standard box) and panels (the record editor's right column, above a
// list). On a fake DOM (happy-dom) through the REAL CMS API; the demo's own plugin runs in scripts/e2e.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminPluginModules } from "../dist/integration.js";
import { adminBoot, defineAdminPlugin, startAdmin } from "../dist/admin/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
const made = [];
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const CALL = "Call for price";
/** The Mr Spa CMS's "Call for price", as a site would write it (the demo's own is in fixtures/demo-site/cms). */
const demo = defineAdminPlugin({
  name: "demo",
  controls: {
    "call-for-price": ({ doc, id, value, set, standard }) => {
      const box = standard();
      const tick = doc.createElement("input");
      tick.type = "checkbox"; tick.id = `${id}-call`;
      tick.checked = value === CALL;
      box.element.hidden = tick.checked;
      tick.addEventListener("change", () => { set(tick.checked ? CALL : ""); box.element.hidden = tick.checked; });
      const element = doc.createElement("div");
      element.append(box.element, tick);
      return { element, show: (next) => { box.show?.(next); tick.checked = next === CALL; } };
    },
  },
  panels: [
    { title: "On the Services page", where: "list", collection: "services", render: ({ doc }) => { const p = doc.createElement("p"); return { element: p, update: ({ rows }) => { p.textContent = `${rows.length} services`; } }; } },
    { title: "Profile", where: "record", collection: "team", render: ({ doc }) => { const p = doc.createElement("p"); return { element: p, update: ({ record }) => { p.textContent = `Name: ${record.name || "—"}`; } }; } },
    { title: "Everywhere", where: "record", render: ({ doc }) => ({ element: doc.createElement("span") }) },
    { title: "Not here", where: "record", collection: "posts", render: () => { throw new Error("never drawn for team"); } },
  ],
});
const broken = defineAdminPlugin({
  name: "broken",
  controls: { "call-for-price": () => { throw new Error("taken already"); }, explode: () => { throw new Error("no canvas"); } },
  panels: [{ title: "Broken", where: "record", collection: "team", render: ({ doc }) => ({ element: doc.createElement("p"), update: () => { throw new Error("bad data"); } }) }],
});

const shell = async ({ plugins, settings = config } = {}) => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const drafts = createMemoryDraftStore();
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config: settings, source: createBundledSource(files), drafts, audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(settings, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, storage: null, confirm: () => true, preview: false, plugins });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  return { window, root, go, state: () => root.querySelector(".vc-state-long")?.textContent ?? "" };
};

test("M14 config: admin.plugins and a field's control are checked", () => {
  const problems = (change) => checkCmsConfig({ ...config, ...change }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ admin: { plugins: "./x.ts" } }), ["admin.plugins: must be a list of modules"]);
  assert.deepEqual(problems({ admin: { plugins: [""], panels: [] } }), ["admin.panels: unknown setting", "admin.plugins[0]: must be a module: a path from cms.config.ts or a package name"]);
  const withControl = (control) => problems({ collections: config.collections.map((collection) => (collection.key === "services" ? { ...collection, fields: { ...collection.fields, price: { ...collection.fields.price, control } } } : collection)) });
  assert.deepEqual(withControl("Call For Price"), ['collections[0].fields.price.control: "Call For Price" is not a control name']);
});

test("M14 build: a plugin is a path from cms.config.ts (it must be there) or a package name", () => {
  const dir = mkdtempSync(join(here, ".tmp-plugins-"));
  made.push(dir);
  writeFileSync(join(dir, "plugin.ts"), "export default { name: 'x' };");
  const file = join(dir, "cms.config.ts");
  const modules = adminPluginModules({ admin: { plugins: ["./plugin.ts", "@acme/cms-plugin"] } }, file);
  assert.equal(modules[0].endsWith("/plugin.ts"), true);
  assert.equal(modules[1], "@acme/cms-plugin");
  assert.throws(() => adminPluginModules({ admin: { plugins: ["./missing.ts"] } }, file), /cms\.config\.ts admin\.plugins: \.\/missing\.ts is not a file/);
  assert.deepEqual(adminPluginModules({}, file), []);
});

test("M14 a plugin's control: it wraps the standard box; what it sets is an ordinary change", async () => {
  const h = await shell({ plugins: [demo] });
  await h.go("/admin/catalog/services/classic-manicure");
  const field = h.root.querySelector('[data-path="price"]');
  const standard = field.querySelector(".vc-plugin-standard");
  assert.equal(standard.querySelector(".vc-price-currency").textContent, "$", "the standard price box, inside");
  const tick = field.querySelector('input[type="checkbox"]');
  tick.checked = true; tick.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  assert.equal(standard.hidden, true);
  assert.equal(h.state(), "1 unsaved change");
  tick.checked = false; tick.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  assert.equal(h.state(), "1 unsaved change", "the price is now empty");
});

test("M14 panels: in the record's right column and above the list, told the record / the rows; only where they belong", async () => {
  const h = await shell({ plugins: [demo] });
  await h.go("/admin/catalog/services");
  const listPanel = h.root.querySelector(".vc-list-panels .vc-plugin-panel");
  assert.deepEqual([listPanel.querySelector("h2").textContent, listPanel.querySelector("p").textContent], ["On the Services page", "3 services"]);
  await h.go("/admin/catalog/team/alex");
  const cards = () => [...h.root.querySelectorAll(".vc-record-side .vc-plugin-panel")];
  assert.deepEqual(cards().map((card) => card.querySelector("h2").textContent), ["Profile", "Everywhere"]);
  assert.equal(cards()[0].querySelector("p").textContent, "Name: Alex Example");
  const name = h.root.querySelector('[data-path="name"] input');
  name.value = "Alexandra"; name.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(cards()[0].querySelector("p").textContent, "Name: Alexandra", "told again after every change");
});

test("M14 a plugin that throws never stops the CMS: its place says so", async () => {
  const h = await shell({ plugins: [broken, demo] });
  await h.go("/admin/catalog/services/classic-manicure");
  assert.match(h.root.querySelector('[data-path="price"] .vc-plugin-problem').textContent, /^The broken plugin could not show this: taken already$/);
  await h.go("/admin/catalog/team/alex");
  const card = [...h.root.querySelectorAll(".vc-record-side .vc-plugin-panel")].find((entry) => entry.dataset.plugin === "broken");
  assert.equal(card.querySelector(".vc-plugin-problem").textContent, "The broken plugin could not show this: bad data");
  assert.ok(h.root.querySelector('[data-path="name"] input'), "the rest of the editor is there");
});
