// M10: the Mr Spa CMS's Blog post / Policy editor (`layout: "document"`) on a fake DOM (happy-dom) through the REAL CMS
// API — the paper (the formatting bar on top, the cover, the large title, the text; a policy: plain text and its word
// count), and on the right "On the website", "Post details" / "Page details" (Web address), "In Google" and "Ready to
// publish".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { checkCmsConfig, contentPaths, createBundledSource, createCmsApi, createMemoryAuditLog, createMemoryDraftStore, loadCmsConfig } from "../dist/index.js";
import { adminBoot, excerptOf, googlePath, linkProblem, plainTextOf, startAdmin, stringsIn, wordCount } from "../dist/admin/index.js";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (check, what) => { for (let i = 0; i < 300; i += 1) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };

const shell = async () => {
  const window = new Window({ url: "http://localhost/admin", settings: { disableIframePageLoading: true } });
  const drafts = createMemoryDraftStore();
  const user = { userId: "usr_owner", role: "owner" };
  const api = createCmsApi({ config, source: createBundledSource(files), drafts, audit: createMemoryAuditLog(), identify: () => user });
  const fetch = async (url, init = {}) => api.handle(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost" } }));
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const app = startAdmin({ root, boot: adminBoot(config, { id: user.userId, username: "owner", displayName: "Owner", role: "owner" }), fetch, window, storage: null, confirm: () => true });
  await app.ready;
  const go = async (path) => { await app.go(path); await settle(); await app.idle(); };
  const side = () => root.querySelector(".vc-record-side");
  const cards = () => [...side().querySelectorAll(".vc-record-side-card")].filter((card) => !card.hidden).map((card) => card.querySelector("h2").textContent);
  const google = () => [".vc-doc-google-path", ".vc-doc-google-title", ".vc-doc-google-text"].map((selector) => side().querySelector(selector).textContent);
  const ready = () => [...side().querySelectorAll(".vc-publish-check")].map((button) => [button.childNodes[1].textContent, button.hasAttribute("data-done")]);
  const readyTitle = () => side().querySelectorAll(".vc-record-side-card")[3].querySelector("h2").textContent;
  const type = (element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); };
  return { window, root, drafts, go, side, cards, google, ready, readyTitle, type };
};

test("M10 config: layout \"document\" and its document: { title, body, cover, plain } are checked", () => {
  const problems = (key, change) => checkCmsConfig({
    ...config,
    files: config.files.map((file) => (file.key === key ? { ...file, ...change } : file)),
    collections: config.collections.map((collection) => (collection.key === key ? { ...collection, ...change } : collection)),
  }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(problems("posts", {}), []);
  assert.deepEqual(problems("posts", { document: undefined }), ['collections[2].document: required with layout "document" — which fields are the title and the body']);
  assert.deepEqual(problems("posts", { document: { title: "tags", body: "body" } }), ['collections[2].document.title: "tags" is not a text field']);
  assert.deepEqual(problems("posts", { document: { title: "title", body: "title" } }), ["collections[2].document.body: the paper holds formatted text: use a richText field"]);
  assert.deepEqual(problems("posts", { document: { title: "title", body: "body", cover: "title", size: 1 } }), ["collections[2].document.size: unknown setting", 'collections[2].document.cover: "title" is not an image field']);
  assert.deepEqual(problems("posts", { layout: "page" }), ['collections[2].document: is only for layout "document"']);
  assert.deepEqual(problems("privacy", { document: { title: "title", body: "nope", plain: true } }), ['files[3].document.body: "nope" is not a field']);
  assert.deepEqual(problems("site", { layout: "document", document: { title: "name", body: "hero", plain: true } }), ["files[0].document.body: plain text is a text field or a list of sections"]);
});

test("M10 helpers: word count (no thousands separator), Google's text and address, Add link's rule", () => {
  const { document } = new Window();
  assert.equal(wordCount(["One"]), "1 word");
  assert.equal(wordCount(["Privacy  policy", "", Array(1234).fill("w").join(" ")]), "1236 words");
  assert.deepEqual(stringsIn({ a: "x", b: [{ c: "y" }, 3] }), ["x", "y"]);
  assert.equal(plainTextOf(document, "<p>Hi <strong>there</strong>&nbsp;&amp; you</p><p>Next<br>line</p><script>x()</script>", false), "Hi there & you Next line x()");
  assert.equal(plainTextOf(document, "## Hours\n\nNew **body** [text](/a) ![x](/b.webp)\n\n- one\n", true), "Hours New body text one");
  assert.equal(excerptOf("a".repeat(220)), "a".repeat(220));
  assert.equal(excerptOf(`${"a".repeat(217)} bcd`), `${"a".repeat(217)}…`);
  assert.equal(excerptOf(`${"a".repeat(216)}  bcde`), `${"a".repeat(216)}…`, "no space before …");
  assert.equal(googlePath("demo.example", "/blog/welcome/"), "demo.example › blog › welcome");
  assert.deepEqual(["", "http://x.com", "https://x.com/a", "nope"].map((url) => linkProblem("", url)), ["Choose a page or enter an HTTPS URL.", "Use a valid HTTPS URL.", null, "Use a valid HTTPS URL."]);
  assert.equal(linkProblem("/team/", ""), null, "a page wins");
});

test("M10 blog post (Mr Spa): the paper — bar, cover, title, text — and Post details / In Google / Ready on the right", async () => {
  const h = await shell();
  await h.go("/admin/catalog/posts/welcome");
  assert.equal(h.root.querySelector(".vc-preview"), null, "no page on the canvas");
  assert.equal(h.root.querySelector('[data-path="status"]'), null, "no Status box");
  const paper = h.root.querySelector(".vc-doc-paper");
  // The bar is on top of the paper (sticky), the Mr Spa set with Insert image.
  assert.equal(paper.firstElementChild.className, "vc-rich-toolbar");
  assert.deepEqual([...paper.firstElementChild.querySelectorAll("button")].map((button) => button.textContent), ["Paragraph", "Heading 2", "Heading 3", "B", "I", "Bulleted list", "Numbered list", "Add link", "Insert image"]);
  assert.deepEqual([...paper.querySelectorAll(".vc-form > .vc-field")].map((box) => box.dataset.path), ["cover", "title", "body"]);
  const title = paper.querySelector("textarea.vc-doc-title");
  assert.deepEqual([title.value, title.placeholder, String(title.rows)], ["Welcome to the demo blog", "", "1"]);
  assert.equal(paper.querySelector('[data-path="title"] .vc-label').classList.contains("vc-sr-only"), true);
  const enter = new h.window.KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  title.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true, "the title stays one line");
  assert.equal(paper.querySelector(".vc-doc-paste").textContent, "Pasting keeps text only; HTML code is not accepted.");
  assert.equal(h.root.querySelector(".vc-record-required").textContent, "* Required before you can publish");
  // The right column.
  assert.equal(h.side().getAttribute("aria-label"), "Post details");
  assert.deepEqual(h.cards(), ["On the website", "Post details", "In Google", "Ready to publish"]);
  const details = h.side().querySelector(".vc-doc-details");
  assert.deepEqual([...details.children].map((box) => box.dataset.path ?? box.querySelector("label").textContent), ["tags", "Web address"]);
  const address = details.querySelector(".vc-doc-address input");
  assert.deepEqual([address.value, address.readOnly, details.querySelector(".vc-doc-address .vc-help").textContent], ["/blog/welcome", true, "Fixed so existing links keep working."]);
  assert.deepEqual(h.google(), ["demo.example › blog › welcome", "Welcome to the demo blog | Demo Salon", "This post is invented. It exists so the CMS has a Markdown record to edit."]);
  assert.equal(h.side().querySelector(".vc-doc-google + .vc-help").textContent, "Worked out from the title and the first lines of the post.");
  assert.deepEqual(h.ready(), [["Title", true], ["No errors", true]]);
  // Typing follows: Google's title, and an empty title is "Untitled post" there and a to-do.
  h.type(title, "");
  assert.equal(h.google()[1], "Untitled post | Demo Salon");
  assert.equal(h.readyTitle(), "Before you publish · 2 to do");
  h.type(title, "Hello again");
  assert.equal(h.google()[1], "Hello again | Demo Salon");
  assert.equal(h.side().querySelector(".vc-record-side-note").textContent, "You have unsaved changes. The website still shows the last published version.");
});

test("M10 a new post (Mr Spa): “Give the post a title”, the Web address follows the title until it is shortened, Page address to do", async () => {
  const h = await shell();
  await h.go("/admin/catalog/posts/new");
  const title = h.root.querySelector("textarea.vc-doc-title");
  assert.equal(title.placeholder, "Give the post a title");
  const address = h.side().querySelector(".vc-doc-address input");
  assert.deepEqual([address.value, address.readOnly, h.side().querySelector(".vc-doc-address .vc-help").textContent], ["/blog/", false, "Filled in from the title. You can shorten it; it can't be changed after publishing."]);
  assert.deepEqual(h.ready(), [["Title", false], ["Page address", false], ["No errors", false]]);
  h.type(title, "Hello World, Again!");
  assert.equal(address.value, "/blog/hello-world-again");
  assert.equal(h.google()[0], "demo.example › blog › hello-world-again");
  assert.deepEqual(h.ready(), [["Title", true], ["Page address", true], ["No errors", true]]);
  // Shortened by hand: the title no longer changes it.
  address.focus();
  h.type(address, "/blog/Hello");
  address.dispatchEvent(new h.window.Event("change"));
  assert.equal(address.value, "/blog/hello");
  address.blur();
  h.type(title, "Hello World, once more");
  assert.equal(address.value, "/blog/hello");
  [...h.root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  await until(() => h.window.location.pathname === "/admin/catalog/posts/hello", "the new post's address");
  const draft = await h.drafts.get("usr_owner", "item:posts:hello");
  assert.deepEqual([draft.content.slug, draft.content.title, draft.content.status], ["hello", "Hello World, once more", "published"], "Publish puts it on the website");
});

test("M10 policy (Mr Spa): plain text on the paper, the sections stay as they are, the word count, Page details / In Google / Ready", async () => {
  const h = await shell();
  await h.go("/admin/pages/privacy");
  const paper = h.root.querySelector(".vc-doc-paper.is-plain");
  assert.ok(paper);
  assert.equal(paper.querySelector(".vc-rich-toolbar"), null, "no formatting bar");
  assert.equal(paper.querySelector(".vc-doc-paste"), null);
  const privacy = JSON.parse(files["src/data/privacy.json"]);
  const bar = paper.querySelector(".vc-doc-bar");
  assert.equal(bar.firstElementChild.textContent, "Plain text · the sections stay as they are");
  assert.equal(bar.querySelector(".vc-doc-count").textContent, wordCount([privacy.title, ...stringsIn(privacy.sections)]));
  assert.equal(paper.querySelector("textarea.vc-doc-title").placeholder, "Title");
  assert.equal(paper.querySelector('[data-path="sections"] .vc-add'), null, "no sections added or removed");
  // The right column: a page is Live; its fixed address.
  assert.equal(h.side().getAttribute("aria-label"), "Page details");
  assert.deepEqual(h.cards(), ["On the website", "Page details", "In Google", "Ready to publish"]);
  assert.deepEqual([h.side().querySelector(".vc-content-status").textContent, h.side().querySelector(".vc-record-side-url").textContent], ["Live", "demo.example/privacy"]);
  assert.equal(h.side().querySelector(".vc-doc-address input").value, "demo.example/privacy");
  assert.deepEqual(h.google().slice(0, 2), ["demo.example › privacy", "Privacy policy | Demo Salon"]);
  assert.equal(h.side().querySelector(".vc-doc-google + .vc-help").textContent, "Worked out from the title and the first lines of the page.");
  assert.deepEqual(h.ready(), [["No empty section", true], ["No errors", true]], "Mr Spa: a policy's title may be empty");
  assert.equal(h.root.querySelector(".vc-record-required"), null, "nothing required: no hint");
  // Emptying a section: a to-do; the count follows.
  h.type(paper.querySelector('[data-path="sections[1].heading"] input'), "");
  for (const box of paper.querySelectorAll('[data-path^="sections[1].paragraphs"] textarea')) h.type(box, "");
  assert.deepEqual(h.ready(), [["No empty section", false], ["No errors", true]]);
  assert.equal(h.readyTitle(), "Before you publish · 1 to do");
  assert.equal(bar.querySelector(".vc-doc-count").textContent, wordCount([privacy.title, ...stringsIn(privacy.sections[0])]));
});

test("M10 saving a post that is a draft on the website: Publish will put it on the website, and nothing is left unsaved", async () => {
  const h = await shell();
  await h.go("/admin/catalog/posts/spring-colours");
  h.type(h.root.querySelector("textarea.vc-doc-title"), "Spring colours");
  [...h.root.querySelectorAll(".vc-actions button")].find((button) => button.textContent === "Save draft").click();
  await until(() => /^Draft saved/.test(h.root.querySelector(".vc-state-long")?.textContent ?? ""), "the saved draft");
  assert.equal((await h.drafts.get("usr_owner", "item:posts:spring-colours")).content.status, "published");
});
