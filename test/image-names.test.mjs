// P12h: images stored by NAME in the site's image manifest ("nails/nails-01"); the site's build makes every size.
// The admin works with addresses; the API converts both ways, so drafts, publish and the files hold names; an upload is
// named by where the publish commits it (uploads/2026/03/chair-<hash>) and goes into media.dir with the content.
// Invented content and manifest, shaped like a real salon's.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkContent, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f } from "../dist/index.js";
import { checkRecordValues } from "../dist/check/values.js";
import { createMediaStore, createMemoryBucket, mediaSettings } from "../dist/media/index.js";
import { addressOfName, imageNamesOf, manifestImages, mapImageValues, nameOfAddress, uploadNamesIn } from "../dist/media/names.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";
import { tinyWebp } from "./helpers/images.mjs";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const manifest = {
  "nails/nails-01": { width: 2400, height: 1600, widths: [400, 800, 1600, 2400], path: "/assets/img/nails/nails-01" },
  "salon/salon-10": { width: 1200, height: 800, widths: [400, 800, 1200], path: "/assets/img/salon/salon-10" },
  "brand/logo": { width: 600, height: 140, widths: [240, 600], path: "/assets/img/brand/logo" },
};
const media = { dir: "assets-src/images/uploads", base: "/assets/uploads", names: { manifest: "src/data/image-manifest.json", root: "assets-src/images", exclude: ["brand/"] } };
const names = imageNamesOf(media, manifest, "/assets/uploads");
const fields = {
  cardImage: f.image({ label: "Card image" }),
  hero: f.image({ label: "Hero", alt: true, mobile: true }),
  strip: f.list(f.image({ label: "Photo" }), { label: "Strip" }),
  "about.photo": f.image({ label: "About photo" }),
};
const content = { cardImage: "nails/nails-01", hero: { src: "salon/salon-10", alt: "The salon", mobile: "nails/nails-01" }, strip: ["salon/salon-10"], about: { photo: "nails/nails-01", title: "kept" } };

test("names: the editor's address of a name is the largest size ≤ 1600; any size of it, or an upload's address, comes back to its name", () => {
  assert.deepEqual(names.uploads, { prefix: "uploads", base: "/assets/uploads" });
  assert.equal(addressOfName(names, "nails/nails-01"), "/assets/img/nails/nails-01-1600.webp");
  assert.equal(addressOfName(names, "salon/salon-10"), "/assets/img/salon/salon-10-1200.webp");
  assert.equal(addressOfName(names, "nails/unknown"), undefined);
  assert.equal(addressOfName(names, "uploads/2026/03/chair-0123abcd", (tail) => `/assets/uploads/${tail}.webp`), "/assets/uploads/2026/03/chair-0123abcd.webp");
  for (const address of ["/assets/img/nails/nails-01-400.webp", "/assets/img/nails/nails-01-2400.webp?v=2", "nails/nails-01"]) assert.equal(nameOfAddress(names, address), "nails/nails-01");
  assert.equal(nameOfAddress(names, "/assets/uploads/2026/03/chair-0123abcd.webp"), "uploads/2026/03/chair-0123abcd");
  assert.equal(nameOfAddress(names, "/images/elsewhere.jpg"), undefined);
  assert.deepEqual(uploadNamesIn(names, JSON.stringify({ a: "uploads/2026/03/chair-0123abcd", b: ["uploads/2026/04/desk-89abcdef", "uploads/x"] })), ["uploads/2026/03/chair-0123abcd", "uploads/2026/04/desk-89abcdef"]);
  // The library: one image per name at the editor's size; brand/ (logos) left out.
  assert.deepEqual(manifestImages(names).map((image) => [image.name, image.src]), [["nails/nails-01", "/assets/img/nails/nails-01-1600.webp"], ["salon/salon-10", "/assets/img/salon/salon-10-1200.webp"]]);
  // Without media.names the site stores image paths, as before.
  assert.equal(imageNamesOf({ dir: "public/assets/uploads" }, manifest, "/assets/uploads"), undefined);
});

test("names: every image value of a record is mapped — a string, src / mobile of an image object, list items, dotted keys; the rest untouched", () => {
  const mapped = mapImageValues(fields, content, (name) => addressOfName(names, name) ?? name);
  assert.deepEqual(mapped, {
    cardImage: "/assets/img/nails/nails-01-1600.webp",
    hero: { src: "/assets/img/salon/salon-10-1200.webp", alt: "The salon", mobile: "/assets/img/nails/nails-01-1600.webp" },
    strip: ["/assets/img/salon/salon-10-1200.webp"],
    about: { photo: "/assets/img/nails/nails-01-1600.webp", title: "kept" },
  });
  assert.deepEqual(mapImageValues(fields, mapped, (address) => nameOfAddress(names, address) ?? address), content, "and back");
  assert.deepEqual(content.hero.src, "salon/salon-10", "the original is not changed");
});

test("checks: a name must be in the manifest or be an upload's name — at build (with the manifest file) and in the value check", () => {
  assert.deepEqual(checkRecordValues({ fields, record: content, imageNames: names }).errors, []);
  const bad = { ...content, cardImage: "nails/nails-99", hero: { src: "/assets/img/salon/salon-10-1200.webp" } };
  assert.deepEqual(checkRecordValues({ fields, record: bad, imageNames: names }).errors.map((problem) => `${problem.path}: ${problem.message}`), [
    'cardImage: text "nails/nails-99" is not an image of the site\'s manifest',
    'hero.src: text "/assets/img/salon/salon-10-1200.webp" is not an image of the site\'s manifest',
  ]);
  assert.deepEqual(checkRecordValues({ fields, record: { ...content, cardImage: "uploads/2026/03/chair-0123abcd" }, imageNames: names }).errors, [], "an upload's name is fine before the build has it");
  // The build-time content check reads the manifest of the project.
  const root = mkdtempSync(join(tmpdir(), "vibe-names-"));
  dirs.push(root);
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(join(root, "src/data/home.json"), JSON.stringify({ ...content, cardImage: "nails/gone" }));
  const config = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, media, collections: [], files: [{ key: "home", label: "Home", path: "src/data/home.json", format: "json", fields }] };
  assert.match(checkContent(config, root).errors.map((problem) => `${problem.path}: ${problem.message}`).join("\n"), /src\/data\/image-manifest\.json: the image manifest \(media\.names\.manifest\) is missing/);
  writeFileSync(join(root, "src/data/image-manifest.json"), JSON.stringify(manifest));
  assert.deepEqual(checkContent(config, root).errors.map((problem) => `${problem.path}: ${problem.message}`), ['src/data/home.json.cardImage: text "nails/gone" is not an image of the site\'s manifest']);
});

test("API: the editor gets addresses and sends addresses; the draft, the publish and the file hold names; an upload goes into media.dir with the content", async () => {
  const home = { ...content, cardImage: "nails/nails-01" };
  const files = { "src/data/home.json": `${JSON.stringify(home, null, 2)}\n` };
  const config = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, media, collections: [], files: [{ key: "home", label: "Home", path: "src/data/home.json", format: "json", fields }] };
  const github = await startFakeGitHub({ owner: "o", name: "r", branch: "main", files });
  try {
    const store = createMediaStore({ bucket: createMemoryBucket(), settings: mediaSettings(media), now: () => new Date("2026-03-05T10:00:00Z") });
    const api = createCmsApi({
      config, source: createBundledSource(files), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_owner", role: "owner" }),
      publisher: createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url }), media: store, imageNames: names, siteImages: manifestImages(names),
    });
    const call = async (method, path, body) => (await api.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://localhost", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }))).json();
    const view = await call("GET", "/api/cms/files/home");
    assert.equal(view.content.cardImage, "/assets/img/nails/nails-01-1600.webp");
    assert.equal(view.content.hero.mobile, "/assets/img/nails/nails-01-1600.webp");
    assert.deepEqual((await call("GET", "/api/cms/media")).site.map((image) => image.name), ["nails/nails-01", "salon/salon-10"]);
    // An upload (staged in the bucket), chosen in the editor by its address.
    const staged = await store.stage({ bytes: tinyWebp(8, 6), fileName: "Chair.webp", userId: "usr_owner" });
    assert.match(staged.src, /^\/assets\/uploads\/2026\/03\/chair-[0-9a-f]{8}\.webp$/);
    const next = { ...view.content, cardImage: staged.src, strip: ["/assets/img/nails/nails-01-800.webp"] };
    const saved = await call("PUT", "/api/cms/files/home", { content: next, expectedRevision: 0, sourceVersion: view.version });
    assert.equal(saved.draft.revision, 1, JSON.stringify(saved));
    const uploadName = `uploads/${staged.src.slice("/assets/uploads/".length).replace(/\.webp$/, "")}`;
    assert.equal(saved.draft.content.cardImage, uploadName, "the draft holds the upload's name");
    assert.deepEqual(saved.draft.content.strip, ["nails/nails-01"], "any size of a site image is its name");
    // Reopened: addresses again (the upload from the bucket, until the build has it).
    const reopened = await call("GET", "/api/cms/files/home");
    assert.equal(reopened.draft.content.cardImage, staged.src);
    // An address the site does not know is refused, not stored.
    const refused = await call("PUT", "/api/cms/files/home", { content: { ...next, cardImage: "/images/elsewhere.jpg" }, expectedRevision: 1 });
    assert.equal(refused.error, "invalid_content");
    // Publish: the file holds names; the upload goes to media.dir in the same commit.
    const published = await call("POST", "/api/cms/publish", { resources: ["file:home"] });
    assert.ok(published.commitSha, JSON.stringify(published));
    const repoPath = `assets-src/images${staged.src.slice("/assets".length)}`;
    assert.deepEqual(published.media, [repoPath]);
    const written = JSON.parse(github.files()["src/data/home.json"]);
    assert.equal(written.cardImage, uploadName);
    assert.deepEqual(written.strip, ["nails/nails-01"]);
    assert.equal(written.hero.src, "salon/salon-10", "untouched values keep their names");
    assert.ok(Object.keys(github.files()).includes(repoPath));
  } finally { await github.close(); }
});
