/**
 * P8d: clean the visual editor's DOM with the same allow-list as the server (src/check/rich-text-allow.ts), before it
 * is shown and before it becomes the field's value. Browsers' editing commands write <b> / <i> / <span style> / <div>;
 * they become <strong> / <em> / plain text / <p>. Pasted or loaded HTML never keeps scripts, handlers, styles or
 * javascript: links. The server cleans again on save — this keeps what the editor shows equal to what is stored.
 *
 * Markdown bodies may also show what Markdown itself writes (h1–h6, tables, strikethrough, task-list boxes); those
 * tags are kept only in that mode, and only so they can be turned back into the same Markdown.
 */
import { RICH_TEXT_ATTRIBUTES, RICH_TEXT_PROTOCOLS, RICH_TEXT_STRIP, RICH_TEXT_TAGS } from "../check/rich-text-allow.js";

const MARKDOWN_TAGS = ["h1", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "del", "input"];
const MARKDOWN_ATTRIBUTES: Record<string, string[]> = { th: ["align"], td: ["align"], input: ["type", "checked", "disabled"], code: ["class"] };
const RENAME: Record<string, string> = { b: "strong", i: "em", s: "del", strike: "del" };

const ELEMENT = 1;
const TEXT = 3;

const safeUrl = (value: string, kind: "href" | "src") => {
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  return !scheme || RICH_TEXT_PROTOCOLS[kind].includes(scheme);
};

/** Clean `root`'s children in place (root itself is kept as is). */
export const cleanRichDom = (root: Element, { markdown = false }: { markdown?: boolean } = {}) => {
  const doc = root.ownerDocument;
  const tags = new Set([...RICH_TEXT_TAGS, ...(markdown ? MARKDOWN_TAGS : [])]);
  const visit = (parent: Element) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === TEXT) continue;
      if (node.nodeType !== ELEMENT) { node.remove(); continue; }
      let element = node as Element;
      let tag = element.tagName.toLowerCase();
      if (RICH_TEXT_STRIP.includes(tag)) { element.remove(); continue; }
      const renamed = RENAME[tag];
      if (renamed && tags.has(renamed)) {
        const next = doc.createElement(renamed);
        next.append(...element.childNodes);
        element.replaceWith(next);
        element = next;
        tag = renamed;
      }
      if (!tags.has(tag)) {
        visit(element);
        element.replaceWith(...element.childNodes);
        continue;
      }
      if (tag === "input" && (element.getAttribute("type") ?? "").toLowerCase() !== "checkbox") { element.remove(); continue; }
      const allowed = new Set([...(RICH_TEXT_ATTRIBUTES["*"] ?? []), ...(RICH_TEXT_ATTRIBUTES[tag] ?? []), ...(markdown ? MARKDOWN_ATTRIBUTES[tag] ?? [] : [])]);
      for (const { name, value } of [...element.attributes]) {
        const lower = name.toLowerCase();
        if (!allowed.has(lower) || ((lower === "href" || lower === "src") && !safeUrl(value, lower))) element.removeAttribute(name);
      }
      visit(element);
    }
  };
  visit(root);
  return root;
};

/** Nothing a reader would see (no text, no image)? */
export const isEmptyRich = (root: Element) => !root.textContent?.trim() && !root.querySelector("img, hr, table");

const BLOCKS = new Set(["p", "div", "ul", "ol", "li", "blockquote", "pre", "figure", "figcaption", "hr", "table", "thead", "tbody", "tr", "th", "td", "h1", "h2", "h3", "h4", "h5", "h6"]);
const isBlock = (node: Node) => node.nodeType === ELEMENT && BLOCKS.has((node as Element).tagName.toLowerCase());
const isBlank = (node: Node) => (node.nodeType === TEXT && !node.textContent?.replace(/\u00a0/g, " ").trim()) || (node.nodeType === ELEMENT && (node as Element).tagName.toLowerCase() === "br");

/**
 * Tidy what editing commands leave behind: blocks nested in a paragraph (<p><ul>…</ul></p>) are lifted out, text next
 * to blocks is put in its own paragraph, empty paragraphs and trailing <br> go, and no-break spaces typed as spaces
 * become plain spaces. `wrapLoose`: also put loose text at the top level in a paragraph (Markdown; HTML that has no
 * block at all — "Some text" — stays as it is).
 */
export const normalizeBlocks = (root: Element, { wrapLoose = false }: { wrapLoose?: boolean } = {}) => {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue?.includes("\u00a0")) node.nodeValue = node.nodeValue.replace(/\u00a0/g, " ");
  // Wrap runs of inline nodes among blocks (or everywhere, with wrapLoose) in <p>.
  const wrapRuns = (parent: Element, always: boolean) => {
    const children = [...parent.childNodes];
    if (!always && !children.some(isBlock)) return;
    let run: Node[] = [];
    const flush = () => {
      if (run.some((node) => !isBlank(node))) { const p = doc.createElement("p"); run[0].parentNode?.insertBefore(p, run[0]); p.append(...run); }
      else for (const node of run) if (node.nodeType === ELEMENT) node.parentNode?.removeChild(node);
      run = [];
    };
    for (const child of children) { if (isBlock(child)) flush(); else run.push(child); }
    flush();
  };
  // A paragraph holding blocks becomes those blocks (with its loose text in paragraphs of their own).
  const lift = (parent: Element) => {
    for (const child of [...parent.children]) {
      lift(child);
      if (child.tagName.toLowerCase() === "p" && [...child.childNodes].some(isBlock)) {
        wrapRuns(child, false);
        child.replaceWith(...child.childNodes);
      }
    }
  };
  lift(root);
  wrapRuns(root, wrapLoose);
  for (const block of [...root.querySelectorAll("li, blockquote, td, th")]) if ([...block.childNodes].some(isBlock)) wrapRuns(block, false);
  for (const p of [...root.querySelectorAll("p, h1, h2, h3, h4, h5, h6")]) {
    while (p.lastChild && p.lastChild.nodeType === ELEMENT && (p.lastChild as Element).tagName.toLowerCase() === "br") p.lastChild.remove();
    if (![...p.childNodes].some((node) => !isBlank(node))) p.remove();
  }
  return root;
};
