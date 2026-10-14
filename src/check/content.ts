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
import { sanitizeRecord, unsafeOnly } from "./rich-text.js";
import { ruleContext, runRules } from "./rules.js";
import { fileRecord, storeIdField, storeRecords } from "../config/store.js";
import { pluginFiles, runSiteChecks, siteContext } from "./site.js";
import { mediaSettings } from "../media/index.js";
import { imageNamesOf, type ImageManifest } from "../media/names.js";

/** P12h: the site's image manifest (media.names.manifest), read from the project; problems go to `problems`. */
export const readImageManifest = (config: CmsConfig, root: string, problems?: Problem[]): ImageManifest | undefined => {
  const file = config.media?.names?.manifest;
  if (!file) return undefined;
  const full = join(root, file);
  if (!existsSync(full)) { if (problems) add(problems, file, "the image manifest (media.names.manifest) is missing", "build the site's images first, or fix the path"); return undefined; }
  try {
    const data = JSON.parse(readFileSync(full, "utf8"));
    if (!isRecord(data)) throw new Error("expected an object of names");
    for (const [name, entry] of Object.entries(data)) if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.width !== "number" || typeof entry.height !== "number") throw new Error(`${JSON.stringify(name)} needs width, height and path`);
    return data as ImageManifest;
  } catch (error) { if (problems) add(problems, file, `the image manifest is not valid: ${(error as Error).message}`); return undefined; }
};
/** P12h: the names setting with its manifest, or undefined when the site stores image paths. */
export const readImageNames = (config: CmsConfig, root: string, problems?: Problem[]) => imageNamesOf(config.media, readImageManifest(config, root, problems), mediaSettings(config.media).base);

/** P8c: rich text the CMS would clean when someone edits it — a warning, the site's own files are never changed. */
const unsafeHtml = (ctx: Ctx, fields: CmsCollection["fields"], record: Record<string, unknown>, path: string, markdownBody = false) => {
  for (const entry of unsafeOnly(sanitizeRecord({ fields, record, markdownBody }).cleaned)) {
    add(ctx.warnings, entry.path ? (path ? `${path}${entry.path.startsWith("[") ? "" : "."}${entry.path}` : entry.path) : path, `has HTML the CMS removes when this field is edited (${entry.removed.join(", ")})`, "remove it from the file, or leave it: it stays until someone edits this field in the CMS");
  }
};

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
  if (collection.store.kind !== "markdown-dir") {
    const store = collection.store;
    const { path: rel, idField } = store;
    const data = readJson(ctx, root, rel, `${where}.store.path`);
    if (data === undefined) return undefined;
    const found = storeRecords(store, data);
    if (typeof found === "string") { add(ctx.errors, rel, found, store.kind === "json-array" ? `a "json-array" collection file holds [ { … }, { … } ]${store.pointer ? ` at "${store.pointer}"` : ""}` : `a "json-object" collection file holds { "id": { … } }${store.pointer ? ` at "${store.pointer}"` : ""}`); return undefined; }
    for (const { id: key, record: item, at: place } of found) {
      const path = store.kind === "json-array" ? `${rel}${place.startsWith("[") ? "" : "."}${place}` : `${rel} › ${place}`;
      if (!isRecord(item)) { add(ctx.errors, path, `expected a record ({ … }), got ${describe(item)}`); continue; }
      // json-object: each record holds its id too, the same as its key.
      if (store.kind === "json-object" && item[idField] !== key) { add(ctx.errors, `${path}.${idField}`, `must be ${JSON.stringify(key)}, its key in the object (got ${describe(item[idField])})`); continue; }
      const id = addId(item[idField], path, idField);
      records.push({ path: id ? `${path} (${JSON.stringify(id)})` : path, data: item, ...(id ? { id } : {}) });
    }
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

/** P20: the "not in cms.config" warnings of a record's `keep` keys go (the site owns them). */
const keepOnly = (ctx: Ctx, from: number, recordPath: string, keep: readonly string[] | undefined) => {
  if (!keep?.length) return;
  const kept = ctx.warnings.slice(from).filter((warning) => {
    if (!warning.message.startsWith("is not in cms.config") || !warning.path.startsWith(`${recordPath}.`)) return true;
    const key = warning.path.slice(recordPath.length + 1).replace(/\[\d+\]/g, "[]");
    return !keep.some((entry) => key === entry || key.startsWith(`${entry}.`) || key.startsWith(`${entry}[`));
  });
  ctx.warnings.splice(from, ctx.warnings.length - from, ...kept);
};

/** root = the project root (the folder of cms.config.ts). */
export const checkContent = (config: CmsConfig, root: string): CheckResult => {
  const ctx: Ctx = { errors: [], warnings: [], ids: new Map(), ...(config.site.phone?.country ? { phoneCountry: config.site.phone.country } : {}) };
  const imageNames = readImageNames(config, root, ctx.errors);
  if (imageNames) ctx.imageNames = imageNames;
  const loaded = config.collections.map((collection, index) => loadCollection(ctx, root, collection, index));
  const fileData = new Map<string, unknown>();
  config.files.forEach((file, index) => {
    const whole = readJson(ctx, root, file.path, `files[${index}].path`);
    if (whole === undefined) return;
    // P20: a record at a key of the file.
    const data = fileRecord(file, whole);
    if (data === undefined) { add(ctx.errors, file.path, `has no "${file.pointer}" (files[${index}].pointer)`, "add the key, or fix the pointer"); return; }
    if (!isRecord(data)) { add(ctx.errors, file.path, `expected an object ({ … }), got ${describe(data)}`); return; }
    fileData.set(file.key, data);
    ctx.root = data; ctx.picks = undefined; // P12g: pick choices come from this record
    const before = ctx.warnings.length;
    checkRecord(ctx, data, toTree(file.fields), file.path);
    keepOnly(ctx, before, file.path, file.keep);
    unsafeHtml(ctx, file.fields, data, file.path);
  });
  for (const entry of loaded) {
    if (!entry) continue;
    const { collection } = entry;
    const system = [storeIdField(collection.store), ...(collection.status ? [collection.status.field] : []), ...(collection.store.kind === "markdown-dir" ? ["body"] : [])];
    for (const record of entry.records) {
      ctx.root = isRecord(record.data) ? record.data : undefined; ctx.picks = undefined;
      const before = ctx.warnings.length;
      checkRecord(ctx, record.data, toTree(collection.fields), record.path, system);
      keepOnly(ctx, before, record.path, collection.keep);
      unsafeHtml(ctx, collection.fields, record.data, record.path, collection.store.kind === "markdown-dir");
      if (collection.status && !collection.fields[collection.status.field]) {
        const status = record.data[collection.status.field];
        if (status !== undefined && status !== collection.status.live && status !== collection.status.draft && status !== collection.status.archived) add(ctx.errors, at(record.path, collection.status.field), `${describe(status)} is neither live (${JSON.stringify(collection.status.live)}) nor draft (${JSON.stringify(collection.status.draft)})`);
      }
    }
  }
  // P12d: the site's own rules, once everything is loaded (a rule may read other files / collections).
  const content = ruleContext(fileData, new Map(loaded.filter((entry) => entry !== undefined).map((entry) => [entry!.collection.key, entry!.records.map((record) => record.data)])));
  const merge = (result: CheckResult) => { ctx.errors.push(...result.errors); ctx.warnings.push(...result.warnings); };
  for (const file of config.files) if (file.rules && fileData.has(file.key)) merge(runRules(file.rules, fileData.get(file.key), content, file.path));
  for (const entry of loaded) if (entry?.collection.rules) for (const record of entry.records) merge(runRules(entry.collection.rules, record.data, content, record.path));
  // P19: the site plugins, on the whole site (and the repo files they asked for) as it is.
  if (config.plugins?.length) {
    const texts = Object.fromEntries(pluginFiles(config).map((path) => [path, existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined]));
    const items = new Map(loaded.filter((entry) => entry !== undefined).map((entry) => [entry!.collection.key, entry!.records.map((record) => record.data as Record<string, unknown>)]));
    merge(runSiteChecks(config, siteContext(config, fileData, items, texts)));
  }
  return { errors: ctx.errors, warnings: ctx.warnings };
};
