// P21: a site that had a CMS keeps its Cloudflare set-up — its own binding and secret names (cms.config `bindings`,
// `secrets`) in the Worker, the routes and the CLI — and its templates' data-cms-bind attributes (read as data-cms-field
// in the preview only). No new resources, no data copied, no secret entered again.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, f, siteNames } from "../dist/index.js";
import { siteEnv } from "../dist/api/index.js";
import { attachBridge } from "../dist/admin/index.js";
import { BINDINGS, SECRETS, checkWiring, useSiteNames } from "../dist/cli/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); useSiteNames(siteNames({})); });
const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "acme", name: "s", branch: "main" }, files: [], collections: [] };

test("P21 names: the defaults, or the site's own; checked", () => {
  assert.deepEqual(siteNames({}), { db: "CMS_DB", session: "SESSION", media: "CMS_MEDIA", loginLimiter: "CMS_LOGIN_LIMITER", publishLimiter: "CMS_PUBLISH_LIMITER", githubToken: "VIBE_GITHUB_TOKEN" });
  assert.deepEqual(siteNames({ bindings: { media: "MEDIA" }, secrets: { githubToken: "CMS_GITHUB_TOKEN" } }), { db: "CMS_DB", session: "SESSION", media: "MEDIA", loginLimiter: "CMS_LOGIN_LIMITER", publishLimiter: "CMS_PUBLISH_LIMITER", githubToken: "CMS_GITHUB_TOKEN" });
  const errors = (change) => checkCmsConfig({ ...base, files: [{ key: "a", label: "A", path: "src/data/a.json", format: "json", fields: { t: f.text({ label: "T" }) } }], ...change }).errors.map((entry) => `${entry.path}: ${entry.message}`);
  assert.deepEqual(errors({ bindings: { media: "MEDIA" }, secrets: { githubToken: "CMS_GITHUB_TOKEN" } }), []);
  assert.deepEqual(errors({ bindings: { bucket: "X", media: "my-media" }, secrets: "x" }), ["bindings.bucket: unknown setting", 'bindings.media: "my-media" is not a binding / variable name', "secrets: must be an object of names"]);
});

test("P21 the Worker reads the site's own names (Mr Spa: MEDIA, CMS_GITHUB_TOKEN)", () => {
  const bucket = { get: () => null }; const db = { prepare: () => null };
  const env = siteEnv({ bindings: { media: "MEDIA" }, secrets: { githubToken: "CMS_GITHUB_TOKEN" } }, { CMS_DB: db, MEDIA: bucket, CMS_GITHUB_TOKEN: "token-value", OTHER: 1 });
  assert.equal(env.CMS_MEDIA, bucket);
  assert.equal(env.CMS_DB, db);
  assert.equal(env.VIBE_GITHUB_TOKEN, "token-value");
  assert.equal(siteEnv({}, { MEDIA: bucket }).CMS_MEDIA, undefined, "by default only CMS_MEDIA counts");
});

test("P21 vibe-cms check: the wiring under the site's own names", () => {
  const root = mkdtempSync(join(here, ".tmp-names-"));
  made.push(root);
  const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
  const file = join(root, "wrangler.astro.jsonc");
  writeFileSync(file, JSON.stringify({
    d1_databases: [{ binding: "CMS_DB", database_name: "mrspainc-cms", database_id: "u", migrations_dir: migrations }],
    kv_namespaces: [{ binding: "SESSION", id: "k" }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: "mrspainc-media" }],
    ratelimits: [{ name: "CMS_LOGIN_LIMITER", namespace_id: "1" }, { name: "CMS_PUBLISH_LIMITER", namespace_id: "2" }],
  }));
  useSiteNames(siteNames({}));
  assert.match(checkWiring(root, file, "mrspainc").warnings.map((entry) => entry.message).join(), /CMS_MEDIA \(R2 mrspainc-media\) is missing/, "under the default name, the bucket is not seen");
  useSiteNames(siteNames({ bindings: { media: "MEDIA" }, secrets: { githubToken: "CMS_GITHUB_TOKEN" } }));
  const wired = checkWiring(root, file, "mrspainc");
  assert.deepEqual(wired.errors.filter((entry) => entry.where !== "package.json"), []);
  assert.equal(wired.warnings.some((entry) => /MEDIA/.test(entry.message)), false);
  assert.deepEqual([BINDINGS.media, SECRETS.githubToken], ["MEDIA", "CMS_GITHUB_TOKEN"]);
});

test("P21 preview: data-cms-bind (the Mr Spa CMS's) is read as data-cms-field of the record being edited; a whole list only marks its place", () => {
  const window = new Window({ url: "http://localhost/?cmsPreview=1" });
  window.document.body.innerHTML = `
    <h1 data-cms-bind="hero.title">Old</h1>
    <a data-cms-bind="hero.ctaLabel" data-cms-bind-href="hero.ctaHref" href="/old/">Go</a>
    <div data-cms-bind="story.paragraphs"><p>One</p><p>Two</p></div>
    <section><div data-cms-item-index="0"><span data-cms-bind="items.0.title">Card</span></div></section>`;
  const fields = {
    hero: f.object({ label: "Hero", fields: { title: f.text({ label: "Heading" }), ctaLabel: f.text({ label: "Button label" }), ctaHref: f.link({ label: "Button destination" }) } }),
    story: f.object({ label: "Story", fields: { paragraphs: f.list(f.text({ label: "Paragraph" }), { label: "Paragraphs" }) } }),
    items: f.list(f.object({ label: "Item", fields: { title: f.text({ label: "Title" }) } }), { label: "Items" }),
  };
  const value = { hero: { title: "Old", ctaLabel: "Go", ctaHref: "/old/" }, story: { paragraphs: ["One", "Two"] }, items: [{ title: "Card" }] };
  const selections = [];
  const bridge = attachBridge({ frame: window, doc: window.document, owner: "file:about", value, fields, describe: () => "", onSelect: (selection) => selections.push(selection) });
  const $ = (selector) => window.document.querySelector(selector);
  bridge.update({ ...value, hero: { title: "New heading", ctaLabel: "Book", ctaHref: "/book/" } }, ["hero"]);
  assert.equal($("h1").textContent, "New heading");
  assert.deepEqual([$("a").textContent, $("a").getAttribute("href")], ["Book", "/book/"]);
  bridge.update({ ...value, story: { paragraphs: ["Changed"] } }, ["story", "paragraphs"]);
  assert.equal($("[data-cms-bind='story.paragraphs']").innerHTML, "<p>One</p><p>Two</p>", "a whole list is not redrawn from text");
  bridge.update({ ...value, items: [{ title: "Card two" }] }, ["items", 0, "title"]);
  assert.equal($("span").textContent, "Card two", "a path in the record, whatever is around it");
  $("h1").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(selections.map((selection) => [selection.owner, selection.path.join(".")]), [["file:about", "hero.title"]]);
  // Another record (a collection item) is not given these: only the file being edited owns them.
  const other = new Window({ url: "http://localhost/?cmsPreview=1" });
  other.document.body.innerHTML = '<h1 data-cms-bind="hero.title">Old</h1>';
  attachBridge({ frame: other, doc: other.document, owner: "item:posts:a", value: {}, fields: {}, describe: () => "", onSelect: () => {} });
  assert.equal(other.document.querySelector("h1").hasAttribute("data-cms-field"), false);
});
