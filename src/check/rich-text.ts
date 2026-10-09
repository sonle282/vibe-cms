/**
 * P8c: rich text (and Markdown bodies) are cleaned on the server before they are stored or published, with the same
 * parser and the same allow-list as the CMS the package grew out of (hast: a real HTML parser, no DOM — runs in the
 * Worker). Kept: paragraphs, headings h2–h3, lists, links (http / https / mailto / tel / relative), bold, italic,
 * underline, quotes, code, figures, images (http / https / relative), class + title. Removed with their content:
 * script, style, noscript, iframe, object, embed, form; every other unknown tag is dropped but its text kept; every
 * other attribute (onclick, style, srcdoc…) is dropped; javascript: / data: links are dropped.
 *
 * A value someone typed is always stored as the parser re-writes it (normal form): keeping the typed bytes "because
 * they look clean" is not safe — an unfinished tag at the end ("<img src=x onerror=…") is dropped by the parser yet
 * would become live markup next to the page's own HTML. Text already in the site's files is never touched (see
 * sanitizeRecord `before`). Markdown bodies are only re-written when something unsafe was actually removed, because the
 * normal form escapes "<" and "&", which Markdown code samples show literally.
 */
import { fromHtml } from "hast-util-from-html";
import { sanitize, type Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import type { Field } from "../config/index.js";
import { toTree, type FieldTree } from "../config/tree.js";
import { RICH_TEXT_ATTRIBUTES, RICH_TEXT_PROTOCOLS, RICH_TEXT_STRIP, RICH_TEXT_TAGS } from "./rich-text-allow.js";

export const RICH_TEXT_SCHEMA: Schema = {
  tagNames: RICH_TEXT_TAGS,
  attributes: Object.fromEntries(Object.entries(RICH_TEXT_ATTRIBUTES).map(([tag, names]) => [tag, names.map((name) => (name === "class" ? "className" : name))])),
  protocols: RICH_TEXT_PROTOCOLS,
  strip: RICH_TEXT_STRIP,
  // No id / name on content: nothing to clobber.
  clobber: [],
  clobberPrefix: "",
};
/** Largest rich-text value (characters), as on the first site. */
export const RICH_TEXT_MAX_CHARS = 250_000;

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[]; value?: string };

/** "script", "a[onclick]", "a[href=javascript:]"… for every element / attribute in the tree. */
const inventory = (node: HastNode, out: string[] = []) => {
  if (node.type === "element" && node.tagName) {
    out.push(node.tagName);
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      const shown = name === "className" ? "class" : name.replace(/^on[A-Z]/, (match) => match.toLowerCase()).toLowerCase();
      if ((name === "href" || name === "src") && typeof value === "string") {
        const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(value.replace(/[\u0000- ]/g, ""))?.[1]?.toLowerCase();
        out.push(scheme ? `${node.tagName}[${shown}=${scheme}:]` : `${node.tagName}[${shown}]`);
      } else out.push(`${node.tagName}[${shown}]`);
    }
  }
  for (const child of node.children ?? []) inventory(child, out);
  return out;
};
const minus = (all: string[], kept: string[]) => {
  const left = [...kept];
  const removed: string[] = [];
  for (const entry of all) { const at = left.indexOf(entry); if (at >= 0) left.splice(at, 1); else removed.push(entry); }
  return [...new Set(removed)];
};

export type CleanResult = { html: string; changed: boolean; removed: string[] };
const UNFINISHED_TAG = /<[A-Za-z!/?][^>]*$/;

/**
 * Clean one HTML string. `changed`: the stored value differs from the input; `removed`: what was unsafe (empty when only
 * the formatting changed, e.g. "<BR/>" → "<br>"). With `markdown`, the input is kept unless something unsafe was removed.
 */
export const sanitizeRichText = (value: string, { markdown = false }: { markdown?: boolean } = {}): CleanResult => {
  if (!value || !/[<&]/.test(value)) return { html: value, changed: false, removed: [] };
  const tree = fromHtml(value, { fragment: true }) as unknown as HastNode;
  const clean = sanitize(tree as never, RICH_TEXT_SCHEMA) as unknown as HastNode;
  const cleaned = toHtml(clean as never, { characterReferences: { useNamedReferences: true } });
  const removed = minus(inventory(tree), inventory(clean)).map((entry) => (entry.includes("[") ? entry : `<${entry}>`));
  if (UNFINISHED_TAG.test(value)) removed.push("an unfinished tag at the end");
  if (markdown && !removed.length) return { html: value, changed: false, removed: [] };
  return cleaned === value ? { html: value, changed: false, removed: [] } : { html: cleaned, changed: true, removed };
};

export type CleanedField = { path: string; removed: string[] };

/**
 * Clean every rich-text value of a record (any depth: objects, lists, dotted keys), and `body` when the record is
 * Markdown (raw HTML in Markdown reaches the page the same way). Values that are already in `before` (the source the
 * draft started from) are not touched. Returns the cleaned copy, what was cleaned where, and values over the limit.
 */
export const sanitizeRecord = ({ fields, record, before, markdownBody = false }: { fields: Record<string, Field>; record: unknown; before?: unknown; markdownBody?: boolean }) => {
  // Text already in the source (the site's own files) is left alone: only what a CMS user typed is cleaned.
  const known = new Set<string>();
  const collect = (value: unknown) => { if (typeof value === "string") known.add(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
  collect(before);
  const cleaned: CleanedField[] = [];
  const tooLong: string[] = [];
  const at = (base: string, key: string | number) => (typeof key === "number" ? `${base}[${key}]` : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? (base ? `${base}.${key}` : key) : `${base}[${JSON.stringify(key)}]`);
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const cleanString = (value: string, path: string, markdown = false) => {
    if (known.has(value)) return value;
    if (value.length > RICH_TEXT_MAX_CHARS) { tooLong.push(path); return value; }
    const result = sanitizeRichText(value, { markdown });
    if (result.changed) cleaned.push({ path, removed: result.removed });
    return result.html;
  };
  const visitField = (field: Field, value: unknown, path: string): unknown => {
    if (field.type === "richText") return typeof value === "string" ? cleanString(value, path) : value;
    if (field.type === "object" && isRecord(value)) return visitTree(toTree(field.fields), value, path);
    if (field.type === "list" && Array.isArray(value)) return value.map((item, index) => visitField(field.of, item, at(path, index)));
    return value;
  };
  const visitTree = (tree: FieldTree, value: Record<string, unknown>, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...value };
    for (const [key, node] of tree) {
      if (!(key in value)) continue;
      out[key] = node instanceof Map ? (isRecord(value[key]) ? visitTree(node, value[key] as Record<string, unknown>, at(path, key)) : value[key]) : visitField(node, value[key], at(path, key));
    }
    return out;
  };
  if (!isRecord(record)) return { record, cleaned, tooLong };
  const out = visitTree(toTree(fields), record, "");
  if (markdownBody && typeof out.body === "string" && !("body" in fields)) out.body = cleanString(out.body, "body", true);
  return { record: out, cleaned, tooLong };
};

/** Entries where something unsafe was removed (not just re-formatted). */
export const unsafeOnly = (entries: CleanedField[]) => entries.filter((entry) => entry.removed.length > 0);

/** "hero.text: removed <script>, a[onclick]" — for warnings people read. */
export const describeCleaned = (entry: CleanedField) => `${entry.path}: removed ${entry.removed.join(", ") || "unsafe HTML"}`;
