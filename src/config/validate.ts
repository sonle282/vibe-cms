/**
 * P1: the minimum checks so a broken cms.config.ts stops the build with a clear message (path + what is expected).
 * P2 replaces this with the full schema check (field options, references, sections, duplicate keys…).
 */
import { FIELD_TYPES, type CmsConfig } from "./index.js";

export class CmsConfigError extends Error {
  constructor(public readonly file: string, public readonly problems: string[]) {
    super(`Vibe CMS: ${file} is not valid:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "CmsConfigError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const checkFields = (fields: unknown, at: string, problems: string[]) => {
  if (!isRecord(fields) || !Object.keys(fields).length) { problems.push(`${at}: required — at least one field, e.g. { title: f.text({ label: "Title" }) }`); return; }
  for (const [name, field] of Object.entries(fields)) {
    if (!isRecord(field) || !FIELD_TYPES.includes(field.type as never)) problems.push(`${at}.${name}: unknown field type ${JSON.stringify(isRecord(field) ? field.type : field)} — use f.text, f.richText, f.image, f.select, f.hours, f.object, f.list or f.reference`);
    else if (!text(field.label)) problems.push(`${at}.${name}.label: required — the name editors see`);
    if (isRecord(field) && field.locked !== undefined && field.locked !== "owner") problems.push(`${at}.${name}.locked: only "owner" is allowed`);
  }
};

export const assertCmsConfig: (config: unknown, file?: string) => asserts config is CmsConfig = (config, file = "cms.config.ts") => {
  const problems: string[] = [];
  if (!isRecord(config)) throw new CmsConfigError(file, ["the default export must be defineCmsConfig({ … })"]);
  if (config.configVersion !== 1) problems.push("configVersion: must be 1");
  if (!isRecord(config.site) || !text(config.site.name) || !text(config.site.url)) problems.push('site: required — { name: "…", url: "https://…" }');
  if (!isRecord(config.repo) || !text(config.repo.owner) || !text(config.repo.name) || !text(config.repo.branch)) problems.push('repo: required — { owner, name, branch } (branch = the production branch)');
  if (!Array.isArray(config.files)) problems.push("files: required — a list (may be empty)");
  else config.files.forEach((entry, index) => {
    const at = `files[${index}]`;
    if (!isRecord(entry)) { problems.push(`${at}: must be an object`); return; }
    if (!text(entry.key)) problems.push(`${at}.key: required — a short id such as "site"`);
    if (!text(entry.label)) problems.push(`${at}.label: required — the name editors see`);
    if (!text(entry.path)) problems.push(`${at}.path: required — the content file, e.g. "src/data/site.json"`);
    else if (!String(entry.path).endsWith(".json")) problems.push(`${at}.path: must be a .json file (got ${JSON.stringify(entry.path)})`);
    checkFields(entry.fields, `${at}.fields`, problems);
  });
  if (!Array.isArray(config.collections)) problems.push("collections: required — a list (may be empty)");
  else config.collections.forEach((entry, index) => {
    const at = `collections[${index}]`;
    if (!isRecord(entry)) { problems.push(`${at}: must be an object`); return; }
    if (!text(entry.key)) problems.push(`${at}.key: required`);
    if (!text(entry.label)) problems.push(`${at}.label: required`);
    if (!text(entry.itemLabel)) problems.push(`${at}.itemLabel: required — the name of one record, e.g. "Service"`);
    const store = entry.store;
    if (!isRecord(store) || !["json-array", "markdown-dir"].includes(String(store.kind))) problems.push(`${at}.store: required — { kind: "json-array", path, idField } or { kind: "markdown-dir", dir, slugField }`);
    else if (store.kind === "json-array" && (!text(store.path) || !text(store.idField))) problems.push(`${at}.store: "json-array" needs path and idField`);
    else if (store.kind === "markdown-dir" && (!text(store.dir) || !text(store.slugField))) problems.push(`${at}.store: "markdown-dir" needs dir and slugField`);
    checkFields(entry.fields, `${at}.fields`, problems);
  });
  if (problems.length) throw new CmsConfigError(file, problems);
};

export const countConfig = (config: CmsConfig) => ({ files: config.files.length, collections: config.collections.length });
