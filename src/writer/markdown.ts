/**
 * P3: read and write a Markdown record (markdown-dir collections): YAML front matter + body.
 *
 * - Nothing changed → the same bytes.
 * - Front matter: the file is cut into top-level entries ("key: …" plus its indented / list lines); unchanged entries keep
 *   their exact text and order, a changed entry is re-written alone (keeping its quote style), removed entries go, new
 *   ones are added at the end. Comment lines stay. The result must parse back to the new data, otherwise the whole front
 *   matter is re-written.
 * - Body: kept byte for byte unless it changed; a new body takes the file's line ending.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { sameValue } from "./json.js";

export type MarkdownRecord = { data: Record<string, unknown>; body: string };
type Split = { bom: string; eol: string; frontMatter: string | undefined; head: string; tail: string; body: string };

const FRONT_MATTER = /^(﻿?)---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n|$)/;

const split = (text: string): Split => {
  const match = FRONT_MATTER.exec(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!match) return { bom: text.startsWith("﻿") ? "﻿" : "", eol, frontMatter: undefined, head: "", tail: "", body: text.replace(/^﻿/, "") };
  return { bom: match[1], eol: match[2], frontMatter: match[3], head: `${match[1]}---${match[2]}`, tail: `${match[4]}---${match[5]}`, body: text.slice(match[0].length) };
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Parse a Markdown record. Throws when the front matter is not valid YAML. */
export const parseMarkdown = (text: string): MarkdownRecord & { hasFrontMatter: boolean } => {
  const parts = split(text);
  if (parts.frontMatter === undefined) return { data: {}, body: parts.body, hasFrontMatter: false };
  const data = (parseYaml(parts.frontMatter) ?? {}) as unknown;
  if (!isRecord(data)) throw new SyntaxError('front matter must be "key: value" lines');
  return { data, body: parts.body, hasFrontMatter: true };
};

type Block = { key?: string; lines: string[] };
const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"\-?:][^:#]*?|-[^\s:][^:#]*?))\s*:(?:\s|$)/;

/** Top-level entries of a front matter text (comment / blank lines are their own blocks). */
const blocks = (frontMatter: string, eol: string): Block[] => {
  const result: Block[] = [];
  for (const line of frontMatter.split(eol)) {
    const key = KEY_LINE.exec(line);
    if (key) result.push({ key: key[1] !== undefined ? JSON.parse(`"${key[1]}"`) : key[2] !== undefined ? key[2].replace(/''/g, "'") : key[3].trim(), lines: [line] });
    else if (result.length && result[result.length - 1].key !== undefined && (/^[\s-]/.test(line) && line.trim() !== "")) result[result.length - 1].lines.push(line);
    else result.push({ lines: [line] });
  }
  return result;
};

const quoteStyle = (line: string) => {
  const value = line.replace(KEY_LINE, "").trimStart();
  return value.startsWith('"') ? "QUOTE_DOUBLE" : value.startsWith("'") ? "QUOTE_SINGLE" : "PLAIN";
};
const entry = (key: string, value: unknown, eol: string, style: "QUOTE_DOUBLE" | "QUOTE_SINGLE" | "PLAIN" = "PLAIN") =>
  stringifyYaml({ [key]: value }, { lineWidth: 0, defaultStringType: style, defaultKeyType: "PLAIN" }).replace(/\n$/, "").split("\n").join(eol);

/** `text` with the front matter and body changed to `next`, touching only what differs. */
export const patchMarkdown = (text: string, next: MarkdownRecord): string => {
  const parts = split(text);
  const body = next.body === parts.body ? parts.body : next.body.replace(/\r?\n/g, parts.eol);
  const keys = Object.keys(next.data).filter((key) => next.data[key] !== undefined);
  const data = Object.fromEntries(keys.map((key) => [key, next.data[key]]));
  const whole = () => `${parts.bom}---${parts.eol}${keys.length ? stringifyYaml(data, { lineWidth: 0 }).replace(/\n$/, "").split("\n").join(parts.eol) : ""}${parts.eol}---${parts.eol}${body}`;
  if (parts.frontMatter === undefined) return keys.length ? whole() : `${parts.bom}${body}`;

  const current = (parseYaml(parts.frontMatter) ?? {}) as Record<string, unknown>;
  if (sameValue(current, data)) return `${parts.head}${parts.frontMatter}${parts.tail}${body}`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks(parts.frontMatter, parts.eol)) {
    if (block.key === undefined) { out.push(...block.lines); continue; }
    seen.add(block.key);
    if (!Object.prototype.hasOwnProperty.call(data, block.key)) continue;
    if (sameValue(current[block.key], data[block.key])) out.push(...block.lines);
    else out.push(entry(block.key, data[block.key], parts.eol, quoteStyle(block.lines[0])));
  }
  for (const key of keys) if (!seen.has(key)) out.push(entry(key, data[key], parts.eol));
  const frontMatter = out.join(parts.eol);
  let checked: unknown;
  try { checked = parseYaml(frontMatter); } catch { checked = undefined; }
  if (!sameValue(checked ?? {}, data)) return whole();
  return `${parts.head}${frontMatter}${parts.tail}${body}`;
};
