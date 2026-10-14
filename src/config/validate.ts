/**
 * P2: the full check of a site's cms.config (no file access — the content check is src/check/content.ts).
 * Every mistake is collected in one pass; each problem names its place (e.g. collections[0].fields.items.of.fields.price)
 * and says how to fix it. Warnings never stop the build.
 */
import { COLLECTION_ICONS, FIELD_TYPES, type CmsConfig } from "./index.js";
import { RICH_TEXT_TAGS } from "../check/rich-text-allow.js";

export type Problem = { path: string; message: string; hint?: string };
export type CheckResult = { errors: Problem[]; warnings: Problem[] };

/** Deepest allowed nesting of object / list fields (a list of objects that hold a list of objects = 4). */
// P16a: 8 (was 4) — a real menu is services[] › menu parts[] › packages[] › what is included[] (7 levels).
export const MAX_DEPTH = 8;
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
  text: ["maxLength", "multiline", "pattern", "patternHint", "tokens", "from"],
  richText: ["allow"],
  image: ["alt", "mobile"],
  select: ["options"],
  hours: [],
  object: ["fields", "flat"],
  list: ["of", "ordered", "min", "max", "itemLabel", "fixed"],
  reference: ["to", "multiple", "ordered"],
  tuple: ["items"],
  pick: ["choices"],
  toggle: [],
  number: ["min", "max", "integer"],
  link: [],
  phone: [],
};
const TOP_LEVEL = ["configVersion", "site", "repo", "roles", "contentDirs", "files", "collections", "publish", "media"];

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

/** oldAdminName: where the config still says "owner" (M2: one warning for all of them). */
type Context = { errors: Problem[]; warnings: Problem[]; collectionKeys: Set<string>; oldAdminName: string[] };
const err = (context: Context, path: string, message: string, hint?: string) => context.errors.push({ path, message, ...(hint ? { hint } : {}) });
const warn = (context: Context, path: string, message: string, hint?: string) => context.warnings.push({ path, message, ...(hint ? { hint } : {}) });

const checkBoolean = (context: Context, field: Record<string, unknown>, name: string, at: string) => {
  if (field[name] !== undefined && typeof field[name] !== "boolean") err(context, `${at}.${name}`, `must be true or false (got ${show(field[name])})`);
};
/** P12d: rules = the site's own check, a function (value, content) => problems. */
const checkRules = (context: Context, entry: Record<string, unknown>, at: string) => {
  if (entry.rules !== undefined && typeof entry.rules !== "function") err(context, `${at}.rules`, "must be a function (value, content) => problems", "rules: (value) => value.a && value.b ? [] : [{ path: \"a\", message: \"…\" }]");
};
/** P12b: access: "admin" — the whole file / collection is for admins only ("owner": the old name, M2). */
const checkAccess = (context: Context, entry: Record<string, unknown>, at: string) => {
  if (entry.access === "owner") context.oldAdminName.push(`${at}.access`);
  else if (entry.access !== undefined && entry.access !== "admin") err(context, `${at}.access`, `only "admin" is allowed (got ${show(entry.access)})`, 'write access: "admin" or remove it');
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
  if (field.locked === "owner") context.oldAdminName.push(`${at}.locked`);
  else if (field.locked !== undefined && field.locked !== "admin") err(context, `${at}.locked`, `only "admin" is allowed (got ${show(field.locked)})`, 'write locked: "admin" or remove it');

  switch (type) {
    case "text":
      checkCount(context, field, "maxLength", at, 1);
      checkBoolean(context, field, "multiline", at);
      if (field.pattern !== undefined) {
        if (typeof field.pattern !== "string" || !field.pattern) err(context, `${at}.pattern`, "must be a regular expression as text", 'e.g. pattern: "\\\\d{2}:\\\\d{2}" (a time like 09:30)');
        else { try { new RegExp(field.pattern, "u"); } catch (error) { err(context, `${at}.pattern`, `is not a valid regular expression: ${(error as Error).message}`); } }
      }
      if (field.patternHint !== undefined && (!filled(field.patternHint) || field.pattern === undefined)) err(context, `${at}.patternHint`, field.pattern === undefined ? "needs a pattern" : "must be non-empty text", 'e.g. patternHint: "a time like 09:30"');
      if (field.tokens !== undefined) {
        // P16a: [] = this text holds no {words} at all (a leftover {word} would be printed to visitors).
        if (!Array.isArray(field.tokens)) err(context, `${at}.tokens`, "must be a list of words ([] = none)", 'e.g. tokens: ["phone", "city"]');
        else field.tokens.forEach((token, index) => { if (typeof token !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(token)) err(context, `${at}.tokens[${index}]`, `must be a word (letters, digits, _), got ${show(token)}`, "write it without the braces: phone, not {phone}"); });
      }
      break;
    case "richText":
      if (field.allow !== undefined) {
        if (!Array.isArray(field.allow)) err(context, `${at}.allow`, "must be a list of tags", 'e.g. allow: ["em", "br"]');
        else field.allow.forEach((tag, index) => { if (typeof tag !== "string" || !RICH_TEXT_TAGS.includes(tag)) err(context, `${at}.allow[${index}]`, `${show(tag)} is not a rich-text tag the CMS keeps`, `use some of ${RICH_TEXT_TAGS.join(", ")}`); });
      }
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
      checkBoolean(context, field, "flat", at);
      break;
    case "list":
      if (depth > MAX_DEPTH) { err(context, at, `nested too deep (more than ${MAX_DEPTH} levels of object / list)`, "flatten it or move part of it into a collection with a reference"); break; }
      if (field.of === undefined) err(context, `${at}.of`, "required — the kind of item", 'e.g. f.list(f.text({ label: "Extra" }), { label: "Extras" })');
      else checkField(context, field.of, `${at}.of`, depth + 1);
      checkBoolean(context, field, "ordered", at);
      checkBoolean(context, field, "fixed", at);
      if (field.fixed === true && (field.min !== undefined || field.max !== undefined)) warn(context, `${at}.fixed`, "a fixed list keeps its items, so min / max have no effect");
      checkCount(context, field, "min", at, 0);
      checkCount(context, field, "max", at, 1);
      if (Number.isInteger(field.min) && Number.isInteger(field.max) && (field.min as number) > (field.max as number)) err(context, `${at}.min`, `is bigger than max (${field.min} > ${field.max})`);
      if (field.itemLabel !== undefined && !filled(field.itemLabel)) err(context, `${at}.itemLabel`, "must be non-empty text", 'e.g. itemLabel: "Extra"');
      break;
    case "tuple":
      if (depth > MAX_DEPTH) { err(context, at, `nested too deep (more than ${MAX_DEPTH} levels of object / list)`, "flatten it or move part of it into a collection with a reference"); break; }
      if (!Array.isArray(field.items) || field.items.length < 2) { err(context, `${at}.items`, "required — at least two fields, one per place", 'e.g. f.tuple([f.text({ label: "Service" }), f.text({ label: "Price" })], { label: "Service and price" })'); break; }
      field.items.forEach((item, index) => checkField(context, item, `${at}.items[${index}]`, depth + 1));
      break;
    case "number": {
      checkBoolean(context, field, "integer", at);
      for (const key of ["min", "max"] as const) if (field[key] !== undefined && !(typeof field[key] === "number" && Number.isFinite(field[key]))) err(context, `${at}.${key}`, `must be a number (got ${show(field[key])})`);
      if (typeof field.min === "number" && typeof field.max === "number" && field.min > field.max) err(context, `${at}.min`, `is bigger than max (${field.min} > ${field.max})`);
      break;
    }
    case "pick":
      if (typeof field.choices !== "function") err(context, `${at}.choices`, "required — a function that lists the choices from the record's content", "e.g. choices: (content) => content.menu.map((line) => ({ value: line.id, label: line.name }))");
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
    // P16a: an id made from another field must name a text field of the same object.
    const field = fields[key];
    if (isRecord(field) && field.type === "text" && field.from !== undefined) {
      const source = typeof field.from === "string" ? fields[field.from] : undefined;
      if (!isRecord(source) || source.type !== "text") err(context, `${keyPath(at, key)}.from`, `must name a text field next to it (got ${show(field.from)})`, `e.g. from: "name"`);
    }
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
  const context: Context = { errors: [], warnings: [], collectionKeys: new Set(), oldAdminName: [] };
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
    for (const key of Object.keys(site)) if (!["name", "url", "timezone", "phone", "pages"].includes(key)) err(context, `site.${key}`, "unknown setting", "allowed: name, url, timezone, phone, pages");
    // M4: phone numbers follow the site's country; Link fields may also open site.pages.
    if (site.phone !== undefined) {
      if (!isRecord(site.phone) || typeof site.phone.country !== "string" || !/^[A-Z]{2}$/.test(site.phone.country)) err(context, "site.phone", `must be { country: "<2-letter code>" } (got ${show(site.phone)})`, 'e.g. phone: { country: "US" }');
      else for (const key of Object.keys(site.phone)) if (key !== "country") err(context, `site.phone.${key}`, "unknown setting", "phone has country");
    }
    if (site.pages !== undefined) {
      if (!Array.isArray(site.pages)) err(context, "site.pages", "must be a list of { path, label }", '[{ path: "/booking/", label: "Booking" }]');
      else {
        const seen = new Set<string>();
        site.pages.forEach((page, index) => {
          const where = `site.pages[${index}]`;
          if (!isRecord(page)) { err(context, where, `must be { path, label } (got ${show(page)})`, '{ path: "/booking/", label: "Booking" }'); return; }
          for (const key of Object.keys(page)) if (!["path", "label"].includes(key)) err(context, `${where}.${key}`, "unknown setting", "a page has path and label");
          if (typeof page.path !== "string" || !page.path.startsWith("/") || page.path.startsWith("//") || /\s/.test(page.path)) err(context, `${where}.path`, `must be an address on the site, starting with / (got ${show(page.path)})`, 'e.g. "/booking/"');
          else if (seen.has(page.path)) err(context, `${where}.path`, `${show(page.path)} is listed twice`, "remove the copy");
          else seen.add(page.path);
          if (!filled(page.label)) err(context, `${where}.label`, "required — the page's name editors see", 'e.g. label: "Booking"');
        });
      }
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

  if (config.roles !== undefined && !(Array.isArray(config.roles) && config.roles.length === 2 && (config.roles[0] === "admin" || config.roles[0] === "owner") && config.roles[1] === "editor")) err(context, "roles", `must be ["admin", "editor"] (got ${show(config.roles)})`, "the roles are fixed; remove the line or write it exactly");

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

  // M6: how publishing is told in the admin.
  if (config.publish !== undefined) {
    const publish = config.publish;
    if (!isRecord(publish)) err(context, "publish", "must be { typicalMinutes?, buildCheck? }", '{ typicalMinutes: "5–10", buildCheck: "Workers Builds" }');
    else {
      for (const key of Object.keys(publish)) if (!["typicalMinutes", "buildCheck"].includes(key)) err(context, `publish.${key}`, "unknown setting", "publish has typicalMinutes and buildCheck");
      if (publish.typicalMinutes !== undefined && (typeof publish.typicalMinutes !== "string" || !/^\d{1,3}(?:\s*[–-]\s*\d{1,3})?$/.test(publish.typicalMinutes))) err(context, "publish.typicalMinutes", `must be minutes like "5" or "5–10" (got ${show(publish.typicalMinutes)})`, 'e.g. typicalMinutes: "5–10"');
      if (publish.buildCheck !== undefined && !filled(publish.buildCheck)) err(context, "publish.buildCheck", "must be the name of the GitHub check run that builds the site", 'e.g. buildCheck: "Workers Builds"');
    }
  }
  if (config.media !== undefined) {
    if (!isRecord(config.media)) err(context, "media", "must be { dir?, base?, maxBytes?, names? }");
    else {
      const media = config.media;
      for (const key of Object.keys(media)) if (!["dir", "base", "maxBytes", "names"].includes(key)) err(context, `media.${key}`, "is not a media setting", "media has dir, base, maxBytes and names");
      const FOLDER = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
      if (media.base !== undefined && (typeof media.base !== "string" || !/^(\/[a-z0-9][a-z0-9_-]*)+$/.test(media.base))) err(context, "media.base", `must be an address like "/assets/uploads" (got ${show(media.base)})`);
      if (media.dir !== undefined) {
        if (typeof media.dir !== "string" || !FOLDER.test(media.dir)) err(context, "media.dir", `must be a folder of the repository in lowercase letters, digits, "-" and "_" (got ${show(media.dir)})`, 'e.g. "public/assets/uploads"');
        else if (!/^public\//.test(media.dir) && media.base === undefined) err(context, "media.dir", "is outside public/, so the address uploads are served at is needed", 'add base, e.g. base: "/assets/uploads"');
      }
      // P12h: images by name in the site's manifest.
      const names = media.names;
      if (names !== undefined) {
        if (!isRecord(names)) err(context, "media.names", "must be { manifest, url?, width?, root?, exclude? }");
        else {
          for (const key of Object.keys(names)) if (!["manifest", "url", "width", "root", "exclude"].includes(key)) err(context, `media.names.${key}`, "is not a names setting", "names has manifest, url, width, root and exclude");
          if (typeof names.manifest !== "string" || !/^[A-Za-z0-9_.\/-]+\.json$/.test(names.manifest) || names.manifest.includes("..")) err(context, "media.names.manifest", `required — the site's image manifest, a .json file of the repository (got ${show(names.manifest)})`, 'e.g. "src/data/image-manifest.json"');
          if (names.url !== undefined && (typeof names.url !== "string" || !names.url.includes("{path}") || !names.url.includes("{width}"))) err(context, "media.names.url", `must hold {path} and {width} (got ${show(names.url)})`, 'e.g. "{path}-{width}.webp"');
          if (names.width !== undefined && !(Number.isInteger(names.width) && (names.width as number) >= 100 && (names.width as number) <= 4000)) err(context, "media.names.width", `must be a whole number of pixels from 100 to 4000 (got ${show(names.width)})`);
          if (names.root !== undefined && (typeof names.root !== "string" || !FOLDER.test(names.root))) err(context, "media.names.root", `must be a folder of the repository (got ${show(names.root)})`, 'e.g. "assets-src/images"');
          if (names.exclude !== undefined && (!Array.isArray(names.exclude) || names.exclude.some((entry) => typeof entry !== "string" || !entry))) err(context, "media.names.exclude", "must be a list of name beginnings", 'e.g. ["brand/"]');
          const dir = typeof media.dir === "string" ? media.dir : "public/assets/uploads";
          if (typeof names.root !== "string" || !dir.startsWith(`${names.root}/`)) warn(context, "media.names.root", `uploads cannot be named: media.dir (${dir}) is not inside root`, "set root to the folder the site's build makes images from, and dir inside it");
        }
      }
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
      const FILE_SETTINGS = ["key", "label", "path", "format", "preview", "sections", "access", "rules", "fields", "group", "area", "description", "outline", "toggle", "layout", "seo"];
      for (const key of Object.keys(entry)) if (!FILE_SETTINGS.includes(key)) err(context, `${at}.${key}`, "unknown setting", `allowed: ${FILE_SETTINGS.join(", ")}`);
      checkRules(context, entry, at);
      checkAccess(context, entry, at);
      if (!filled(entry.key)) err(context, `${at}.key`, "required — a short id", 'e.g. "site"');
      else if (!RESOURCE_KEY.test(entry.key)) err(context, `${at}.key`, `${show(entry.key)} is not a valid key`, 'lowercase letters, digits and "-", starting with a letter');
      if (!filled(entry.label)) err(context, `${at}.label`, "required — the name editors see", 'e.g. "Salon info"');
      if (entry.format !== undefined && entry.format !== "json") err(context, `${at}.format`, entry.format === "yaml" || entry.format === "yml" ? "YAML is not supported" : `must be "json" (got ${show(entry.format)})`, 'write format: "json" and store the content as JSON');
      if (entry.path === undefined) err(context, `${at}.path`, "required — the content file", 'e.g. "src/data/site.json"');
      else checkPath(context, entry.path, `${at}.path`, dirs, ".json", "src/data/site.json", paths);
      checkPreview(context, entry.preview, `${at}.preview`, []);
      checkFields(context, entry.fields, `${at}.fields`);
      checkSections(context, entry, at);
      checkPageSettings(context, entry, at);
    });
    checkUniqueKeys(context, config.files, "files", keys);
  }

  if (!Array.isArray(collections)) err(context, "collections", "required — a list (may be empty)", "collections: []");
  else {
    collections.forEach((entry, index) => {
      const at = `collections[${index}]`;
      if (!isRecord(entry)) { err(context, at, "must be an object", "{ key, label, itemLabel, store, fields }"); return; }
      for (const key of Object.keys(entry)) if (!["key", "label", "itemLabel", "icon", "under", "store", "status", "preview", "order", "access", "fixed", "rules", "list", "labels", "layout", "sections", "ready", "fields"].includes(key)) err(context, `${at}.${key}`, "unknown setting", "allowed: key, label, itemLabel, icon, under, store, status, preview, order, access, fixed, rules, fields");
      if (entry.under !== undefined) {
        const parent = collections.find((other) => isRecord(other) && other.key === entry.under);
        if (!filled(entry.under) || !isRecord(parent)) err(context, `${at}.under`, `${show(entry.under)} is not a collection of this config`, 'the key of the collection whose tabs it joins, e.g. "products"');
        else if (parent.key === entry.key) err(context, `${at}.under`, "a collection cannot be a tab of itself", "remove under");
        else if (parent.under !== undefined) err(context, `${at}.under`, `${show(entry.under)} is itself a tab of ${show(parent.under)}`, `use ${show(parent.under)}: tabs are one level deep`);
      }
      if (entry.icon !== undefined && !(COLLECTION_ICONS as readonly unknown[]).includes(entry.icon)) err(context, `${at}.icon`, `${show(entry.icon)} is not an icon of the admin`, `use one of ${COLLECTION_ICONS.join(", ")}`);
      checkRules(context, entry, at);
      checkAccess(context, entry, at);
      checkBoolean(context, entry, "fixed", at);
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
        if (!isRecord(status) || !filled(status.field) || !filled(status.live) || !filled(status.draft) || (status.archived !== undefined && !filled(status.archived))) err(context, `${at}.status`, "must be { field, live, draft, archived? }", '{ field: "status", live: "published", draft: "draft", archived: "archived" }');
        else {
          for (const key of Object.keys(status)) if (!["field", "live", "draft", "archived"].includes(key)) err(context, `${at}.status.${key}`, "unknown setting", "allowed: field, live, draft, archived");
          if (status.live === status.draft) err(context, `${at}.status.draft`, `must differ from live (both ${show(status.live)})`);
          if (status.archived !== undefined && (status.archived === status.live || status.archived === status.draft)) err(context, `${at}.status.archived`, `must differ from live and draft (got ${show(status.archived)})`);
          const statusField = isRecord(entry.fields) ? entry.fields[status.field] : undefined;
          const options = isRecord(statusField) && statusField.type === "select" && Array.isArray(statusField.options) ? (statusField.options as unknown[]) : undefined;
          if (options) for (const name of (status.archived !== undefined ? ["live", "draft", "archived"] : ["live", "draft"]) as Array<"live" | "draft" | "archived">) if (!options.includes(status[name])) err(context, `${at}.status.${name}`, `${show(status[name])} is not an option of the "${status.field}" select`, `add it to options or use one of ${options.map((option) => show(option)).join(", ")}`);
        }
      }
      checkCollectionList(context, entry, at);
      // M9: the record editor.
      if (entry.layout !== undefined && entry.layout !== "record" && entry.layout !== "page") err(context, `${at}.layout`, `${show(entry.layout)} is not a layout of a collection`, 'use "record" or "page"');
      if (entry.layout === "page" && !filled(entry.preview)) err(context, `${at}.layout`, '"page" shows the record\'s page, so it needs a preview', 'add preview: "/<page>/{id}/", or use "record"');
      checkSections(context, entry, at);
      if (entry.ready !== undefined) {
        if (!Array.isArray(entry.ready)) err(context, `${at}.ready`, "must be a list", '[{ field: "categories", label: "At least one category" }]');
        else entry.ready.forEach((item, index) => {
          const where = `${at}.ready[${index}]`;
          if (!isRecord(item) || typeof item.field !== "string" || fieldTypeAt(entry.fields, item.field) === undefined) err(context, `${where}.field`, `${show(isRecord(item) ? item.field : item)} is not a field of this collection`, isRecord(entry.fields) ? `use one of ${Object.keys(entry.fields).join(", ")}` : undefined);
          else {
            for (const key of Object.keys(item)) if (key !== "field" && key !== "label") err(context, `${where}.${key}`, "unknown setting", "allowed: field, label");
            if (item.label !== undefined && !filled(item.label)) err(context, `${where}.label`, "must be a word or a few words", '"At least one category"');
          }
        });
      }
    });
    checkUniqueKeys(context, collections, "collections", keys);
  }
  // M2: "owner" is the old name of the Admin level — it works; one warning names every place.
  if (context.oldAdminName.length) warn(context, context.oldAdminName[0], `"owner" is the old name of "admin" (${context.oldAdminName.length} ${context.oldAdminName.length === 1 ? "place" : "places"}: ${context.oldAdminName.slice(0, 5).join(", ")}${context.oldAdminName.length > 5 ? ", …" : ""})`, 'write locked: "admin" / access: "admin" — it works the same');
  return { errors: context.errors, warnings: context.warnings };
};

/** M7: the type of the field at a key or a path into objects ("popup.enabled", "seo.title"), or undefined. */
const fieldTypeAt = (fields: unknown, name: string): string | undefined => {
  if (!isRecord(fields) || typeof name !== "string" || !name) return undefined;
  if (isRecord(fields[name])) return String((fields[name] as Record<string, unknown>).type);
  const parts = name.split(".");
  for (let end = parts.length - 1; end > 0; end -= 1) {
    const field = fields[parts.slice(0, end).join(".")];
    if (isRecord(field) && field.type === "object") return fieldTypeAt(field.fields, parts.slice(end).join("."));
  }
  return undefined;
};

/** M7: group / area / description / outline / toggle / layout "seo" of a file (the Mr Spa CMS's Pages and areas). */
/** M8: `list` (columns, filters, search, detail, duplicate) and `labels` (add, search, many) of a collection. */
function checkCollectionList(context: Context, entry: Record<string, unknown>, at: string) {
  const labels = entry.labels;
  if (labels !== undefined) {
    if (!isRecord(labels)) err(context, `${at}.labels`, "must be { add?, search?, many? }", '{ add: "Add product", search: "Search by name or SKU" }');
    else for (const [key, value] of Object.entries(labels)) {
      if (!["add", "search", "many"].includes(key)) err(context, `${at}.labels.${key}`, "unknown setting", "allowed: add, search, many");
      else if (!filled(value)) err(context, `${at}.labels.${key}`, "must be a word or a few words", key === "add" ? '"Add product"' : key === "many" ? '"posts"' : '"Search posts"');
    }
  }
  const list = entry.list;
  if (list === undefined) return;
  if (!isRecord(list)) { err(context, `${at}.list`, "must be { columns?, filters?, search?, detail?, duplicate? }"); return; }
  for (const key of Object.keys(list)) if (!["columns", "filters", "search", "detail", "duplicate"].includes(key)) err(context, `${at}.list.${key}`, "unknown setting", "allowed: columns, filters, search, detail, duplicate");
  const status = isRecord(entry.status) ? entry.status : undefined;
  const isField = (name: unknown) => typeof name === "string" && (fieldTypeAt(entry.fields, name) !== undefined || name === status?.field);
  const hint = isRecord(entry.fields) ? `use one of ${Object.keys(entry.fields).join(", ")}` : undefined;
  const values = (value: unknown, where: string) => {
    if (value === undefined) return;
    if (!isRecord(value) || !Object.values(value).every(filled)) err(context, where, "must map a stored value to the words shown", '{ en: "English", vi: "Tiếng Việt" }');
  };
  for (const name of ["columns", "filters"] as const) {
    const entries = list[name];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) { err(context, `${at}.list.${name}`, "must be a list", '[{ field: "category" }]'); continue; }
    entries.forEach((item, index) => {
      const where = `${at}.list.${name}[${index}]`;
      if (!isRecord(item)) { err(context, where, "must be { field, label? }", '{ field: "category" }'); return; }
      const allowed = name === "columns" ? ["field", "label", "values", "format"] : ["field", "label", "values", "all"];
      for (const key of Object.keys(item)) if (!allowed.includes(key)) err(context, `${where}.${key}`, "unknown setting", `allowed: ${allowed.join(", ")}`);
      if (!isField(item.field)) { err(context, `${where}.field`, `${show(item.field)} is not a field of this collection`, hint); return; }
      if (item.label !== undefined && !filled(item.label)) err(context, `${where}.label`, "must be a word or a few words");
      values(item.values, `${where}.values`);
      if (name === "columns" && item.format !== undefined && item.format !== "date") err(context, `${where}.format`, `${show(item.format)} is not a format`, 'use "date"');
      if (name === "filters") {
        const type = item.field === status?.field ? "status" : fieldTypeAt(entry.fields, String(item.field));
        if (!["status", "select", "toggle", "reference"].includes(String(type))) err(context, `${where}.field`, `a ${type} field cannot be a filter`, "filter by a select, toggle or reference field, or by the status");
        if (item.all !== undefined && !filled(item.all)) err(context, `${where}.all`, "must be a word or a few words", '"All categories"');
      }
    });
  }
  if (list.search !== undefined) {
    if (!Array.isArray(list.search)) err(context, `${at}.list.search`, "must be a list of fields", '["sku"]');
    else list.search.forEach((name, index) => { if (!isField(name)) err(context, `${at}.list.search[${index}]`, `${show(name)} is not a field of this collection`, hint); });
  }
  if (list.detail !== undefined) {
    if (!filled(list.detail) || !/\{[^}]+\}/.test(list.detail)) err(context, `${at}.list.detail`, "must be words with at least one {field}", '"SKU {sku}"');
    else for (const match of list.detail.matchAll(/\{([^}]+)\}/g)) if (!isField(match[1])) err(context, `${at}.list.detail`, `{${match[1]}} is not a field of this collection`, hint);
  }
  const duplicate = list.duplicate;
  if (duplicate !== undefined && typeof duplicate !== "boolean") {
    if (!isRecord(duplicate) || Object.keys(duplicate).some((key) => key !== "clear") || (duplicate.clear !== undefined && !Array.isArray(duplicate.clear))) err(context, `${at}.list.duplicate`, "must be true or { clear: [fields] }", '{ clear: ["sku"] }');
    else (duplicate.clear as unknown[] | undefined)?.forEach((name, index) => { if (!isField(name)) err(context, `${at}.list.duplicate.clear[${index}]`, `${show(name)} is not a field of this collection`, hint); });
  }
  if (duplicate && entry.fixed === true) err(context, `${at}.list.duplicate`, "a fixed collection gets no new record, so no copy either", "remove duplicate or fixed");
}

function checkPageSettings(context: Context, entry: Record<string, unknown>, at: string) {
  if (entry.group !== undefined && !filled(entry.group)) err(context, `${at}.group`, "must be the name of a group on Pages", 'e.g. group: "Policies"');
  checkBoolean(context, entry, "area", at);
  if (entry.description !== undefined && !filled(entry.description)) err(context, `${at}.description`, "must be a short line about it", 'e.g. description: "Logo, phone number and menu"');
  if (entry.area === true && entry.description === undefined) warn(context, `${at}.description`, "an area is listed under “Across the whole site” with a line about it", 'e.g. description: "Contact details, links and social"');
  if (entry.area === true && entry.group !== undefined) err(context, `${at}.group`, "an area is always under “Across the whole site”", "remove group, or area");
  if (entry.outline !== undefined && !filled(entry.outline)) err(context, `${at}.outline`, "must be a CSS selector of the area on the page", 'e.g. outline: "header"');
  if (entry.toggle !== undefined && fieldTypeAt(entry.fields, String(entry.toggle)) !== "toggle") err(context, `${at}.toggle`, `${show(entry.toggle)} is not a toggle field of this file`, 'e.g. toggle: "enabled" with enabled: f.toggle({ label: "Show on website" })');
  if (entry.layout !== undefined && entry.layout !== "seo") err(context, `${at}.layout`, `unknown layout ${show(entry.layout)}`, 'only "seo" (Search & sharing)');
  if (entry.layout === "seo") {
    const seo = entry.seo;
    if (!isRecord(seo)) { err(context, `${at}.seo`, "required with layout \"seo\" — which fields are the title and the description", '{ title: "title", description: "description", siteName: "siteName", image: "image" }'); return; }
    for (const key of Object.keys(seo)) if (!["title", "description", "siteName", "image"].includes(key)) err(context, `${at}.seo.${key}`, "unknown setting", "seo has title, description, siteName and image");
    for (const [key, type] of [["title", "text"], ["description", "text"], ["siteName", "text"], ["image", "image"]] as const) {
      if (seo[key] === undefined) { if (key === "title" || key === "description") err(context, `${at}.seo.${key}`, "required — the field it is", `e.g. ${key}: "${key}"`); continue; }
      if (fieldTypeAt(entry.fields, String(seo[key])) !== type) err(context, `${at}.seo.${key}`, `${show(seo[key])} is not a ${type} field of this file`);
    }
  } else if (entry.seo !== undefined) err(context, `${at}.seo`, "is only for layout \"seo\"", 'add layout: "seo", or remove seo');
}

/**
 * M3c: where a section entry that is not a field key points: the field key it starts with, or why it cannot be
 * shown ("services[0].card": services is a fixed list of objects with a card; "hero.title": hero is an object).
 */
const sectionPath = (fields: Record<string, unknown>, name: string): { top: string } | { problem: string } => {
  const steps: Array<string | number> = [];
  for (const match of name.matchAll(/\[(\d+)\]|\.?([^.[\]]+)/g)) steps.push(match[1] !== undefined ? Number(match[1]) : match[2]);
  // The longest start that is a field key (keys may hold dots: "seo.title").
  let top: string | undefined; let used = 0;
  for (let end = steps.length; end > 0 && !top; end -= 1) {
    const words = steps.slice(0, end);
    if (words.every((step) => typeof step === "string") && words.join(".") in fields) { top = words.join("."); used = end; }
  }
  if (!top) return { problem: `${show(name)} is not a field of this file` };
  let field = fields[top] as Record<string, unknown> | undefined;
  for (const step of steps.slice(used)) {
    if (!isRecord(field)) return { problem: `${show(name)} does not lead to a field` };
    if (typeof step === "number") {
      if (field.type !== "list") return { problem: `${show(name)}: [${step}] is only for a list` };
      if (field.fixed !== true) return { problem: `${show(name)}: a section can point into a list only when the list is fixed (its items stay in place)` };
      field = field.of as Record<string, unknown>;
      continue;
    }
    if (field.type !== "object" || !isRecord(field.fields) || !(step in field.fields)) return { problem: `${show(name)}: ${show(step)} is not a field there` };
    field = (field.fields as Record<string, unknown>)[step] as Record<string, unknown>;
  }
  return { top };
};

function checkSections(context: Context, entry: Record<string, unknown>, at: string) {
  if (entry.sections === undefined) return;
  if (!Array.isArray(entry.sections)) { err(context, `${at}.sections`, "must be a list", '[{ key: "contact", label: "Contact", fields: ["phone"] }]'); return; }
  const fieldKeys = isRecord(entry.fields) ? Object.keys(entry.fields) : [];
  const sectionKeys = new Set<string>();
  const placed = new Map<string, string>();
  /** M3c: paths into a field, and the fields that sections show in parts. */
  const paths = new Map<string, string>();
  const inside = new Map<string, string>();
  entry.sections.forEach((section, index) => {
    const sat = `${at}.sections[${index}]`;
    if (!isRecord(section)) { err(context, sat, "must be { key, label, fields }"); return; }
    if (!filled(section.key)) err(context, `${sat}.key`, "required");
    else if (sectionKeys.has(section.key)) err(context, `${sat}.key`, `"${section.key}" is used by another section`, "section keys must be unique in a file");
    else sectionKeys.add(section.key);
    if (!filled(section.label)) err(context, `${sat}.label`, "required — the name editors see");
    if (!Array.isArray(section.fields) || !section.fields.length) { err(context, `${sat}.fields`, "required — the field keys in this section", '["phone", "hours"]'); return; }
    section.fields.forEach((name, fieldIndex) => {
      const where = `${sat}.fields[${fieldIndex}]`;
      if (typeof name !== "string" || !filled(name)) { err(context, where, "must be a field key or a path into one", '"phone", "hero.title", "services[0].card"'); return; }
      if (fieldKeys.includes(name)) {
        if (placed.has(name)) err(context, where, `"${name}" is already in ${placed.get(name)}`, "a field belongs to one section");
        else if (inside.has(name)) err(context, where, `parts of "${name}" are already in ${inside.get(name)}`, "a field belongs to one section: list its parts, or the whole field");
        else placed.set(name, sat);
        return;
      }
      const target = isRecord(entry.fields) ? sectionPath(entry.fields, name) : { problem: `${show(name)} is not a field of this file` };
      if ("problem" in target) { err(context, where, target.problem, fieldKeys.length ? `a field key (${fieldKeys.slice(0, 6).join(", ")}${fieldKeys.length > 6 ? ", …" : ""}) or a path into an object / a fixed list, e.g. "services[0].card"` : undefined); return; }
      if (paths.has(name)) err(context, where, `"${name}" is already in ${paths.get(name)}`, "a field belongs to one section");
      else if (placed.has(target.top)) err(context, where, `"${target.top}" is already in ${placed.get(target.top)} as a whole`, "list its parts, or the whole field");
      else { paths.set(name, sat); if (!inside.has(target.top)) inside.set(target.top, sat); }
    });
  });
  const loose = fieldKeys.filter((key) => !placed.has(key) && !inside.has(key));
  if (sectionKeys.size && loose.length) warn(context, `${at}.sections`, `${loose.map((key) => `"${key}"`).join(", ")} ${loose.length === 1 ? "is" : "are"} in no section (shown last, under "Other")`);
}

export const assertCmsConfig: (config: unknown, file?: string, onWarnings?: (warnings: Problem[]) => void) => asserts config is CmsConfig = (config, file = "cms.config.ts", onWarnings) => {
  const { errors, warnings } = checkCmsConfig(config);
  if (warnings.length) onWarnings?.(warnings);
  if (errors.length) throw new CmsConfigError(file, errors);
};

export const countConfig = (config: CmsConfig) => ({ files: config.files.length, collections: config.collections.length });
