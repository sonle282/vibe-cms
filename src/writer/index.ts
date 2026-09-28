/**
 * P3: apply an edited record to its source text, keeping the file's formatting (see json.ts / markdown.ts).
 * These run in the Worker at publish time (P5 / P8) and in `vibe-cms check` (round-trip).
 */
import type { CmsCollection } from "../config/index.js";
import { patchJson, serializeJson } from "./json.js";
import { patchMarkdown, parseMarkdown } from "./markdown.js";

export { detectJsonStyle, parseJsonSpans, patchJson, prettyJson, sameValue, serializeJson, type JsonStyle } from "./json.js";
export { parseMarkdown, patchMarkdown, type MarkdownRecord } from "./markdown.js";

/** A single-record file (files[]): the new content, written into the old text. */
export const writeFile = (text: string | undefined, content: unknown) => (text === undefined ? serializeJson(content) : patchJson(text, content));

/**
 * One record of a json-array collection: replace it (same id), add it at the end (new id), or remove it (null).
 * Only that item's lines change.
 */
export const writeArrayItem = (text: string, idField: string, id: string, item: Record<string, unknown> | null) => {
  const list = JSON.parse(text.replace(/^﻿/, "")) as unknown;
  if (!Array.isArray(list)) throw new TypeError("a json-array collection file must hold a list");
  const index = list.findIndex((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>)[idField] === id);
  const next = [...list];
  if (item === null) { if (index >= 0) next.splice(index, 1); } else if (index >= 0) next[index] = item; else next.push(item);
  return patchJson(text, next);
};

/** Move one record of a json-array collection to `position` (0-based). Only the moved item's lines change. */
export const moveArrayItem = (text: string, idField: string, id: string, position: number) => {
  const list = JSON.parse(text.replace(/^﻿/, "")) as Array<Record<string, unknown>>;
  const index = list.findIndex((entry) => entry?.[idField] === id);
  if (index < 0) throw new RangeError(`no record with ${idField} = ${JSON.stringify(id)}`);
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(position, next.length)), 0, moved);
  return patchJson(text, next);
};

/** One record of a markdown-dir collection: content = front matter fields + optional `body`. */
export const writeMarkdownItem = (text: string | undefined, content: Record<string, unknown>) => {
  const { body, ...data } = content;
  const current = text === undefined ? { body: "" } : parseMarkdown(text);
  return patchMarkdown(text ?? "", { data, body: typeof body === "string" ? body : current.body });
};

/** Where a collection keeps one record (for markdown-dir: <dir>/<slug>.md). */
export const recordPath = (collection: CmsCollection, id: string) => (collection.store.kind === "json-array" ? collection.store.path : `${collection.store.dir}/${id}.md`);
