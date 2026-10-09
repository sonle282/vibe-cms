// P8d: the visual editor — cleaning what editing commands and pasted / loaded HTML leave behind, Markdown in and out
// (the post's own style, sized images as HTML, posts the editor cannot keep open as Markdown), and the editor on a fake
// DOM (happy-dom has no editing commands, so typing is simulated by setting the HTML and firing "input"; the real
// commands, dragging and pasting run in headless Chrome in scripts/e2e.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { cleanRichDom, createRichEditor, isEmptyRich, normalizeBlocks } from "../dist/admin/index.js";
import * as markdown from "../dist/admin/markdown.js";
import { RICH_TEXT_SCHEMA } from "../dist/check/rich-text.js";
import { RICH_TEXT_TAGS } from "../dist/check/rich-text-allow.js";

const dom = () => { const window = new Window({ url: "http://localhost/admin" }); return { window, document: window.document }; };
const box = (document, html) => { const div = document.implementation.createHTMLDocument("").createElement("div"); div.innerHTML = html; return div; };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const loadMarkdown = async () => markdown;

test("the browser cleaner and the server sanitizer use one allow-list", () => {
  assert.deepEqual(RICH_TEXT_SCHEMA.tagNames, RICH_TEXT_TAGS);
  assert.deepEqual(RICH_TEXT_SCHEMA.attributes["*"], ["className", "title"]);
  assert.deepEqual(RICH_TEXT_SCHEMA.attributes.img, ["alt", "height", "loading", "src", "width"]);
});

test("clean: editing-command tags become the kept ones; scripts, handlers, styles and unsafe links go", () => {
  const { document } = dom();
  const html = (input, options) => cleanRichDom(box(document, input), options).innerHTML;
  assert.equal(html('<p><b>B</b> <i>I</i> <span style="color:red">plain</span> <font face="x">f</font></p>'), "<p><strong>B</strong> <em>I</em> plain f</p>");
  assert.equal(html('<p onclick="x()" style="a:b" class="lead" id="z">t</p>'), '<p class="lead">t</p>');
  assert.equal(html('<p>a<script>alert(1)</script><style>p{}</style><iframe src="/x"></iframe>b</p>'), "<p>ab</p>");
  assert.equal(html('<a href="javascript:alert(1)">x</a><a href=" JaVa\tScript:alert(1)">y</a><a href="/ok" target="_blank" rel="noopener">z</a><a href="mailto:a@example.com">m</a>'), '<a>x</a><a>y</a><a href="/ok" target="_blank" rel="noopener">z</a><a href="mailto:a@example.com">m</a>');
  assert.equal(html('<img src="data:image/png;base64,AAAA" alt="d"><img src="x" onerror="alert(1)" width="300" height="200" alt="ok">'), '<img alt="d"><img src="x" width="300" height="200" alt="ok">');
  assert.equal(html("<h1>T</h1><h4>t</h4><!-- c --><table><tr><td>1</td></tr></table>"), "Tt1", "HTML: only the allowed tags, text kept");
  assert.equal(html('<h1>T</h1><del>d</del><s>s</s><input type="checkbox" checked disabled><input type="text" value="x"><td align="left">1</td>', { markdown: true }), '<h1>T</h1><del>d</del><del>s</del><input type="checkbox" checked="" disabled="">1', "Markdown mode keeps what Markdown writes");
  assert.equal(isEmptyRich(box(document, "<p><br></p><p> </p>")), true);
  assert.equal(isEmptyRich(box(document, '<p><img src="/a.webp"></p>')), false);
});

test("normalize: blocks lifted out of paragraphs, loose text wrapped, empty paragraphs and no-break spaces gone", () => {
  const { document } = dom();
  const norm = (input, options) => normalizeBlocks(box(document, input), options).innerHTML;
  assert.equal(norm('<p>Intro</p><p><ul><li>one</li></ul><p><img src="/a.webp"></p></p>'), '<p>Intro</p><ul><li>one</li></ul><p><img src="/a.webp"></p>');
  assert.equal(norm("<p>a <strong>b</strong> c</p><p><br></p><h2>T<br></h2>"), "<p>a <strong>b</strong> c</p><h2>T</h2>");
  assert.equal(norm("Loose <em>text</em><ul><li>x</li></ul>tail"), "<p>Loose <em>text</em></p><ul><li>x</li></ul><p>tail</p>");
  assert.equal(norm("Just text, no blocks"), "Just text, no blocks", "HTML without blocks stays inline");
  assert.equal(norm("Just text", { wrapLoose: true }), "<p>Just text</p>", "Markdown: always paragraphs");
});

test("markdown: the post's own style is kept; a sized image is HTML; posts the editor cannot keep are detected", () => {
  const { document } = dom();
  const parse = (html) => cleanRichDom(box(document, html), { markdown: true });
  const roundTrip = (md) => markdown.htmlToMarkdown(parse(markdown.markdownToHtml(md)), markdown.markdownStyle(md));
  for (const md of [
    "This post is invented. It exists so the CMS has a **Markdown** record to edit.\n",
    "Hello **bold** and *it*.\n\n- a\n- b\n\n![Alt](/x.webp)\n",
    "Text and _em_ and __strong__.\n\n* one\n* two\n",
    "## Title\n\n1. first\n2. second\n\n> quoted\n\n[link](https://example.com)\n",
    "Para <img src=\"/x.webp\" alt=\"a\" width=\"300\">\n",
    "```js\nconst a = 1 < 2;\n```\n",
    "No final newline",
  ]) assert.equal(roundTrip(md), md, JSON.stringify(md));
  assert.deepEqual(markdown.markdownStyle("* a\n\n_x_ __y__\n\n***\n"), { bullet: "*", strong: "_", emphasis: "_", rule: "-", fence: "`", listItemIndent: "one", finalNewline: true });
  // A resized image (width written by the editor) stays HTML; an image without a size stays Markdown.
  assert.equal(markdown.htmlToMarkdown(parse('<p>See <img src="/a.webp" alt="A chair" width="320" onerror="x"></p><p><img src="/b.webp" alt="B"></p>'), markdown.markdownStyle("")), 'See <img src="/a.webp" alt="A chair" width="320">\n\n![B](/b.webp)\n');
  assert.equal(markdown.canEditVisually("Plain **post**\n\n| a | b |\n| - | - |\n| 1 | 2 |\n", parse), true);
  assert.equal(markdown.canEditVisually('<div class="note">raw</div>\n\nAfter\n', parse), false, "raw HTML block");
  assert.equal(markdown.canEditVisually("Text[^1]\n\n[^1]: note\n", parse), false, "footnotes");
  assert.equal(markdown.canEditVisually("<script>alert(1)</script>\n", parse), false, "a script never survives");
});

test("editor (HTML): untouched never changes the value; an edit is cleaned; loaded HTML cannot run anything", async () => {
  const { window, document } = dom();
  const changes = [];
  const value = '<p>Hi <b>there</b></p><img src="/x" onerror="alert(1)"><script>alert(2)</script>';
  const editor = createRichEditor({ doc: document, id: "e1", label: "Text", value, format: "html", onChange: (next) => changes.push(next) });
  document.body.append(editor.element);
  await editor.ready;
  assert.equal(editor.mode(), "visual");
  assert.equal(editor.area.innerHTML, '<p>Hi <strong>there</strong></p><img src="/x">', "shown cleaned");
  assert.deepEqual(changes, [], "showing is not changing");
  editor.area.querySelector("p").append(" you");
  editor.area.dispatchEvent(new window.Event("input"));
  assert.deepEqual(changes, ['<p>Hi <strong>there</strong> you</p><p><img src="/x"></p>'], "an image loose among paragraphs gets its own paragraph");
  // Toolbar: labelled, controls the area; every format button names itself.
  const toolbar = editor.element.querySelector("[role=toolbar]");
  assert.equal(toolbar.getAttribute("aria-controls"), "e1");
  assert.deepEqual([...toolbar.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent), ["Paragraph", "Heading", "Subheading", "Bold", "Italic", "Bulleted list", "Numbered list", "Quote", "Add a link", "Remove the link", "Edit HTML"]);
  // Source view and back.
  editor.element.querySelector(".vc-tool-source").click();
  assert.equal(editor.mode(), "source");
  assert.equal(editor.source.value, '<p>Hi <strong>there</strong> you</p><p><img src="/x"></p>');
  editor.source.value = "<p>Typed <i>source</i></p>";
  editor.source.dispatchEvent(new window.Event("input"));
  assert.equal(changes.at(-1), "<p>Typed <i>source</i></p>", "source is taken as typed (the server cleans it)");
  editor.element.querySelector(".vc-tool-source").click();
  assert.equal(editor.mode(), "visual");
  assert.equal(editor.area.innerHTML, "<p>Typed <em>source</em></p>");
  // Emptying the editor gives "".
  editor.area.innerHTML = "<p><br></p>";
  editor.area.dispatchEvent(new window.Event("input"));
  assert.equal(changes.at(-1), "");
});

test("editor: images — insert from the sheet, alt, width (ratio kept), original size, keyboard resize, remove", async () => {
  const { window, document } = dom();
  const changes = [];
  const picks = [];
  const editor = createRichEditor({
    doc: document, id: "e2", label: "About", value: "<p>Before</p>", format: "html", onChange: (next) => changes.push(next),
    pickImage: (current, done) => { picks.push(current); done({ src: picks.length === 1 ? "/assets/uploads/2026/03/chair-0123abcd.webp" : "/images/hero.svg", width: 1200, height: 800 }); },
  });
  document.body.append(editor.element);
  await editor.ready;
  editor.element.querySelector('[data-command="image"]').click();
  const image = () => editor.area.querySelector("img");
  assert.equal(image()?.getAttribute("src"), "/assets/uploads/2026/03/chair-0123abcd.webp");
  assert.equal(editor.selectedImage(), image(), "the new image is selected");
  const bar = editor.element.querySelector(".vc-rich-image-bar");
  assert.equal(bar.hidden, false);
  assert.equal(document.activeElement, bar.querySelector("#e2-alt"), "alt text is asked for at once");
  const alt = bar.querySelector("#e2-alt");
  alt.value = "A pedicure chair";
  alt.dispatchEvent(new window.Event("input"));
  assert.match(changes.at(-1), /<img src="\/assets\/uploads\/2026\/03\/chair-0123abcd\.webp" alt="A pedicure chair">/);
  // Width typed: only width is written (height follows, ratio kept); a height from before goes.
  image().setAttribute("height", "800");
  const width = bar.querySelector("#e2-width");
  width.value = "320";
  width.dispatchEvent(new window.Event("change"));
  assert.equal(image().getAttribute("width"), "320");
  assert.equal(image().hasAttribute("height"), false);
  assert.match(changes.at(-1), /width="320"/);
  width.value = "5";
  width.dispatchEvent(new window.Event("change"));
  assert.equal(image().getAttribute("width"), "40", "never smaller than 40 px");
  // Keyboard on the resize handle: → +10, Shift+← −50.
  const handle = editor.element.querySelector(".vc-rich-handle");
  assert.equal(handle.hidden, false);
  assert.equal(handle.getAttribute("aria-label"), "Resize image (arrow keys)");
  width.value = "300"; width.dispatchEvent(new window.Event("change"));
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
  assert.equal(image().getAttribute("width"), "310");
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }));
  assert.equal(image().getAttribute("width"), "260");
  bar.querySelector('[data-image="original"]').click();
  assert.equal(image().hasAttribute("width"), false);
  // Replace keeps alt and size, changes the picture.
  bar.querySelector('[data-image="replace"]').click();
  assert.deepEqual(picks, ["", "/assets/uploads/2026/03/chair-0123abcd.webp"]);
  assert.equal(image().getAttribute("src"), "/images/hero.svg");
  assert.equal(image().getAttribute("alt"), "A pedicure chair");
  // Remove.
  bar.querySelector('[data-image="remove"]').click();
  assert.equal(image(), null);
  assert.equal(bar.hidden, true);
  assert.equal(changes.at(-1).includes("<img"), false);
  // Clicking an image selects it; Escape lets go; Delete removes it.
  editor.area.innerHTML = '<p>x<img src="/a.webp" alt="a"></p>';
  image().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(editor.selectedImage(), image());
  editor.area.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(editor.selectedImage(), undefined);
  image().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  editor.area.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete" }));
  assert.equal(image(), null);
});

test("editor: paste keeps only the text; links must be web, mail, phone or site addresses", async () => {
  const { window, document } = dom();
  const changes = [];
  const editor = createRichEditor({ doc: document, id: "e3", label: "Text", value: "<p>Start</p>", format: "html", onChange: (next) => changes.push(next) });
  document.body.append(editor.element);
  await editor.ready;
  const range = document.createRange();
  range.selectNodeContents(editor.area.querySelector("p"));
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const paste = new window.Event("paste", { bubbles: true, cancelable: true });
  paste.clipboardData = { getData: (type) => (type === "text/plain" ? " pasted <b>text</b>" : '<b onclick="x()">html</b>') };
  editor.area.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, true);
  assert.equal(changes.at(-1), "<p>Start pasted &lt;b&gt;text&lt;/b&gt;</p>", "the text, never the HTML");
  editor.element.querySelector('[data-command="link"]').click();
  const linkBar = editor.element.querySelector('[aria-label="Link"]');
  assert.equal(linkBar.hidden, false);
  const input = linkBar.querySelector("input");
  input.value = "javascript:alert(1)";
  linkBar.querySelector("button").click();
  assert.match(linkBar.textContent, /Use an address starting with https:\/\/, \/, mailto: or tel:/);
  assert.equal(linkBar.hidden, false);
});

test("editor (Markdown): loads the converter, keeps the post until it is edited, writes Markdown; HTML-heavy posts open as Markdown", async () => {
  const { window, document } = dom();
  const changes = [];
  let loads = 0;
  const value = "This post has **bold** text.\n\n* one\n* two\n";
  const editor = createRichEditor({ doc: document, id: "e4", label: "Text", value, format: "markdown", onChange: (next) => changes.push(next), loadMarkdown: async () => { loads += 1; return markdown; } });
  document.body.append(editor.element);
  assert.equal(editor.mode(), "loading");
  await editor.ready;
  assert.equal(loads, 1);
  assert.equal(editor.mode(), "visual");
  assert.equal(editor.area.innerHTML.replace(/\n/g, ""), "<p>This post has <strong>bold</strong> text.</p><ul><li>one</li><li>two</li></ul>");
  assert.deepEqual(changes, []);
  editor.area.insertAdjacentHTML("beforeend", '<p><img src="/a.webp" alt="Chair" width="300"></p>');
  editor.area.dispatchEvent(new window.Event("input"));
  assert.equal(changes.at(-1), 'This post has **bold** text.\n\n* one\n* two\n\n<img src="/a.webp" alt="Chair" width="300">\n', "the post's * bullets kept");
  assert.equal(editor.element.querySelector(".vc-tool-source").textContent, "Edit Markdown");

  const raw = '<div class="note">Raw block</div>\n\nAfter\n';
  const other = createRichEditor({ doc: document, id: "e5", label: "Text", value: raw, format: "markdown", onChange: (next) => changes.push(next), loadMarkdown });
  document.body.append(other.element);
  await other.ready;
  assert.equal(other.mode(), "source");
  assert.equal(other.source.value, raw);
  assert.match(other.element.querySelector(".vc-rich-status").textContent, /opens as Markdown/);
  other.element.querySelector(".vc-tool-source").click();
  assert.equal(other.mode(), "source", "the visual editor is refused for this post");
  assert.match(other.element.querySelector(".vc-rich-status").textContent, /stays in Markdown/);

  // The converter could not load: Markdown, said plainly.
  const offline = createRichEditor({ doc: document, id: "e6", label: "Text", value, format: "markdown", onChange: () => {}, loadMarkdown: async () => { throw new Error("offline"); } });
  await offline.ready;
  assert.equal(offline.mode(), "source");
  assert.match(offline.element.querySelector(".vc-rich-status").textContent, /could not load/);
});

test("editor: disabled (an owner-only field for an editor) shows the text but nothing can be changed", async () => {
  const { document } = dom();
  const editor = createRichEditor({ doc: document, id: "e7", label: "Text", value: "<p>Locked</p>", format: "html", disabled: true, onChange: () => assert.fail("no change"), pickImage: () => assert.fail("no picker") });
  await editor.ready;
  assert.equal(editor.area.getAttribute("contenteditable"), "false");
  assert.ok([...editor.element.querySelectorAll(".vc-rich-toolbar button")].every((button) => button.disabled));
  assert.equal(editor.source.disabled, true);
  await settle();
});
