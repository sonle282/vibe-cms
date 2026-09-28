/**
 * P3: write a JSON content file the way it already looks (idea and span reader from the Mr Spa CMS writer, F-09).
 *
 * - Nothing changed → the same bytes (indent, CRLF / LF, final newline, key order, number spelling, escapes, one-line
 *   arrays are never re-serialized).
 * - One value changed → only that value's text changes.
 * - Keys added / removed, array items added / removed / moved → only those members change; every untouched member keeps
 *   its exact text and the separators around it. Moved items keep their original bytes.
 * - New text follows the file's style: indent unit (2 / 4 spaces or tab), line ending, \uXXXX escapes when the file is
 *   ASCII-only, and one-line layout where the container (or its sibling items) is one-line.
 * The result is always checked: it must parse back to exactly `next`, otherwise the whole file is re-serialized in the
 * file's style (a bigger diff, never wrong content).
 */

type Span = { start: number; end: number };
type Member = Span & { key: string; keyEnd: number; value: JsonNode };
export type JsonNode =
  | (Span & { kind: "object"; members: Member[] })
  | (Span & { kind: "array"; items: JsonNode[] })
  | (Span & { kind: "value" });

export type JsonStyle = { eol: string; unit: string; asciiOnly: boolean };
type Edit = { start: number; end: number; text: string };

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const present = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;

/** Same JSON value (key order ignored; undefined properties ignored). */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const other = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === other.length && keys.every((key) => present(b, key) && sameValue(a[key], b[key]));
  }
  return a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
};

/** A JSON reader that remembers where every value starts and ends (a leading BOM counts as whitespace). */
export const parseJsonSpans = (text: string): JsonNode => {
  let at = 0;
  const space = () => { while (at < text.length && /[\s﻿]/.test(text[at])) at += 1; };
  const fail = (what: string): never => { throw new SyntaxError(`Invalid JSON (${what} at ${at}).`); };
  const readString = (): Span => {
    const start = at; at += 1;
    while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
    if (text[at] !== '"') fail("string");
    at += 1;
    return { start, end: at };
  };
  const readValue = (): JsonNode => {
    space();
    const start = at; const char = text[at];
    if (char === "{") {
      at += 1; const members: Member[] = []; space();
      if (text[at] === "}") { at += 1; return { kind: "object", start, end: at, members }; }
      for (;;) {
        space(); if (text[at] !== '"') fail("key");
        const key = readString(); space(); if (text[at] !== ":") fail("colon"); at += 1;
        const value = readValue();
        members.push({ key: JSON.parse(text.slice(key.start, key.end)) as string, start: key.start, keyEnd: key.end, end: value.end, value });
        space(); if (text[at] === ",") { at += 1; continue; } if (text[at] === "}") { at += 1; break; } fail("object");
      }
      return { kind: "object", start, end: at, members };
    }
    if (char === "[") {
      at += 1; const items: JsonNode[] = []; space();
      if (text[at] === "]") { at += 1; return { kind: "array", start, end: at, items }; }
      for (;;) {
        items.push(readValue()); space();
        if (text[at] === ",") { at += 1; continue; } if (text[at] === "]") { at += 1; break; } fail("array");
      }
      return { kind: "array", start, end: at, items };
    }
    if (char === '"') return { kind: "value", ...readString() };
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at, at + 400));
    if (!match) fail("value");
    at += match![0].length;
    return { kind: "value", start, end: at };
  };
  const root = readValue(); space();
  if (at !== text.length) fail("end");
  return root;
};

/** The file's own style: line ending, indent unit, and whether non-ASCII text is written as \uXXXX. */
export const detectJsonStyle = (text: string): JsonStyle => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indents = text.split(/\r?\n/).filter((line) => /\S/.test(line)).map((line) => /^[ \t]*/.exec(line)![0]).filter(Boolean);
  const unit = indents.some((indent) => indent.startsWith("\t")) ? "\t" : " ".repeat(Math.min(...indents.map((indent) => indent.length), 8) || 2);
  const asciiOnly = /\\u[0-9a-fA-F]{4}/.test(text) && !/[^\x00-\x7f﻿]/.test(text);
  return { eol, unit: indents.length ? unit : "  ", asciiOnly };
};

const writeString = (value: string, style: JsonStyle) => {
  const json = JSON.stringify(value);
  return style.asciiOnly ? json.replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : json;
};
const writeScalar = (value: unknown, style: JsonStyle) => (typeof value === "string" ? writeString(value, style) : JSON.stringify(value ?? null) ?? "null");

/** Multi-line value, children indented one unit deeper than `base`. */
export const prettyJson = (value: unknown, style: JsonStyle, base = ""): string => {
  const inner = base + style.unit;
  if (Array.isArray(value)) return value.length ? `[${style.eol}${value.map((item) => `${inner}${prettyJson(item, style, inner)}`).join(`,${style.eol}`)}${style.eol}${base}]` : "[]";
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    return keys.length ? `{${style.eol}${keys.map((key) => `${inner}${writeString(key, style)}: ${prettyJson(value[key], style, inner)}`).join(`,${style.eol}`)}${style.eol}${base}}` : "{}";
  }
  return writeScalar(value, style);
};

type Compact = { colon: string; comma: string; pad: string };
/** One-line spacing as seen in an existing one-line container: {"a":1} or { "a": 1, "b": 2 }. */
const compactStyle = (sample: string | undefined): Compact => {
  if (!sample) return { colon: ": ", comma: ", ", pad: "" };
  const outside = sample.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return { colon: /:\s/.test(outside) ? ": " : ":", comma: /,\s/.test(outside) || !outside.includes(",") ? ", " : ",", pad: /^[[{]\s/.test(outside) ? " " : "" };
};
const compactJson = (value: unknown, style: JsonStyle, compact: Compact): string => {
  if (Array.isArray(value)) return value.length ? `[${value.map((item) => compactJson(item, style, compact)).join(compact.comma)}]` : "[]";
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    return keys.length ? `{${compact.pad}${keys.map((key) => `${writeString(key, style)}${compact.colon}${compactJson(value[key], style, compact)}`).join(compact.comma)}${compact.pad}}` : "{}";
  }
  return writeScalar(value, style);
};

/** Leading whitespace of the line where `position` is. */
const indentAt = (text: string, position: number) => { const lineStart = text.lastIndexOf("\n", position - 1) + 1; return /^[ \t]*/.exec(text.slice(lineStart))![0]; };
const oneLine = (text: string, span: Span) => !text.slice(span.start, span.end).includes("\n");
const applyEdits = (text: string, edits: Edit[], offset = 0) =>
  [...edits].sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start - offset) + edit.text + result.slice(edit.end - offset), text);

type Ctx = { text: string; style: JsonStyle };
type Render = (value: unknown) => string;

/** How a brand-new value is written at `node`'s place. */
const renderAt = (ctx: Ctx, span: Span, inline: boolean, sample?: string): Render =>
  inline ? (value) => compactJson(value, ctx.style, compactStyle(sample)) : (value) => prettyJson(value, ctx.style, indentAt(ctx.text, span.start));

/** Text of `node` with `edits` (all inside it) applied. */
const patched = (ctx: Ctx, span: Span, edits: Edit[]) => applyEdits(ctx.text.slice(span.start, span.end), edits.filter((edit) => edit.start >= span.start && edit.end <= span.end), span.start);

/**
 * Rebuild the inside of a container from entries. Each entry is either an original child (index into `children`) with
 * its (possibly patched) text, or new text. Between two originals that were neighbours the original separator is kept;
 * elsewhere the container's usual separator is used.
 */
const rebuild = (ctx: Ctx, node: Span, children: Span[], entries: Array<{ from?: number; text: string }>, newGap: string): Edit => {
  const prefix = ctx.text.slice(node.start + 1, children[0].start);
  const suffix = ctx.text.slice(children[children.length - 1].end, node.end - 1);
  let inside = prefix;
  entries.forEach((entry, index) => {
    if (index) {
      const before = entries[index - 1].from;
      inside += before !== undefined && entry.from === before + 1 ? ctx.text.slice(children[before].end, children[before + 1].start) : newGap;
    }
    inside += entry.text;
  });
  return { start: node.start + 1, end: node.end - 1, text: inside + suffix };
};

const usualGap = (ctx: Ctx, node: Span, children: Span[], inline: boolean) => {
  if (children.length > 1) return ctx.text.slice(children[0].end, children[1].start);
  if (inline) return ", ";
  const first = children[0];
  const ownLine = /^\s*$/.test(ctx.text.slice(ctx.text.lastIndexOf("\n", first.start - 1) + 1, first.start));
  return `,${ctx.style.eol}${ownLine ? indentAt(ctx.text, first.start) : indentAt(ctx.text, node.start) + ctx.style.unit}`;
};

/** Longest common subsequence of equal items: pairs [beforeIndex, afterIndex]. */
const commonItems = (before: unknown[], after: unknown[]) => {
  // Equal head and tail first (the usual edit touches one item), then an LCS table only for the middle.
  let head = 0;
  while (head < before.length && head < after.length && sameValue(before[head], after[head])) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && sameValue(before[before.length - 1 - tail], after[after.length - 1 - tail])) tail += 1;
  const n = before.length - head - tail; const m = after.length - head - tail;
  const pairs: Array<[number, number]> = Array.from({ length: head }, (_, index) => [index, index]);
  if (n > 0 && m > 0) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    const equal = (x: number, y: number) => sameValue(before[head + x], after[head + y]);
    for (let x = n - 1; x >= 0; x -= 1) for (let y = m - 1; y >= 0; y -= 1) table[x][y] = equal(x, y) ? table[x + 1][y + 1] + 1 : Math.max(table[x + 1][y], table[x][y + 1]);
    for (let x = 0, y = 0; x < n && y < m;) {
      if (equal(x, y)) { pairs.push([head + x, head + y]); x += 1; y += 1; } else if (table[x + 1][y] >= table[x][y + 1]) x += 1; else y += 1;
    }
  }
  for (let index = tail; index > 0; index -= 1) pairs.push([before.length - index, after.length - index]);
  return pairs;
};

const collect = (ctx: Ctx, node: JsonNode, before: unknown, after: unknown, inline: boolean, sample?: string): Edit[] => {
  if (sameValue(before, after)) return [];
  const render = renderAt(ctx, node, inline, sample);
  const replace = (): Edit[] => [{ start: node.start, end: node.end, text: render(after) }];

  if (node.kind === "object" && isObject(before) && isObject(after)) {
    if (!node.members.length || !Object.keys(after).some((key) => present(after, key))) return replace();
    const childInline = oneLine(ctx.text, node);
    const kept = node.members.map((member, index) => ({ member, index })).filter(({ member }) => present(after, member.key));
    const seen = new Set(node.members.map((member) => member.key));
    const added = Object.keys(after).filter((key) => present(after, key) && !seen.has(key));
    const childEdits = kept.flatMap(({ member }) => collect(ctx, member.value, before[member.key], after[member.key], childInline, ctx.text.slice(node.start, node.end)));
    if (kept.length === node.members.length && !added.length) return childEdits;
    const colon = ctx.text.slice(node.members[0].keyEnd, node.members[0].value.start);
    const valueRender = renderAt(ctx, node.members[0], childInline, ctx.text.slice(node.start, node.end));
    const entries = [
      ...kept.map(({ member, index }) => ({ from: index, text: patched(ctx, member, childEdits) })),
      ...added.map((key) => ({ text: `${writeString(key, ctx.style)}${colon}${childInline ? valueRender(after[key]) : prettyJson(after[key], ctx.style, indentAt(ctx.text, node.members[0].start))}` })),
    ];
    return [rebuild(ctx, node, node.members, entries, usualGap(ctx, node, node.members, childInline))];
  }

  if (node.kind === "array" && Array.isArray(before) && Array.isArray(after)) {
    if (!node.items.length || !after.length) return replace();
    const childInline = oneLine(ctx.text, node);
    // New items look like their siblings: one-line when the existing container items are one-line.
    const containerItems = node.items.filter((item) => item.kind !== "value");
    const itemsInline = childInline || (containerItems.length > 0 && containerItems.every((item) => oneLine(ctx.text, item)));
    const itemSample = containerItems.length ? ctx.text.slice(containerItems[0].start, containerItems[0].end) : ctx.text.slice(node.start, node.end);
    const renderItem = itemsInline ? (value: unknown) => compactJson(value, ctx.style, compactStyle(itemSample)) : (value: unknown) => prettyJson(value, ctx.style, indentAt(ctx.text, node.items[0].start));

    // Match equal items (LCS); between matches, pair leftovers by position (edited items); the rest are added / removed.
    const source = new Array<number | undefined>(after.length);
    const edited = new Array<boolean>(after.length).fill(false);
    const anchors = [...commonItems(before, after), [before.length, after.length] as [number, number]];
    let i = 0; let j = 0;
    for (const [bi, aj] of anchors) {
      const pairs = Math.min(bi - i, aj - j);
      for (let k = 0; k < pairs; k += 1) { source[j + k] = i + k; edited[j + k] = true; }
      if (aj < after.length) source[aj] = bi;
      i = bi + 1; j = aj + 1;
    }
    // A new item equal to a removed one is a move: reuse the removed item's bytes.
    const used = new Set(source.filter((index): index is number => index !== undefined));
    after.forEach((value, index) => {
      if (source[index] !== undefined) return;
      const moved = before.findIndex((item, beforeIndex) => !used.has(beforeIndex) && sameValue(item, value));
      if (moved >= 0) { source[index] = moved; used.add(moved); }
    });
    const childEdits = after.flatMap((value, index) => (edited[index] ? collect(ctx, node.items[source[index]!], before[source[index]!], value, itemsInline, itemSample) : []));
    const inPlace = after.length === before.length && source.every((from, index) => from === index);
    if (inPlace) return childEdits;
    const entries = after.map((value, index) => (source[index] === undefined ? { text: renderItem(value) } : { from: source[index], text: patched(ctx, node.items[source[index]!], childEdits) }));
    return [rebuild(ctx, node, node.items, entries, usualGap(ctx, node, node.items, childInline))];
  }
  return replace();
};

/** The whole file written in `style` (used for a new file, or when a patch would not give back `next`). */
export const serializeJson = (next: unknown, style: JsonStyle = { eol: "\n", unit: "  ", asciiOnly: false }, finalNewline = true) =>
  `${prettyJson(next, style)}${finalNewline ? style.eol : ""}`;

/** `text` with only what differs from `next` rewritten; see the file comment. */
export const patchJson = (text: string, next: unknown): string => {
  const style = detectJsonStyle(text);
  const root = parseJsonSpans(text);
  const before = JSON.parse(text.replace(/^﻿/, "")) as unknown;
  const result = applyEdits(text, collect({ text, style }, root, before, next, false));
  if (sameValue(JSON.parse(result.replace(/^﻿/, "")), next)) return result;
  const lead = /^﻿?\s*/.exec(text)![0];
  return `${lead}${prettyJson(next, style)}${/\s*$/.exec(text)![0]}`;
};
