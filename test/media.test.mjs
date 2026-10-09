// P10: images — the real type from the bytes, the staging store (R2 in memory), the upload / list API, the preview
// route, and publishing: uploads the content uses go into the same commit with their exact bytes (fake GitHub only).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMediaStore, createMemoryAuditLog, createMemoryBucket, createMemoryDraftStore, detectImage, loadCmsConfig, mediaSettings, uploadPathsIn, uploadSlug } from "../dist/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";
import { tinyPng, tinyWebp } from "./helpers/images.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let demoFiles;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  demoFiles = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});

const at = () => new Date("2026-03-05T10:00:00Z");
const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);

test("detectImage: the type and size come from the bytes, never the name; SVG is not an image here", () => {
  assert.deepEqual(detectImage(tinyPng(3, 2)), { kind: "png", mime: "image/png", ext: "png", width: 3, height: 2 });
  assert.deepEqual(detectImage(tinyWebp(640, 480)), { kind: "webp", mime: "image/webp", ext: "webp", width: 640, height: 480 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0]);
  assert.deepEqual(detectImage(jpeg), { kind: "jpeg", mime: "image/jpeg", ext: "jpg", width: 30, height: 20 });
  assert.equal(detectImage(gif)?.kind, "gif");
  assert.equal(detectImage(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypavif"), 0, 0, 0, 0]))?.kind, "avif");
  assert.equal(detectImage(svg), undefined);
  assert.equal(detectImage(new TextEncoder().encode("<html>")), undefined);
  assert.equal(detectImage(new Uint8Array()), undefined);
});

test("upload names: slug of the file name + the first 8 hex of its sha256, under the month; paths found in any text", () => {
  assert.equal(uploadSlug("Hội Sơn — Spa Đẹp.JPG"), "hoi-son-spa-dep");
  assert.equal(uploadSlug("..."), "image");
  assert.equal(uploadSlug(`${"a".repeat(70)}.png`).length, 60);
  assert.deepEqual(mediaSettings(undefined), { dir: "public/assets/uploads", base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 });
  assert.deepEqual(mediaSettings({ dir: "public/media", maxBytes: 1000 }), { dir: "public/media", base: "/media", maxBytes: 1000 });
  const text = `{"src":"/assets/uploads/2026/03/chair-0123abcd.webp"} <img src="/assets/uploads/2026/03/chair-0123abcd.webp"> ![x](/assets/uploads/2025/12/a-b-ffffffff.png) /assets/uploads/2026/13/x-00000000.webp /assets/uploads/2026/03/X-00000000.webp /images/a.webp`;
  assert.deepEqual(uploadPathsIn(text, "/assets/uploads"), ["/assets/uploads/2026/03/chair-0123abcd.webp", "/assets/uploads/2025/12/a-b-ffffffff.png"]);
});

test("store: stage → named path, metadata, dedupe by bytes; refuses empty, too large, GIF, SVG, HTML", async () => {
  const bucket = createMemoryBucket();
  const store = createMediaStore({ bucket, settings: mediaSettings({ maxBytes: 5000 }), now: at });
  const png = tinyPng(4, 3);
  const first = await store.stage({ bytes: png, fileName: "Front Desk.png", userId: "usr_a" });
  assert.match(first.src, /^\/assets\/uploads\/2026\/03\/front-desk-[0-9a-f]{8}\.png$/);
  assert.deepEqual([first.width, first.height, first.bytes, first.type, first.reused, first.uploadedBy], [4, 3, png.length, "image/png", false, "usr_a"]);
  const again = await store.stage({ bytes: png, fileName: "other name.png", userId: "usr_b" });
  assert.equal(again.src, first.src);
  assert.equal(again.reused, true);
  assert.equal(bucket.keys().filter((key) => key.startsWith("staging/")).length, 1, "the same bytes are kept once");
  // A WebP made in the browser: its size comes from the header even when the request says otherwise.
  const webp = await store.stage({ bytes: tinyWebp(1200, 800), fileName: "chair.webp", userId: "usr_a", width: 1, height: 1 });
  assert.deepEqual([webp.width, webp.height], [1200, 800]);
  for (const [bytes, code, status] of [[new Uint8Array(), "empty_file", 400], [new Uint8Array(6000).fill(1), "image_too_large", 413], [gif, "unsupported_image", 415], [svg, "unsupported_image", 415], [new TextEncoder().encode("<!doctype html><script>x</script>"), "unsupported_image", 415]]) {
    await assert.rejects(store.stage({ bytes, fileName: "x.png", userId: "usr_a" }), (error) => error.code === code && error.status === status, code);
  }
  const listed = await store.list();
  assert.deepEqual(listed.images.map((image) => image.src).sort(), [first.src, webp.src].sort());
  assert.equal(listed.images.find((image) => image.src === webp.src).width, 1200);
});

test("store: serve only strict upload paths, with the real type and a sandboxing CSP", async () => {
  const bucket = createMemoryBucket();
  const store = createMediaStore({ bucket, settings: mediaSettings(), now: at });
  const staged = await store.stage({ bytes: tinyPng(2, 2), fileName: "a.png", userId: "usr_a" });
  const served = await store.serve(staged.src);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.match(served.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), tinyPng(2, 2));
  // Bytes put under a staging key some other way are still checked before they are served.
  await bucket.put("staging/assets/uploads/2026/03/evil-00000000.png", "<script>alert(1)</script>");
  for (const path of ["/assets/uploads/2026/03/evil-00000000.png", "/assets/uploads/../../upload-index/x", "/assets/uploads/2026/03/a.png", "/assets/uploads/2026/03/a-12345678.svg", "/other/2026/03/a-12345678.png", staged.src.replace(".png", ".webp")]) {
    assert.equal((await store.serve(path)).status, 404, path);
  }
});

/** api.handle in Node with an in-memory bucket and the fake GitHub. */
const harness = async ({ limiter, maxBytes } = {}) => {
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files: demoFiles });
  const bucket = createMemoryBucket();
  const media = createMediaStore({ bucket, settings: mediaSettings({ maxBytes }), now: at });
  const drafts = createMemoryDraftStore(); const audit = createMemoryAuditLog();
  const publisher = createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url });
  const identify = (request) => { const value = request.headers.get("x-test-user"); if (!value) return null; const [userId, role] = value.split(":"); return { userId, role }; };
  const build = (extra = {}) => createCmsApi({ config, source: createBundledSource({ ...github.files() }), drafts, audit, publisher, identify, media, siteImages: [{ src: "/images/hero.svg", bytes: 120 }], publishLimiter: limiter, ...extra });
  let api = build();
  const call = async (method, path, { user = "usr_a:owner", body, bytes, headers = {}, origin = "http://localhost", init: extra = {} } = {}) => {
    const init = { ...extra, method, headers: { ...(user ? { "x-test-user": user } : {}), ...(origin ? { origin } : {}), ...headers } };
    if (bytes) { init.body = bytes; init.headers["content-type"] ??= "image/webp"; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    const response = await api.handle(new Request(`http://localhost${path}`, init));
    return { status: response.status, body: await response.json() };
  };
  const upload = (bytes, name = "photo.webp", options = {}) => call("POST", "/api/cms/media", { bytes, headers: { "x-file-name": encodeURIComponent(name), ...(options.headers ?? {}) }, ...options });
  /** Save a draft of team member alex with this photo. */
  const draftPhoto = async (src, user = "usr_a:owner") => {
    const item = (await call("GET", "/api/cms/collections/team/items/alex", { user })).body;
    return call("PUT", "/api/cms/collections/team/items/alex", { user, body: { content: { ...item.content, photo: { src, alt: "Alex at work" } }, expectedRevision: item.draft?.revision ?? 0, sourceVersion: item.version } });
  };
  return { github, bucket, media, call, upload, draftPhoto, rebuild: (extra) => { api = build(extra); }, redeploy: () => { api = build(); }, close: () => github.close() };
};

test("API: upload (signed in, same site) → 201 with the path; the same bytes → 200 reused; list = uploads + site images", async () => {
  const h = await harness();
  try {
    const bytes = tinyWebp(800, 600);
    const created = await h.upload(bytes, "Nail Chair.webp");
    assert.equal(created.status, 201);
    assert.match(created.body.image.src, /^\/assets\/uploads\/2026\/03\/nail-chair-[0-9a-f]{8}\.webp$/);
    assert.equal((await h.upload(bytes, "copy.webp")).status, 200);
    const list = await h.call("GET", "/api/cms/media", { user: "usr_b:editor" });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.uploads.map((image) => image.src), [created.body.image.src]);
    assert.deepEqual(list.body.site, [{ src: "/images/hero.svg", bytes: 120 }]);
    assert.deepEqual([list.body.uploadsEnabled, list.body.base], [true, "/assets/uploads"]);
    // Not signed in / another site / not an image.
    assert.equal((await h.upload(bytes, "x.webp", { user: null })).status, 401);
    assert.equal((await h.upload(bytes, "x.webp", { origin: "https://evil.example" })).body.error, "origin_forbidden");
    assert.equal((await h.upload(bytes, "x.webp", { origin: null })).body.error, "origin_forbidden");
    const refused = await h.upload(svg, "logo.webp", { headers: { "content-type": "image/webp" } });
    assert.deepEqual([refused.status, refused.body.error], [415, "unsupported_image"]);
    // A file name that is not valid percent-encoding is just "image".
    const odd = await h.call("POST", "/api/cms/media", { bytes: tinyPng(1, 1), headers: { "x-file-name": "%E0%A4%A" } });
    assert.match(odd.body.image.src, /\/image-[0-9a-f]{8}\.png$/);
  } finally { await h.close(); }
});

test("API: too large → 413 before reading; rate limited per person → 429; no bucket → 503 media_not_configured (list still works)", async () => {
  const keys = [];
  let allow = true;
  const h = await harness({ maxBytes: 2000, limiter: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } });
  try {
    const big = await h.upload(new Uint8Array(3000), "big.webp");
    assert.deepEqual([big.status, big.body.error], [413, "image_too_large"]);
    // No content-length (a stream): still stopped at maxBytes.
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 5; i += 1) controller.enqueue(new Uint8Array(1000)); controller.close(); } });
    const chunked = await h.call("POST", "/api/cms/media", { bytes: stream, headers: { "x-file-name": "big.webp" }, init: { duplex: "half" } });
    assert.deepEqual([chunked.status, chunked.body.error], [413, "image_too_large"]);
    allow = false;
    const limited = await h.upload(tinyWebp(10, 10), "a.webp");
    assert.deepEqual([limited.status, limited.body.error], [429, "too_many_uploads"]);
    assert.deepEqual(keys, ["cms-media:usr_a", "cms-media:usr_a", "cms-media:usr_a"]);
    h.rebuild({ media: undefined, publishLimiter: undefined });
    const missing = await h.upload(tinyWebp(10, 10), "a.webp");
    assert.deepEqual([missing.status, missing.body.error], [503, "media_not_configured"]);
    const list = await h.call("GET", "/api/cms/media");
    assert.deepEqual([list.status, list.body.uploadsEnabled, list.body.uploads.length, list.body.site.length], [200, false, 0, 1]);
  } finally { await h.close(); }
});

test("publish: an upload the draft uses goes into the same commit with its exact bytes; next time it is already there", async () => {
  const h = await harness();
  try {
    const bytes = tinyWebp(1200, 900);
    const { image } = (await h.upload(bytes, "alex.webp")).body;
    assert.equal((await h.draftPhoto(image.src)).status, 200);
    const before = h.github.head();
    const published = await h.call("POST", "/api/cms/publish", { body: { resources: ["item:team:alex"] } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const repoPath = `public${image.src}`;
    assert.deepEqual(published.body.media, [repoPath]);
    assert.deepEqual(h.github.changedPaths(before).sort(), [repoPath, "src/data/team.json"].sort(), "one commit: the record + the image");
    assert.equal(h.github.commitsSince(before).length, 1);
    assert.deepEqual(new Uint8Array(h.github.bytes(repoPath)), bytes, "exact bytes, not text");
    assert.match(h.github.files()["src/data/team.json"], new RegExp(image.src.replace(/[./]/g, "\\$&")));
    // Again, with the image now on the branch: only the text changes.
    h.redeploy();
    const item = (await h.call("GET", "/api/cms/collections/team/items/alex")).body;
    await h.call("PUT", "/api/cms/collections/team/items/alex", { body: { content: { ...item.content, name: "Alex E." }, expectedRevision: 0, sourceVersion: item.version } });
    const second = h.github.head();
    const again = await h.call("POST", "/api/cms/publish", { body: { resources: ["item:team:alex"] } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.media, []);
    assert.deepEqual(h.github.changedPaths(second), ["src/data/team.json"]);
  } finally { await h.close(); }
});

test("publish: an upload path that is neither staged nor in the repo → 409 media_missing, nothing committed", async () => {
  const h = await harness();
  try {
    const ghost = "/assets/uploads/2026/03/ghost-0badc0de.webp";
    await h.draftPhoto(ghost);
    const before = h.github.head();
    const refused = await h.call("POST", "/api/cms/publish", { body: { resources: ["item:team:alex"] } });
    assert.deepEqual([refused.status, refused.body.error, refused.body.paths], [409, "media_missing", [ghost]]);
    assert.equal(h.github.head(), before);
    // Already in the repository (put there by someone else) → fine, nothing re-uploaded.
    h.github.pushOther({ [`public${ghost}`]: Buffer.from(tinyWebp(5, 5)) }, "add an image by hand");
    h.redeploy();
    const ok = await h.call("POST", "/api/cms/publish", { body: { resources: ["item:team:alex"] } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.media, []);
  } finally { await h.close(); }
});

test("rich text and Markdown bodies count too: an <img> in a post body is committed with the post", async () => {
  const h = await harness();
  try {
    const { image } = (await h.upload(tinyPng(6, 4), "inline.png")).body;
    const posts = (await h.call("GET", "/api/cms/collections/posts")).body;
    const slug = posts.items[0].id;
    const item = (await h.call("GET", `/api/cms/collections/posts/items/${slug}`)).body;
    const saved = await h.call("PUT", `/api/cms/collections/posts/items/${slug}`, { body: { content: { ...item.content, body: `${item.content.body}\n\n![Inline](${image.src})\n` }, expectedRevision: 0, sourceVersion: item.version } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const published = await h.call("POST", "/api/cms/publish", { body: { resources: [`item:posts:${slug}`] } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual(published.body.media, [`public${image.src}`]);
  } finally { await h.close(); }
});

test("the site's own images (built into the admin): every image under public/, with pixels when the header says", async () => {
  const { siteImages } = await import("../dist/integration.js");
  assert.deepEqual(siteImages(demoRoot).map((image) => image.src), ["/images/hero.svg", "/images/team-alex.svg", "/images/team-sam.svg"]);
  assert.ok(siteImages(demoRoot).every((image) => image.bytes > 0));
  assert.equal(siteImages(demoRoot, 1).length, 1);
  assert.deepEqual(siteImages(join(demoRoot, "missing")), []);
});
