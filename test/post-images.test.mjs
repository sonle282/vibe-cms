// M17: Mr Spa's "Images in this post" — `document.images` names the list that holds the body's images, in order. Under
// the body as its own section; the list follows the body, and a change made in the list (the description, ×) is made to
// the body's images. On a fake DOM (happy-dom) through the REAL CMS API, with an HTML body as Mr Spa's blog has.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, f } from "../dist/index.js";
import { adminBoot, startAdmin } from "../dist/admin/index.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PLACEHOLDER = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20800%20800'%3E%3C/svg%3E";
const article = {
  slug: "first-post", title: "First post", status: "published",
  contentHtml: '<p>One</p><img src="/a.jpg" alt="Chair"><p>Two</p><img src="/b.jpg" alt="">',
  contentImages: [{ src: "/a.jpg", alt: "Chair", caption: "In the showroom" }, { src: "/b.jpg", alt: "" }],
};
const collection = (document) => ({
  key: "blogs", label: "Blog", itemLabel: "Post", layout: "document", document,
  store: { kind: "json-array", path: "src/data/blog.json", idField: "slug" },
  status: { field: "status", live: "published", draft: "draft" },
  fields: {
    title: f.text({ label: "Title", required: true }),
    contentHtml: f.richText({ label: "Article content" }),
    contentImages: f.list(f.image({ label: "Content image", alt: true, caption: true }), { label: "Images in this post", itemLabel: "Content image", ordered: true }),
  },
});
const config = { configVersion: 1, site: { name: "Demo", url: "https://demo.example" }, repo: { owner: "acme", name: "demo", branch: "main" }, files: [], collections: [collection({ title: "title", body: "contentHtml", images: "contentImages" })] };

test("M17 config: document.images is a list of images next to a formatted body", () => {
  const problems = (document, fields) => checkCmsConfig({ ...config, collections: [{ ...collection(document), ...(fields ? { fields: { ...collection(document).fields, ...fields } } : {}) }] }).errors.map((entry) => `${entry.path}: ${entry.message}`);
  assert.deepEqual(problems({ title: "title", body: "contentHtml", images: "contentImages" }), []);
  assert.deepEqual(problems({ title: "title", body: "contentHtml", images: "title" }), ['collections[0].document.images: "title" is not a list of images next to the body']);
  assert.deepEqual(problems({ title: "title", body: "contentHtml", images: "contentImages" }, { contentImages: f.list(f.text({ label: "T" }), { label: "L" }) }), ['collections[0].document.images: "contentImages" is not a list of images next to the body']);
  assert.deepEqual(problems({ title: "title", body: "title", plain: true, images: "contentImages" }), ["collections[0].document.images: is for a body of formatted HTML text"]);
});

const open = async (post) => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const user = { userId: "usr_owner", role: "owner" };
  const drafts = createMemoryDraftStore();
  const api = createCmsApi({ config, source: createBundledSource({ "src/data/blog.json": `${JSON.stringify([post], null, 2)}\n` }), drafts, audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, storage: null, confirm: () => true });
  await app.ready;
  await app.go(`/admin/catalog/blogs/${post.slug}`); await settle(); await app.idle();
  return { window, root, drafts };
};

test("M17 the editor: Images in this post under the body; the list follows the body and the body follows the list", async () => {
  assert.deepEqual(checkCmsConfig(config).errors, []);
  const { window, root, drafts } = await open(article);

  const paper = root.querySelector(".vc-doc-paper");
  const section = paper.querySelector(".vc-doc-images");
  assert.ok(section, "a section on the paper");
  assert.equal(section.querySelector("h2").textContent, "Images in this post");
  assert.ok(section.compareDocumentPosition(paper.querySelector(".vc-doc-body")) & window.Node.DOCUMENT_POSITION_PRECEDING, "under the body");
  assert.equal(root.querySelector(".vc-record-side [data-path='contentImages']"), null, "not in Post details");
  assert.ok([...section.querySelectorAll(".vc-add")].every((button) => button.hidden), "new images go in through the article (where the cursor is)");
  const area = paper.querySelector(".vc-doc-body [contenteditable]");
  const bodyImages = () => [...area.querySelectorAll("img")].map((image) => [image.getAttribute("src"), image.getAttribute("alt")]);
  const cardAlts = () => [...section.querySelectorAll(".vc-image-alt input")].map((input) => input.value);

  // The list → the body: a description typed under a card is the image's alt in the article.
  const second = section.querySelectorAll(".vc-image-alt input")[1];
  second.value = "Pedicure station"; second.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle();
  assert.deepEqual(bodyImages(), [["/a.jpg", "Chair"], ["/b.jpg", "Pedicure station"]]);

  // The body → the list: an image taken out of the text leaves the list (the other one keeps its caption).
  area.querySelector('img[src="/a.jpg"]').remove();
  area.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle();
  assert.deepEqual(cardAlts(), ["Pedicure station"]);

  // Saved together: the draft's list is the body's images.
  [...root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  let draft;
  for (let i = 0; i < 300 && !draft; i += 1) { draft = await drafts.get("usr_owner", "item:blogs:first-post"); if (!draft) await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.ok(draft, "the draft is saved");
  const content = draft.content;
  assert.deepEqual(content.contentImages, [{ src: "/b.jpg", alt: "Pedicure station" }]);
  assert.doesNotMatch(content.contentHtml, /a\.jpg/);
  assert.match(content.contentHtml, /<img src="\/b\.jpg" alt="Pedicure station">/);
});

test("M17 an imported post whose list holds the old website's placeholders: a description typed changes only that image's alt", async () => {
  const imported = { ...article, slug: "imported", contentImages: [{ src: PLACEHOLDER, alt: "Chair" }, { src: PLACEHOLDER, alt: "" }] };
  const { window, root } = await open(imported);
  const area = root.querySelector(".vc-doc-body [contenteditable]");
  const second = root.querySelectorAll(".vc-doc-images .vc-image-alt input")[1];
  second.value = "Pedicure station"; second.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle();
  assert.deepEqual([...area.querySelectorAll("img")].map((image) => [image.getAttribute("src"), image.getAttribute("alt")]), [["/a.jpg", "Chair"], ["/b.jpg", "Pedicure station"]], "the article keeps its real images");
  // An edit of the text then puts the real images in the list.
  area.querySelector("p").textContent = "One, edited";
  area.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle();
  assert.deepEqual([...root.querySelectorAll(".vc-doc-images .vc-image-name")].map((name) => name.getAttribute("title")), ["a.jpg", "b.jpg"]);
});
