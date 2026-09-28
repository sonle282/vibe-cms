/**
 * P2: check the site's real content against its cms.config at build time — every declared file exists, parses, and its
 * values match the field types. Missing required values and wrong types are errors (the build stops); properties that
 * the config does not declare are warnings. This is also the core of `vibe-cms check` (P11).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CmsCollection, CmsConfig } from "../config/index.js";
import type { CheckResult, Problem } from "../config/validate.js";
import { parseMarkdown } from "../writer/markdown.js";
import { toTree } from "../config/tree.js";
import { add, checkRecord, describe, isRecord, at, type ValueCtx } from "./values.js";

type Ctx = ValueCtx;

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
      let parsed: ReturnType<typeof parseMarkdown>;
      try { parsed = parseMarkdown(readFileSync(join(dir, name), "utf8")); } catch (error) { add(ctx.errors, path, `front matter is not valid: ${(error as Error).message.split("\n")[0]}`); continue; }
      if (!parsed.hasFrontMatter) { add(ctx.errors, path, "has no front matter", 'start the file with ---, the fields, then --- (e.g. "---\\ntitle: Hello\\n---")'); continue; }
      const id = addId(parsed.data[slugField], `${path} (front matter)`, slugField);
      records.push({ path: `${path} (front matter)`, data: { ...parsed.data, body: parsed.body }, ...(id ? { id } : {}) });
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
