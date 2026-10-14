/**
 * M10: the Mr Spa CMS's Blog post / Policy editor (`layout: "document"`) — the text on a sheet of paper (760 px: the
 * formatting bar on top, the cover, the title in large type, the body; a policy: "Plain text · the sections stay as they
 * are" and its word count instead of the bar), and on the right (340 px) "On the website", "Post details" /
 * "Page details", "In Google" and "Ready to publish" (src/admin/record.ts builds the column).
 */
import { h } from "./dom.js";

/** Mr Spa: "1 word" / "1234 words" (no thousands separator). */
export const wordCount = (texts: readonly string[]) => {
  const count = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return `${count} ${count === 1 ? "word" : "words"}`;
};

/** Every string in a value (a policy's sections: headings, paragraphs, bullets). */
export const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
};

/** The text of rich text as Google would read it (no tags, entities decoded, spaces collapsed). */
export const plainTextOf = (doc: Document, value: string, markdown: boolean) => {
  let text = value;
  if (markdown) {
    text = text
      .replace(/<[^>]*>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
      .replace(/(\*\*|__|\*|_|`)/g, "");
  } else {
    // An inert document: nothing in it loads or runs.
    const box = doc.implementation.createHTMLDocument("").createElement("div");
    box.innerHTML = text.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|h[1-6]|li|blockquote|div|figcaption)>/gi, "$& ");
    text = box.textContent ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
};

/** Mr Spa (and its website): longer than 220 characters → the first 217, then "…". */
export const excerptOf = (text: string) => (text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text);

/** "In Google": the address as Google shows it, the title, the first lines. */
export const createGoogleCard = (doc: Document, help: string) => {
  const path = h(doc, "span", { class: "vc-doc-google-path" });
  const title = h(doc, "span", { class: "vc-doc-google-title" });
  const text = h(doc, "span", { class: "vc-doc-google-text" });
  const element = h(doc, "section", { class: "vc-record-side-card", "aria-label": "In Google" },
    h(doc, "h2", {}, "In Google"), h(doc, "div", { class: "vc-doc-google" }, path, title, text), h(doc, "p", { class: "vc-help" }, help));
  const update = (next: { path: string; title: string; text: string }) => {
    path.textContent = next.path;
    title.textContent = next.title;
    text.textContent = next.text;
  };
  return { element, update };
};

/** The address in Google's form: "demo.example › blog › welcome". */
export const googlePath = (host: string, path: string) => [host, ...path.split("/").filter(Boolean)].join(" › ");

/** A card of the right column with fields in it ("Post details" / "Page details"). */
export const createDetailsCard = (doc: Document, heading: string) => {
  const body = h(doc, "div", { class: "vc-doc-details" });
  const element = h(doc, "section", { class: "vc-record-side-card", "aria-label": heading }, h(doc, "h2", {}, heading), body);
  return { element, body };
};

/** A policy's bar on top of the paper: what can be changed, and the word count. */
export const createDocBar = (doc: Document, words: string) => {
  const count = h(doc, "span", { class: "vc-doc-count" });
  const element = h(doc, "div", { class: "vc-doc-bar", "aria-live": "polite" }, h(doc, "span", {}, words), count);
  return { element, setCount: (text: string) => { count.textContent = text; } };
};
