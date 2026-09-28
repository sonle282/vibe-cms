/**
 * P2: check the site's real content against its cms.config at build time — every declared file exists, parses, and its
 * values match the field types. Missing required values and wrong types are errors (the build stops); properties that
 * the config does not declare are warnings. This is also the core of `vibe-cms check` (P11).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CmsCollection, CmsConfig, Field } from "../config/index.js";
import type { CheckResult, Problem } from "../config/validate.js";

type Ctx = CheckResult & { ids: Map<string, Set<string>> };
type Tree = Map<string, Field | Tree>;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const add = (list: Problem[], path: string, message: string, hint?: string) => list.push({ path, message, ...(hint ? { hint } : {}) });
const describe = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return `text ${JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value)}`;
  return `${typeof value === "boolean" ? "true/false" : typeof value} ${JSON.stringify(value)}`;
};
const at = (base: string, key: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`);
const empty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Dotted keys ("about.title") become nested levels so the content can be walked like the JSON. */
const toTree = (fields: Record<string, Field>): Tree => {
  const tree: Tree = new Map();
  for (const [key, field] of Object.entries(fields)) {
    const parts = key.split(".");
    let level = tree;
    parts.slice(0, -1).forEach((part) => {
      const next = level.get(part);
      if (next instanceof Map) level = next;
      else { const created: Tree = new Map(); level.set(part, created); level = created; }
    });
    level.set(parts.at(-1) as string, field);
  }
  return tree;
};

const checkRecord = (ctx: Ctx, record: Record<string, unknown>, tree: Tree, path: string, system: string[] = []) => {
  for (const [key, node] of tree) {
    const value = record[key];
    if (node instanceof Map) {
      if (value === undefined) continue;
      if (!isRecord(value)) add(ctx.errors, at(path, key), `expected an object, got ${describe(value)}`);
      else checkRecord(ctx, value, node, at(path, key));
    } else checkValue(ctx, node, value, at(path, key));
  }
  for (const key of Object.keys(record)) if (!tree.has(key) && !system.includes(key)) add(ctx.warnings, at(path, key), "is not in cms.config (editors will not see it)", "declare a field for it, or ignore if the site sets it in code");
};

const checkHours = (ctx: Ctx, value: unknown, path: string) => {
  const hint = '[{ "days": [1, 2, 3, 4, 5], "open": "09:00", "close": "19:00" }, { "days": [0], "closed": true }]';
  if (!Array.isArray(value)) { add(ctx.errors, path, `expected opening hours (a list of rows), got ${describe(value)}`, hint); return; }
  const seen = new Map<number, number>();
  value.forEach((row, index) => {
    const rowPath = `${path}[${index}]`;
    if (!isRecord(row)) { add(ctx.errors, rowPath, `expected a row { days, open, close } or { days, closed: true }, got ${describe(row)}`, hint); return; }
    for (const key of Object.keys(row)) if (!["days", "label", "open", "close", "closed"].includes(key)) add(ctx.warnings, `${rowPath}.${key}`, "is not part of an hours row", "rows have days, label, open, close, closed");
    if (!Array.isArray(row.days) || !row.days.length || !row.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) add(ctx.errors, `${rowPath}.days`, `expected day numbers 0–6 (0 = Sunday), got ${describe(row.days)}`, "e.g. [1, 2, 3, 4, 5] for Monday–Friday");
    else row.days.forEach((day: number) => { if (seen.has(day)) add(ctx.errors, `${rowPath}.days`, `day ${day} is also in row ${seen.get(day)}`, "each day belongs to one row"); else seen.set(day, index); });
    if (row.label !== undefined && typeof row.label !== "string") add(ctx.errors, `${rowPath}.label`, `expected text, got ${describe(row.label)}`);
    if (row.closed === true) { if (row.open !== undefined || row.close !== undefined) add(ctx.warnings, rowPath, "is closed but also has open / close times", "remove open and close"); return; }
    if (row.closed !== undefined && typeof row.closed !== "boolean") add(ctx.errors, `${rowPath}.closed`, `expected true or false, got ${describe(row.closed)}`);
    for (const name of ["open", "close"] as const) if (typeof row[name] !== "string" || !TIME.test(row[name] as string)) add(ctx.errors, `${rowPath}.${name}`, `expected a 24-hour time "HH:MM", got ${describe(row[name])}`, 'e.g. "09:00" or "19:30"; for a closed day write "closed": true');
    if (TIME.test(String(row.open)) && TIME.test(String(row.close)) && String(row.open) >= String(row.close)) add(ctx.errors, rowPath, `opens at ${row.open} but closes at ${row.close}`, "close must be later than open on the same day");
  });
};

const checkValue = (ctx: Ctx, field: Field, value: unknown, path: string): void => {
  if (empty(value)) { if (field.required) add(ctx.errors, path, `required ("${field.label}") but ${value === undefined ? "missing" : "empty"}`, "fill it in, or remove required: true"); return; }
  switch (field.type) {
    case "text":
      if (typeof value !== "string") { add(ctx.errors, path, `expected text, got ${describe(value)}`, typeof value === "number" || typeof value === "boolean" ? `write it in quotes: "${value}"` : "write it as text in quotes"); return; }
      if (field.maxLength && value.length > field.maxLength) add(ctx.errors, path, `is ${value.length} characters, longer than maxLength ${field.maxLength}`, "shorten it or raise maxLength");
      if (!field.multiline && value.includes("\n")) add(ctx.warnings, path, "has a line break but the field is single-line", "remove the line break or set multiline: true");
      return;
    case "richText":
      if (typeof value !== "string") add(ctx.errors, path, `expected rich text (a string), got ${describe(value)}`);
      return;
    case "image":
      if (typeof value === "string") return;
      if (!isRecord(value) || typeof value.src !== "string" || !value.src) { add(ctx.errors, path, `expected an image path or { "src": … }, got ${describe(value)}`, 'e.g. "/images/hero.jpg" or { "src": "/images/hero.jpg", "alt": "…" }'); return; }
      for (const key of Object.keys(value)) if (!["src", "alt", "mobile"].includes(key)) add(ctx.warnings, `${path}.${key}`, "is not part of an image", "images have src, alt, mobile");
      for (const key of ["alt", "mobile"] as const) if (value[key] !== undefined && typeof value[key] !== "string") add(ctx.errors, `${path}.${key}`, `expected text, got ${describe(value[key])}`);
      if (field.alt && !value.alt) add(ctx.warnings, `${path}.alt`, "is empty", "describe the image for people using screen readers");
      return;
    case "select":
      if (typeof value !== "string" || !field.options.includes(value)) add(ctx.errors, path, `${describe(value)} is not one of the options`, `use ${field.options.map((option) => JSON.stringify(option)).join(", ")}`);
      return;
    case "hours":
      checkHours(ctx, value, path);
      return;
    case "object":
      if (!isRecord(value)) { add(ctx.errors, path, `expected an object, got ${describe(value)}`); return; }
      checkRecord(ctx, value, toTree(field.fields), path);
      return;
    case "list":
      if (!Array.isArray(value)) { add(ctx.errors, path, `expected a list, got ${describe(value)}`, "wrap it in [ ]"); return; }
      if (field.min !== undefined && value.length < field.min) add(ctx.errors, path, `has ${value.length} items, fewer than min ${field.min}`);
      if (field.max !== undefined && value.length > field.max) add(ctx.errors, path, `has ${value.length} items, more than max ${field.max}`);
      value.forEach((item, index) => checkValue(ctx, field.of, item, `${path}[${index}]`));
      return;
    case "reference": {
      const ids = ctx.ids.get(field.to);
      const one = (id: unknown, idPath: string) => {
        if (typeof id !== "string" || !id) add(ctx.errors, idPath, `expected the id of a "${field.to}" record, got ${describe(id)}`);
        else if (ids && !ids.has(id)) add(ctx.errors, idPath, `no "${field.to}" record has id ${JSON.stringify(id)}`, ids.size ? `e.g. ${[...ids].slice(0, 3).map((known) => JSON.stringify(known)).join(", ")}` : `"${field.to}" has no records yet`);
      };
      if (field.multiple) { if (!Array.isArray(value)) add(ctx.errors, path, `expected a list of "${field.to}" ids, got ${describe(value)}`, "wrap it in [ ]"); else value.forEach((id, index) => one(id, `${path}[${index}]`)); }
      else one(value, path);
      return;
    }
  }
};

type Loaded = { collection: CmsCollection; records: Array<{ path: string; data: Record<string, unknown>; id?: string }> };

const readJson = (ctx: Ctx, root: string, rel: string, where: string): unknown => {
  const file = join(root, rel);
  if (!existsSync(file)) { add(ctx.errors, rel, `not found (declared at ${where})`, "create the file or fix the path in cms.config"); return undefined; }
  try { return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (error) { add(ctx.errors, rel, `is not valid JSON: ${(error as Error).message}`, "fix the syntax (a missing comma or quote is the usual cause)"); return undefined; }
};

const loadCollection = (ctx: Ctx, root: string, collection: CmsCollection, index: number): Loaded | undefined => {
  const where = `collections[${index}]`;
  const records: Loaded["records"] = [];
  const ids = new Set<string>();
  const addId = (id: unknown, path: string, idName: string) => {
    if (typeof id !== "string" || !id.trim()) { add(ctx.errors, `${path}.${idName}`, `required — the record id ("${idName}"), got ${describe(id)}`, 'e.g. "classic-manicure"'); return undefined; }
    if (ids.has(id)) { add(ctx.errors, `${path}.${idName}`, `id ${JSON.stringify(id)} is used twice in "${collection.key}"`, "every record needs its own id"); return undefined; }
    ids.add(id); return id;
  };
  if (collection.store.kind === "json-array") {
    const { path: rel, idField } = collection.store;
    const data = readJson(ctx, root, rel, `${where}.store.path`);
    if (data === undefined) return undefined;
    if (!Array.isArray(data)) { add(ctx.errors, rel, `expected a list of records ([ … ]), got ${describe(data)}`, 'a "json-array" collection file holds [ { … }, { … } ]'); return undefined; }
    data.forEach((item, itemIndex) => {
      const path = `${rel}[${itemIndex}]`;
      if (!isRecord(item)) { add(ctx.errors, path, `expected a record ({ … }), got ${describe(item)}`); return; }
      const id = addId(item[idField], path, idField);
      records.push({ path: id ? `${path} (${JSON.stringify(id)})` : path, data: item, ...(id ? { id } : {}) });
    });
  } else {
    const { dir: rel, slugField } = collection.store;
    const dir = join(root, rel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { add(ctx.errors, rel, `folder not found (declared at ${where}.store.dir)`, "create the folder or fix the path in cms.config"); return undefined; }
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".md")).sort()) {
      const path = `${rel}/${name}`;
      const text = readFileSync(join(dir, name), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
      const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text);
      if (!match) { add(ctx.errors, path, "has no front matter", 'start the file with ---, the fields, then --- (e.g. "---\\ntitle: Hello\\n---")'); continue; }
      let data: unknown;
      try { data = parseYaml(match[1]) ?? {}; } catch (error) { add(ctx.errors, path, `front matter is not valid: ${(error as Error).message.split("\n")[0]}`); continue; }
      if (!isRecord(data)) { add(ctx.errors, path, `front matter must be "key: value" lines, got ${describe(data)}`); continue; }
      const id = addId(data[slugField], `${path} (front matter)`, slugField);
      records.push({ path: `${path} (front matter)`, data: { ...data, body: match[2] }, ...(id ? { id } : {}) });
    }
  }
  ctx.ids.set(collection.key, ids);
  return { collection, records };
};

/** root = the project root (the folder of cms.config.ts). */
export const checkContent = (config: CmsConfig, root: string): CheckResult => {
  const ctx: Ctx = { errors: [], warnings: [], ids: new Map() };
  const loaded = config.collections.map((collection, index) => loadCollection(ctx, root, collection, index));
  config.files.forEach((file, index) => {
    const data = readJson(ctx, root, file.path, `files[${index}].path`);
    if (data === undefined) return;
    if (!isRecord(data)) { add(ctx.errors, file.path, `expected an object ({ … }), got ${describe(data)}`); return; }
    checkRecord(ctx, data, toTree(file.fields), file.path);
  });
  for (const entry of loaded) {
    if (!entry) continue;
    const { collection } = entry;
    const system = [collection.store.kind === "json-array" ? collection.store.idField : collection.store.slugField, ...(collection.status ? [collection.status.field] : []), ...(collection.store.kind === "markdown-dir" ? ["body"] : [])];
    for (const record of entry.records) {
      checkRecord(ctx, record.data, toTree(collection.fields), record.path, system);
      if (collection.status && !collection.fields[collection.status.field]) {
        const status = record.data[collection.status.field];
        if (status !== undefined && status !== collection.status.live && status !== collection.status.draft) add(ctx.errors, at(record.path, collection.status.field), `${describe(status)} is neither live (${JSON.stringify(collection.status.live)}) nor draft (${JSON.stringify(collection.status.draft)})`);
      }
    }
  }
  return { errors: ctx.errors, warnings: ctx.warnings };
};
