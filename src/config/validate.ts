/**
 * P2: the full check of a site's cms.config (no file access — the content check is src/check/content.ts).
 * Every mistake is collected in one pass; each problem names its place (e.g. collections[0].fields.items.of.fields.price)
 * and says how to fix it. Warnings never stop the build.
 */
import { FIELD_TYPES, type CmsConfig } from "./index.js";

export type Problem = { path: string; message: string; hint?: string };
export type CheckResult = { errors: Problem[]; warnings: Problem[] };

/** Deepest allowed nesting of object / list fields (a list of objects that hold a list of objects = 4). */
export const MAX_DEPTH = 4;
/** Content may live only under these folders (a site can add more with contentDirs). */
export const DEFAULT_CONTENT_DIRS: readonly string[] = ["src/data", "src/content"];

export const formatProblem = (problem: Problem) => `${problem.path}: ${problem.message}${problem.hint ? ` → ${problem.hint}` : ""}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export class CmsConfigError extends Error {
  constructor(public readonly file: string, public readonly problems: Problem[], what = "is not valid") {
    super(`Vibe CMS: ${file} ${what} (${plural(problems.length, "problem")}):\n${problems.map((problem) => `  - ${formatProblem(problem)}`).join("\n")}`);
    this.name = "CmsConfigError";
  }
}

export const formatWarnings = (file: string, warnings: Problem[]) =>
  `Vibe CMS: ${plural(warnings.length, "warning")} in ${file} (the build continues):\n${warnings.map((warning) => `  - ${formatProblem(warning)}`).join("\n")}`;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const show = (value: unknown) => (value === undefined ? "nothing" : JSON.stringify(value));
const keyPath = (parent: string, key: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`);

const RESOURCE_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;

const BASE_OPTIONS = ["type", "label", "help", "required", "locked", "bind"];
const FIELD_OPTIONS: Record<string, string[]> = {
  text: ["maxLength", "multiline"],
  richText: [],
  image: ["alt", "mobile"],
  select: ["options"],
  hours: [],
  object: ["fields"],
  list: ["of", "ordered", "min", "max", "itemLabel"],
  reference: ["to", "multiple", "ordered"],
};
const TOP_LEVEL = ["configVersion", "site", "repo", "roles", "contentDirs", "files", "collections", "media"];

/** Why a git branch name is invalid (git check-ref-format rules), or undefined when it is fine. */
export const branchProblem = (name: string): string | undefined => {
  if (!name) return "is empty";
  if (name === "@") return 'cannot be "@"';
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return "has a space or one of ~ ^ : ? * [ \\";
  if (name.includes("..")) return 'has ".."';
  if (name.includes("@{")) return 'has "@{"';
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return 'has an empty part (leading, trailing or double "/")';
  if (name.endsWith(".")) return 'ends with "."';
  if (name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) return 'has a part that starts with "." or ends with ".lock"';
  return undefined;
};

/** Why a content path is not allowed, or undefined. dirs = allowed content folders; kind = "file" | "folder". */
export const pathProblem = (value: string, dirs: readonly string[]): string | undefined => {
  if (value.includes("\\")) return 'use "/" between folders, not "\\"';
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("~")) return "must be relative to the project root, not absolute";
  const parts = value.split("/");
  if (parts.includes("..")) return 'must not contain ".."';
  if (parts.some((part) => part === "" || part === ".")) return 'has an empty or "." part';
  if (!dirs.some((dir) => value === dir || value.startsWith(`${dir}/`))) return `must be inside ${dirs.map((dir) => `"${dir}/"`).join(" or ")}`;
  return undefined;
};

type Context = { errors: Problem[]; warnings: Problem[]; collectionKeys: Set<string> };
const err = (context: Context, path: string, message: string, hint?: string) => context.errors.push({ path, message, ...(hint ? { hint } : {}) });
const warn = (context: Context, path: string, message: string, hint?: string) => context.warnings.push({ path, message, ...(hint ? { hint } : {}) });

const checkBoolean = (context: Context, field: Record<string, unknown>, name: string, at: string) => {
  if (field[name] !== undefined && typeof field[name] !== "boolean") err(context, `${at}.${name}`, `must be true or false (got ${show(field[name])})`);
};
const checkCount = (context: Context, field: Record<string, unknown>, name: string, at: string, min: number) => {
  const value = field[name];
  if (value !== undefined && !(Number.isInteger(value) && (value as number) >= min)) err(context, `${at}.${name}`, `must be a whole number ≥ ${min} (got ${show(value)})`);
};

export const checkField = (context: Context, field: unknown, at: string, depth: number): void => {
  if (!isRecord(field)) { err(context, at, `must be a field (got ${show(field)})`, 'use f.text({ label: "…" }) or another f.* builder'); return; }
  const type = field.type;
  if (!FIELD_TYPES.includes(type as never)) { err(context, `${at}.type`, `unknown field type ${show(type)}`, `use one of ${FIELD_TYPES.join(", ")} (f.text, f.list…)`); return; }
  const allowed = [...BASE_OPTIONS, ...FIELD_OPTIONS[type as string]];
  for (const option of Object.keys(field)) if (!allowed.includes(option)) err(context, `${at}.${option}`, `unknown option for a ${type} field`, `allowed: ${allowed.filter((name) => name !== "type").join(", ")}`);
  if (!filled(field.label)) err(context, `${at}.label`, "required — the name editors see", 'e.g. label: "Phone"');
  if (field.help !== undefined && typeof field.help !== "string") err(context, `${at}.help`, "must be text");
  if (field.bind !== undefined && !filled(field.bind)) err(context, `${at}.bind`, "must be a CSS selector", 'e.g. bind: ".hero h1"');
  checkBoolean(context, field, "required", at);
  if (field.locked !== undefined && field.locked !== "owner") err(context, `${at}.locked`, `only "owner" is allowed (got ${show(field.locked)})`, 'write locked: "owner" or remove it');

  switch (type) {
    case "text":
      checkCount(context, field, "maxLength", at, 1);
      checkBoolean(context, field, "multiline", at);
      break;
    case "image":
      checkBoolean(context, field, "alt", at);
      checkBoolean(context, field, "mobile", at);
      break;
    case "select": {
      const options = field.options;
      if (!Array.isArray(options) || !options.length) { err(context, `${at}.options`, "required — at least one option", 'e.g. options: ["Nails", "Spa"]'); break; }
      options.forEach((option, index) => { if (!filled(option)) err(context, `${at}.options[${index}]`, `must be non-empty text (got ${show(option)})`); });
      const seen = new Set<unknown>();
      options.forEach((option, index) => { if (seen.has(option)) err(context, `${at}.options[${index}]`, `${show(option)} is listed twice`, "remove the copy"); seen.add(option); });
      break;
    }
    case "object":
      if (depth > MAX_DEPTH) { err(context, at, `nested too deep (more than ${MAX_DEPTH} levels of object / list)`, "flatten it or move part of it into a collection with a reference"); break; }
      checkFields(context, field.fields, `${at}.fields`, depth + 1);
      break;
    case "list":
      if (depth > MAX_DEPTH) { err(context, at, `nested too deep (more than ${MAX_DEPTH} levels of object / list)`, "flatten it or move part of it into a collection with a reference"); break; }
      if (field.of === undefined) err(context, `${at}.of`, "required — the kind of item", 'e.g. f.list(f.text({ label: "Extra" }), { label: "Extras" })');
      else checkField(context, field.of, `${at}.of`, depth + 1);
      checkBoolean(context, field, "ordered", at);
      checkCount(context, field, "min", at, 0);
      checkCount(context, field, "max", at, 1);
      if (Number.isInteger(field.min) && Number.isInteger(field.max) && (field.min as number) > (field.max as number)) err(context, `${at}.min`, `is bigger than max (${field.min} > ${field.max})`);
      if (field.itemLabel !== undefined && !filled(field.itemLabel)) err(context, `${at}.itemLabel`, "must be non-empty text", 'e.g. itemLabel: "Extra"');
      break;
    case "reference":
      if (!filled(field.to)) err(context, `${at}.to`, "required — the key of the collection it points to", 'e.g. to: "services"');
      else if (!context.collectionKeys.has(field.to)) err(context, `${at}.to`, `no collection has key ${show(field.to)}`, context.collectionKeys.size ? `use one of ${[...context.collectionKeys].map((key) => `"${key}"`).join(", ")}` : "add that collection first");
      checkBoolean(context, field, "multiple", at);
      checkBoolean(context, field, "ordered", at);
      if (field.ordered === true && field.multiple !== true) warn(context, `${at}.ordered`, "has no effect without multiple: true");
      break;
  }
};

/** Field keys: identifiers, dotted keys allowed ("about.title" = a nested value); a key may not also be the parent of another key. */
export const checkFields = (context: Context, fields: unknown, at: string, depth = 1): void => {
  if (!isRecord(fields) || !Object.keys(fields).length) { err(context, at, "required — at least one field", 'e.g. { title: f.text({ label: "Title" }) }'); return; }
  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!FIELD_KEY.test(key)) err(context, keyPath(at, key), "is not a valid field key", 'use letters, digits and _ (dots only between parts, e.g. "about.title")');
    const parent = keys.find((other) => key.startsWith(`${other}.`));
    if (parent) err(context, keyPath(at, key), `clashes with the field "${parent}" at the same level (one value cannot be both)`, `rename one, or put "${key.slice(parent.length + 1)}" inside ${parent}'s fields`);
    checkField(context, fields[key], keyPath(at, key), depth);
  }
};

const checkUniqueKeys = (context: Context, entries: unknown[], at: string, seen: Map<string, string>) => {
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.key !== "string") return;
    const first = seen.get(entry.key);
    if (first) err(context, `${at}[${index}].key`, `"${entry.key}" is already used by ${first}`, "every file and collection needs its own key");
    else seen.set(entry.key, `${at}[${index}]`);
  });
};

const checkPath = (context: Context, value: unknown, at: string, dirs: readonly string[], ext: string | undefined, example: string, paths: Map<string, string>) => {
  if (!filled(value)) { err(context, at, "required", `e.g. "${example}"`); return; }
  const problem = pathProblem(value, dirs);
  if (problem) { err(context, at, `${show(value)} ${problem}`, `e.g. "${example}"`); return; }
  if (ext && !value.endsWith(ext)) {
    const yaml = /\.ya?ml$/i.test(value);
    err(context, at, yaml ? "YAML is not supported" : `must be a ${ext} file (got ${show(value)})`, yaml ? "store the content as JSON" : `e.g. "${example}"`);
    return;
  }
  const first = paths.get(value);
  if (first) err(context, at, `${show(value)} is already used by ${first}`, "each file or folder belongs to one entry");
  else paths.set(value, at.replace(/\.(path|dir|store\.path|store\.dir)$/, ""));
};

const checkPreview = (context: Context, value: unknown, at: string, placeholders: string[]) => {
  if (value === undefined) return;
  if (!filled(value) || !value.startsWith("/")) { err(context, at, `must be a site path starting with "/" (got ${show(value)})`, placeholders.length ? `e.g. "/services/{${placeholders[0]}}/"` : 'e.g. "/"'); return; }
  for (const [, name] of value.matchAll(/\{([^}]*)\}/g)) if (!placeholders.includes(name)) err(context, at, `{${name}} is not a field of this entry`, placeholders.length ? `use ${placeholders.map((key) => `{${key}}`).join(" or ")}` : "a file has no placeholders");
};

export const checkCmsConfig = (config: unknown): CheckResult => {
  const context: Context = { errors: [], warnings: [], collectionKeys: new Set() };
  if (!isRecord(config)) { err(context, "(default export)", "must be defineCmsConfig({ … })", "export default defineCmsConfig({ configVersion: 1, … })"); return context; }
  for (const key of Object.keys(config)) if (!TOP_LEVEL.includes(key)) err(context, key, "unknown setting", `allowed: ${TOP_LEVEL.join(", ")}`);
  if (config.configVersion !== 1) err(context, "configVersion", `must be 1 (got ${show(config.configVersion)})`);

  const site = config.site;
  if (!isRecord(site)) err(context, "site", "required", '{ name: "My Salon", url: "https://mysalon.example" }');
  else {
    if (!filled(site.name)) err(context, "site.name", "required — the site's name");
    let url: URL | undefined;
    try { url = new URL(String(site.url)); } catch { /* reported below */ }
    if (!url || !/^https?:$/.test(url.protocol)) err(context, "site.url", `must be a full http(s) address (got ${show(site.url)})`, 'e.g. "https://mysalon.example"');
    if (site.timezone !== undefined) {
      try { new Intl.DateTimeFormat("en", { timeZone: String(site.timezone) }); } catch { err(context, "site.timezone", `unknown time zone ${show(site.timezone)}`, 'use an IANA name, e.g. "America/New_York"'); }
    }
  }

  const repo = config.repo;
  if (!isRecord(repo)) err(context, "repo", "required", '{ owner: "my-org", name: "mysalon.example", branch: "main" } (branch = production)');
  else {
    if (!filled(repo.owner)) err(context, "repo.owner", "required — the GitHub user or organisation");
    else if (!GITHUB_OWNER.test(repo.owner)) err(context, "repo.owner", `${show(repo.owner)} is not a GitHub user / organisation name`, "letters, digits and single hyphens, up to 39");
    if (!filled(repo.name)) err(context, "repo.name", "required — the repository name");
    else if (!GITHUB_REPO.test(repo.name) || repo.name === "." || repo.name === ".." || repo.name.endsWith(".git")) err(context, "repo.name", `${show(repo.name)} is not a repository name`, 'letters, digits, ".", "-", "_", without ".git"');
    if (!filled(repo.branch)) err(context, "repo.branch", "required — the production branch the CMS commits to", 'e.g. "main"');
    else { const problem = branchProblem(repo.branch); if (problem) err(context, "repo.branch", `${show(repo.branch)} is not a valid branch name: it ${problem}`); }
  }

  if (config.roles !== undefined && !(Array.isArray(config.roles) && config.roles.length === 2 && config.roles[0] === "owner" && config.roles[1] === "editor")) err(context, "roles", `must be ["owner", "editor"] (got ${show(config.roles)})`, "the roles are fixed; remove the line or write it exactly");

  let dirs: string[] = [...DEFAULT_CONTENT_DIRS];
  if (config.contentDirs !== undefined) {
    if (!Array.isArray(config.contentDirs)) err(context, "contentDirs", "must be a list of folders", 'e.g. ["src/pages-data"]');
    else config.contentDirs.forEach((dir, index) => {
      const problem = filled(dir) ? pathProblem(dir.replace(/\/$/, ""), [dir.replace(/\/$/, "").split("/")[0]]) : "is empty";
      if (problem) err(context, `contentDirs[${index}]`, `${show(dir)} ${problem}`, 'a folder inside the project, e.g. "src/pages-data"');
      else dirs.push(dir.replace(/\/$/, ""));
    });
  }
  dirs = [...new Set(dirs)];

  if (config.media !== undefined) {
    if (!isRecord(config.media)) err(context, "media", "must be { dir?, maxBytes? }");
    else {
      for (const key of Object.keys(config.media)) if (!["dir", "maxBytes"].includes(key)) err(context, `media.${key}`, "is not a media setting", "media has dir and maxBytes");
      if (config.media.dir !== undefined && (typeof config.media.dir !== "string" || !/^public(\/[a-z0-9][a-z0-9_-]*)+$/.test(config.media.dir))) err(context, "media.dir", `must be a folder inside public/ in lowercase letters, digits, "-" and "_" (got ${show(config.media.dir)})`, 'e.g. "public/assets/uploads"');
      if (config.media.maxBytes !== undefined && !(Number.isInteger(config.media.maxBytes) && (config.media.maxBytes as number) > 0 && (config.media.maxBytes as number) <= 25 * 1024 * 1024)) err(context, "media.maxBytes", `must be a whole number of bytes from 1 to 26214400 (25 MiB) (got ${show(config.media.maxBytes)})`, "e.g. 10485760 (10 MiB)");
    }
  }

  const collections = config.collections;
  if (Array.isArray(collections)) for (const entry of collections) if (isRecord(entry) && filled(entry.key)) context.collectionKeys.add(entry.key);
  const keys = new Map<string, string>();
  const paths = new Map<string, string>();

  if (!Array.isArray(config.files)) err(context, "files", "required — a list (may be empty)", "files: []");
  else {
    config.files.forEach((entry, index) => {
      const at = `files[${index}]`;
      if (!isRecord(entry)) { err(context, at, "must be an object", '{ key, label, path, format: "json", fields }'); return; }
      for (const key of Object.keys(entry)) if (!["key", "label", "path", "format", "preview", "sections", "fields"].includes(key)) err(context, `${at}.${key}`, "unknown setting", "allowed: key, label, path, format, preview, sections, fields");
      if (!filled(entry.key)) err(context, `${at}.key`, "required — a short id", 'e.g. "site"');
      else if (!RESOURCE_KEY.test(entry.key)) err(context, `${at}.key`, `${show(entry.key)} is not a valid key`, 'lowercase letters, digits and "-", starting with a letter');
      if (!filled(entry.label)) err(context, `${at}.label`, "required — the name editors see", 'e.g. "Salon info"');
      if (entry.format !== undefined && entry.format !== "json") err(context, `${at}.format`, entry.format === "yaml" || entry.format === "yml" ? "YAML is not supported" : `must be "json" (got ${show(entry.format)})`, 'write format: "json" and store the content as JSON');
      if (entry.path === undefined) err(context, `${at}.path`, "required — the content file", 'e.g. "src/data/site.json"');
      else checkPath(context, entry.path, `${at}.path`, dirs, ".json", "src/data/site.json", paths);
      checkPreview(context, entry.preview, `${at}.preview`, []);
      checkFields(context, entry.fields, `${at}.fields`);
      checkSections(context, entry, at);
    });
    checkUniqueKeys(context, config.files, "files", keys);
  }

  if (!Array.isArray(collections)) err(context, "collections", "required — a list (may be empty)", "collections: []");
  else {
    collections.forEach((entry, index) => {
      const at = `collections[${index}]`;
      if (!isRecord(entry)) { err(context, at, "must be an object", "{ key, label, itemLabel, store, fields }"); return; }
      for (const key of Object.keys(entry)) if (!["key", "label", "itemLabel", "store", "status", "preview", "order", "fields"].includes(key)) err(context, `${at}.${key}`, "unknown setting", "allowed: key, label, itemLabel, store, status, preview, order, fields");
      if (!filled(entry.key)) err(context, `${at}.key`, "required — a short id", 'e.g. "services"');
      else if (!RESOURCE_KEY.test(entry.key)) err(context, `${at}.key`, `${show(entry.key)} is not a valid key`, 'lowercase letters, digits and "-", starting with a letter');
      if (!filled(entry.label)) err(context, `${at}.label`, "required — the name editors see", 'e.g. "Services"');
      if (!filled(entry.itemLabel)) err(context, `${at}.itemLabel`, "required — the name of one record", 'e.g. "Service"');
      checkFields(context, entry.fields, `${at}.fields`);
      const fieldKeys = isRecord(entry.fields) ? Object.keys(entry.fields) : [];
      const store = entry.store;
      let idKey: string | undefined;
      if (!isRecord(store)) err(context, `${at}.store`, "required", '{ kind: "json-array", path: "src/data/services.json", idField: "id" } or { kind: "markdown-dir", dir: "src/content/blog", slugField: "slug" }');
      else if (store.kind === "json-array") {
        for (const key of Object.keys(store)) if (!["kind", "path", "idField"].includes(key)) err(context, `${at}.store.${key}`, 'unknown setting for "json-array"', "allowed: kind, path, idField");
        checkPath(context, store.path, `${at}.store.path`, dirs, ".json", "src/data/services.json", paths);
        if (!filled(store.idField)) err(context, `${at}.store.idField`, 'required for "json-array" — the property that identifies a record', 'e.g. "id"');
        else idKey = store.idField;
      } else if (store.kind === "markdown-dir") {
        for (const key of Object.keys(store)) if (!["kind", "dir", "slugField"].includes(key)) err(context, `${at}.store.${key}`, 'unknown setting for "markdown-dir"', "allowed: kind, dir, slugField");
        checkPath(context, store.dir, `${at}.store.dir`, dirs, undefined, "src/content/blog", paths);
        if (!filled(store.slugField)) err(context, `${at}.store.slugField`, 'required for "markdown-dir" — the front-matter property with the record\'s slug', 'e.g. "slug"');
        else idKey = store.slugField;
      } else err(context, `${at}.store.kind`, `unknown store kind ${show(store.kind)}`, 'use "json-array" (one JSON file holding a list) or "markdown-dir" (one .md file per record)');
      const fieldType = (key: string) => { const field = isRecord(entry.fields) ? entry.fields[key] : undefined; return isRecord(field) ? field.type : undefined; };
      if (idKey && fieldType(idKey) !== undefined && fieldType(idKey) !== "text") err(context, keyPath(`${at}.fields`, idKey), `is the record id, so it must be a text field (got ${show(fieldType(idKey))})`);
      checkPreview(context, entry.preview, `${at}.preview`, [...new Set([...(idKey ? [idKey] : []), ...fieldKeys.filter((key) => fieldType(key) === "text")])]);
      if (entry.order !== undefined && entry.order !== "file") {
        if (!isRecord(entry.order) || !filled(entry.order.by)) err(context, `${at}.order`, `must be "file" or { by: "<field>" } (got ${show(entry.order)})`);
        else if (!fieldKeys.includes(entry.order.by)) err(context, `${at}.order.by`, `${show(entry.order.by)} is not a field of this collection`, fieldKeys.length ? `use one of ${fieldKeys.join(", ")}` : undefined);
      }
      const status = entry.status;
      if (status !== undefined) {
        if (!isRecord(status) || !filled(status.field) || !filled(status.live) || !filled(status.draft)) err(context, `${at}.status`, "must be { field, live, draft }", '{ field: "status", live: "published", draft: "draft" }');
        else {
          if (status.live === status.draft) err(context, `${at}.status.draft`, `must differ from live (both ${show(status.live)})`);
          const statusField = isRecord(entry.fields) ? entry.fields[status.field] : undefined;
          const options = isRecord(statusField) && statusField.type === "select" && Array.isArray(statusField.options) ? (statusField.options as unknown[]) : undefined;
          if (options) for (const name of ["live", "draft"] as const) if (!options.includes(status[name])) err(context, `${at}.status.${name}`, `${show(status[name])} is not an option of the "${status.field}" select`, `add it to options or use one of ${options.map((option) => show(option)).join(", ")}`);
        }
      }
    });
    checkUniqueKeys(context, collections, "collections", keys);
  }
  return context;
};

function checkSections(context: Context, entry: Record<string, unknown>, at: string) {
  if (entry.sections === undefined) return;
  if (!Array.isArray(entry.sections)) { err(context, `${at}.sections`, "must be a list", '[{ key: "contact", label: "Contact", fields: ["phone"] }]'); return; }
  const fieldKeys = isRecord(entry.fields) ? Object.keys(entry.fields) : [];
  const sectionKeys = new Set<string>();
  const placed = new Map<string, string>();
  entry.sections.forEach((section, index) => {
    const sat = `${at}.sections[${index}]`;
    if (!isRecord(section)) { err(context, sat, "must be { key, label, fields }"); return; }
    if (!filled(section.key)) err(context, `${sat}.key`, "required");
    else if (sectionKeys.has(section.key)) err(context, `${sat}.key`, `"${section.key}" is used by another section`, "section keys must be unique in a file");
    else sectionKeys.add(section.key);
    if (!filled(section.label)) err(context, `${sat}.label`, "required — the name editors see");
    if (!Array.isArray(section.fields) || !section.fields.length) { err(context, `${sat}.fields`, "required — the field keys in this section", '["phone", "hours"]'); return; }
    section.fields.forEach((name, fieldIndex) => {
      if (!fieldKeys.includes(name)) err(context, `${sat}.fields[${fieldIndex}]`, `${show(name)} is not a field of this file`, fieldKeys.length ? `use one of ${fieldKeys.join(", ")}` : undefined);
      else if (placed.has(name)) err(context, `${sat}.fields[${fieldIndex}]`, `"${name}" is already in ${placed.get(name)}`, "a field belongs to one section");
      else placed.set(name, sat);
    });
  });
  const loose = fieldKeys.filter((key) => !placed.has(key));
  if (sectionKeys.size && loose.length) warn(context, `${at}.sections`, `${loose.map((key) => `"${key}"`).join(", ")} ${loose.length === 1 ? "is" : "are"} in no section (shown last, under "Other")`);
}

export const assertCmsConfig: (config: unknown, file?: string, onWarnings?: (warnings: Problem[]) => void) => asserts config is CmsConfig = (config, file = "cms.config.ts", onWarnings) => {
  const { errors, warnings } = checkCmsConfig(config);
  if (warnings.length) onWarnings?.(warnings);
  if (errors.length) throw new CmsConfigError(file, errors);
};

export const countConfig = (config: CmsConfig) => ({ files: config.files.length, collections: config.collections.length });
