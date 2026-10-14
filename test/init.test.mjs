// M15: `vibe-cms init` — a first draft of cms.config.ts from a site's JSON content: pages, collections, sections and
// guessed fields, checked against the content (what does not fit becomes plain text), preview hints for the templates.
// The made-up sites live under test/.tmp-init-* so the written config imports "@sonle282/vibe-cms/config" from this
// package (Node resolves a package's own name inside it) and loads exactly as a site's build loads it.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSite } from "../dist/index.js";
import { run } from "../dist/cli/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const tempSite = (files) => {
  const root = mkdtempSync(join(here, ".tmp-init-"));
  made.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
};
const cli = async (root, args) => {
  const out = []; const err = [];
  const code = await run(["init", ...args], { root, log: (line) => out.push(line), error: (line) => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const luna = () => tempSite({
  "package.json": { name: "luna-nails" },
  "astro.config.mjs": "export default { site: 'https://lunanails.example' };\n",
  ".git/config": '[remote "origin"]\n\turl = https://github.com/luna-org/luna-nails.git\n',
  ".git/HEAD": "ref: refs/heads/main\n",
  "src/data/home.json": {
    hero: { title: "Nails, done right", lead: "A calm studio in the old town.\nWalk in or book ahead — we keep a chair for you.", image: "/img/hero.jpg" },
    cta: { label: "Book now", href: "/booking/" },
    phone: "(215) 772-1111",
    openedOn: "2019-05-04",
    showBanner: true,
    years: 7,
    gallery: [{ photo: "/img/a.webp", caption: "Gel" }, { photo: { src: "/img/b.webp", alt: "Pink" }, caption: "Pink" }],
    socialUrl: "Find us on Instagram",
    "bad-key": "x",
    nothing: null,
  },
  "src/data/privacy-policy.json": { title: "Privacy", body: "<p>We keep <strong>only</strong> what we need.</p>" },
  "src/data/header.json": { logo: "/logo.svg", links: [{ label: "Services", href: "/services/" }] },
  "src/data/seo.json": { title: "Luna Nails", description: "Nails in the old town", image: "/img/share.jpg" },
  "src/data/faqs.json": [{ id: "walk-ins", q: "Walk-ins?", a: "Yes." }, { id: "parking", q: "Parking?", a: "Behind the studio." }],
  "src/data/numbers.json": [1, 2, 3],
  "src/data/image-manifest.json": { "salon/a": { widths: [400] } },
  "src/pages/index.astro": [
    "---",
    'import home from "../data/home.json";',
    "---",
    "<h1>{home.hero.title}</h1>",
    "<p>{ home.hero.lead }</p>",
    '<a data-cms-field="home.cta.label" href={home.cta.href}>{home.cta.label}</a>',
    "<p>{home.gallery[0].caption} {home.hero}</p>",
  ].join("\n"),
  "src/pages/privacy-policy.astro": "<h1>Privacy</h1>\n",
});

test("M15 init: pages, collections, sections and guessed fields — checked against the content, loads like the build", async () => {
  const root = luna();
  const { code, out, err } = await cli(root, []);
  assert.equal(code, 0, err);
  const config = readFileSync(join(root, "cms.config.ts"), "utf8");
  assert.match(out, /^Wrote cms\.config\.ts: 4 pages \(files\), 1 collection, \d+ fields — checked against the content as it is\.$/m);
  // The site: its name, address, repository and branch, the phone format of its numbers.
  assert.match(config, /site: \{ name: "Luna Nails", url: "https:\/\/lunanails\.example", phone: \{ country: "US" \} \},\n/);
  assert.match(config, /repo: \{ owner: "luna-org", name: "luna-nails", branch: "main" \},\n/);
  assert.match(config, /roles: \["admin", "editor"\]/);
  // Pages: preview from src/pages, policies in their group, the header across the site, Search & sharing.
  assert.match(config, /key: "home", label: "Home", path: "src\/data\/home\.json", format: "json", preview: "\/",/);
  assert.match(config, /key: "privacy-policy", label: "Privacy policy", path: "src\/data\/privacy-policy\.json", format: "json", preview: "\/privacy-policy\/", group: "Policies",/);
  assert.match(config, /key: "header", .*preview: "\/", area: true, description: "TODO: what it holds, in a few words",/);
  assert.match(config, /key: "seo", label: "SEO", .*layout: "seo", seo: \{ title: "title", description: "description", image: "image" \},/);
  assert.match(config, /sections: \[\{ key: "general", label: "General", fields: \["phone", "openedOn", "showBanner", "years", "socialUrl"\] \}, \{ key: "hero", label: "Hero", fields: \["hero"\] \}, \{ key: "cta", label: "CTA", fields: \["cta"\] \}, \{ key: "gallery", label: "Gallery", fields: \["gallery"\] \}\],/);
  // Fields, from keys and values.
  for (const line of [
    'title: f.text({ label: "Title" }),',
    'lead: f.text({ label: "Lead", multiline: true }),',
    'image: f.image({ label: "Image" }),',
    'href: f.link({ label: "Href" }),',
    'phone: f.phone({ label: "Phone" }),',
    'openedOn: f.text({ label: "Opened on", pattern: "\\\\d{4}-\\\\d{2}-\\\\d{2}", patternHint: "a date like 2026-10-14" }),',
    'showBanner: f.toggle({ label: "Show banner" }),',
    'years: f.number({ label: "Years", integer: true }),',
    'photo: f.image({ label: "Photo" }),',
    'body: f.richText({ label: "Body" }),',
    'logo: f.image({ label: "Logo" }),',
  ]) assert.ok(config.includes(line), `${line}\n${config}`);
  assert.match(config, /gallery: f\.list\(f\.object\(\{ label: "Gallery", fields: \{[\s\S]*?\} \}\), \{ label: "Gallery", itemLabel: "Gallery" \}\),/);
  // A list of records with a unique id → a collection (the id is the CMS's, not a field).
  assert.match(config, /key: "faqs", label: "FAQs", itemLabel: "FAQ",\n\s+store: \{ kind: "json-array", path: "src\/data\/faqs\.json", idField: "id" \}, \/\/ TODO: preview/);
  assert.ok(!/\bid: f\./.test(config), "no id field");
  // The content decides: a "url" that is not a link becomes plain text; what cannot be a field is left out, and said.
  assert.ok(config.includes('socialUrl: f.text({ label: "Social URL", multiline: true }),'), config);
  for (const note of [
    "src/data/home.json → socialUrl: guessed as link, but the content does not fit — plain text",
    "src/data/home.json → bad-key: not a usable field name (letters, digits and _ only) — left out",
    "src/data/home.json → nothing: always empty (null) — left out",
    "src/data/numbers.json: not an object or a list of records — left out",
  ]) { assert.ok(config.includes(`//   - ${note}`), note); assert.ok(out.includes(`  - ${note}`), note); }
  assert.ok(!config.includes("image-manifest"), "the image manifest is not content");
  // Preview hints: where a template prints a value, the attribute to add; elements bound already are left alone.
  assert.match(out, /src\/pages\/index\.astro:4  \{home\.hero\.title\}  →  data-cms-field="home\.hero\.title"/);
  assert.match(out, /src\/pages\/index\.astro:5  \{ home\.hero\.lead \}  →  data-cms-field="home\.hero\.lead"/);
  assert.match(out, /src\/pages\/index\.astro:7  \{home\.gallery\[0\]\.caption\}  →  data-cms-field="home\.gallery\[0\]\.caption"/);
  assert.ok(!/index\.astro:6/.test(out), "the bound element is left alone");
  assert.ok(!/\{home\.hero\}/.test(out), "an object is not a place to bind");
  // It loads and checks exactly like the site's build.
  const loaded = await checkSite(join(root, "cms.config.ts"));
  assert.deepEqual([loaded.files.map((file) => file.key), loaded.collections.map((collection) => collection.key)], [["header", "home", "privacy-policy", "seo"], ["faqs"]]);
});

test("M15 init: never replaces cms.config.ts without --force; --dry-run writes nothing; no JSON → what to do", async () => {
  const root = luna();
  writeFileSync(join(root, "cms.config.ts"), "// mine\n");
  const refused = await cli(root, []);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /✘ cms\.config\.ts already exists — init only writes a first draft\n→ move it away, or run again with --force to replace it/);
  assert.equal(readFileSync(join(root, "cms.config.ts"), "utf8"), "// mine\n");
  const dry = await cli(root, ["--dry-run", "--name", "Luna", "--url", "https://luna.example/", "--repo", "me/luna", "--branch", "dev"]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^Draft \(not written\): /m);
  assert.match(dry.out, /site: \{ name: "Luna", url: "https:\/\/luna\.example", phone/);
  assert.match(dry.out, /repo: \{ owner: "me", name: "luna", branch: "dev" \}/);
  assert.equal(readFileSync(join(root, "cms.config.ts"), "utf8"), "// mine\n");
  assert.equal((await cli(root, ["--force"])).code, 0);
  assert.match(readFileSync(join(root, "cms.config.ts"), "utf8"), /A FIRST DRAFT written by `npx vibe-cms init`/);

  const empty = tempSite({ "package.json": { name: "empty" } });
  const none = await cli(empty, []);
  assert.equal(none.code, 1);
  assert.match(none.err, /✘ no JSON content found in src\/data, src\/content\n→ the CMS edits JSON files: move the site's content/);
  assert.equal(existsSync(join(empty, "cms.config.ts")), false);
  const odd = tempSite({ "content/home.json": { title: "Hi" } });
  const other = await cli(odd, ["--data", "content", "--repo", "me/odd"]);
  assert.equal(other.code, 0, other.err);
  assert.match(other.out, /TODO|1 page/);
  assert.match(readFileSync(join(odd, "cms.config.ts"), "utf8"), /url: "https:\/\/example\.com" \}, \/\/ TODO: the website's real address/);
});

test("M15 init: a site that builds its pages as files (build.format \"file\") gets previews without the trailing slash", async () => {
  const root = tempSite({
    "astro.config.mjs": "export default { site: 'https://filesite.example', build: { format: \"file\" } };\n",
    "src/data/home.json": { title: "Hi" },
    "src/data/privacy-policy.json": { title: "Privacy" },
    "src/data/about.json": { title: "About us" },
    "src/data/faqs.json": [{ id: "a", q: "Q?", a: "A." }],
    "src/pages/privacy-policy.astro": "<h1>Privacy</h1>\n",
  });
  const { code, err } = await cli(root, ["--repo", "me/filesite"]);
  assert.equal(code, 0, err);
  const config = readFileSync(join(root, "cms.config.ts"), "utf8");
  assert.match(config, /key: "privacy-policy", .*preview: "\/privacy-policy", group: "Policies",/);
  assert.match(config, /key: "home", .*preview: "\/",/, "home stays /");
  assert.match(config, /\{ \/\/ TODO: preview: the address of the page that shows it \(e\.g\. "\/about"\)\n\s+key: "about"/);
  assert.match(config, /\/\/ TODO: preview: the address of one record's page \(e\.g\. "\/blog\/\{id\}"\)/);
  assert.equal((await checkSite(join(root, "cms.config.ts"))).files.find((file) => file.key === "privacy-policy").preview, "/privacy-policy");
});

test("M15 init on the demo site: a draft that loads and checks with no warning", async () => {
  const root = mkdtempSync(join(here, ".tmp-init-"));
  made.push(root);
  const demo = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
  cpSync(join(demo, "src"), join(root, "src"), { recursive: true });
  cpSync(join(demo, "astro.config.mjs"), join(root, "astro.config.mjs"));
  const result = await cli(root, ["--repo", "demo/demo-site"]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /4 pages \(files\), 2 collections/);
  const warnings = [];
  const loaded = await checkSite(join(root, "cms.config.ts"), { onWarnings: (list) => warnings.push(...list) });
  assert.deepEqual(warnings, []);
  assert.equal(loaded.collections.find((collection) => collection.key === "team").fields.photo.type, "image", "a photo written as a path or { src } is an image");
});
