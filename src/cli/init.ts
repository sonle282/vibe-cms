/**
 * M15 `vibe-cms init`: a first draft of cms.config.ts from the site's own JSON content, for a site that has no CMS yet
 * (design §H.1 point 4, track C). It reads every *.json under src/data and src/content (or --data), and writes:
 *
 * - a JSON object → a file (a page): key and label from the file name; `preview` when a page of that name exists;
 *   `group: "Policies"` for policy / privacy / terms files; `area: true` for header / footer / popup / banner files;
 *   `layout: "seo"` for a file named seo with a title and a description; sections = its top-level groups;
 * - a JSON list of records that all have a unique id / slug / key → a collection (store json-array);
 * - every value → a field, guessed from its key and its values: text (multiline, a date pattern), rich text, image,
 *   link, phone, number, toggle, opening hours, object, list.
 *
 * The guesses are checked against the content itself (the same check the build runs): a field the content does not
 * pass becomes plain text, so the draft always checks OK on the site as it is. Nothing is required, nothing is locked.
 *
 * It also lists where the templates print a value of that content ({home.hero.title}), with the `data-cms-field` to
 * add there so the preview can point at it (design §D). It never overwrites cms.config.ts without --force.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { checkRecordValues } from "../check/values.js";
import { checkCmsConfig, DEFAULT_CONTENT_DIRS, type CmsConfig, type Field } from "../config/index.js";
import { CliError, packageVersion, type Log } from "./util.js";

export type InitOptions = {
  root: string; log: Log;
  data?: string; out?: string; force?: boolean; dryRun?: boolean;
  name?: string; url?: string; repo?: string; branch?: string;
  /** Tests: what git says (remote URL, default branch); default: ask git. */
  git?: { remote?: string; branch?: string };
};

// ---------------------------------------------------------------- guesses

type Guess =
  | { type: "text"; multiline?: boolean; date?: boolean }
  | { type: "richText" } | { type: "image" } | { type: "link" } | { type: "phone" } | { type: "toggle" } | { type: "hours" }
  | { type: "number"; integer?: boolean }
  | { type: "object"; fields: Spec }
  | { type: "list"; of: Guess; itemLabel: string };
type Entry = { key: string; label: string; guess: Guess };
type Spec = Entry[];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IMAGE_KEY = /(image|img|photo|picture|thumbnail|thumb|avatar|logo|cover|poster)s?$/i;
const IMAGE_VALUE = /\.(avif|gif|jpe?g|png|svg|webp)(\?[^\s]*)?$/i;
const PHONE_KEY = /(phone|telephone|tel)$/i;
const LINK_KEY = /(href|url|link)$/i;
const LINK_VALUE = /^(\/|https?:\/\/|tel:|mailto:|#)\S*$/;
const HTML = /<\/?(p|br|strong|em|b|i|a|ul|ol|li|h[1-6]|span|div|blockquote)\b[^>]*>/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_KEYS = new Set(["days", "label", "open", "close", "closed"]);

const ACRONYMS: Record<string, string> = { seo: "SEO", faq: "FAQ", faqs: "FAQs", id: "ID", url: "URL", cta: "CTA", sms: "SMS" };
/** "heroTitle" / "hero_title" / "hero-title" → "Hero title"; "seo" → "SEO". */
export const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase().split(" ").map((word) => ACRONYMS[word] ?? word).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : key;
};
const singular = (word: string) => (/ies$/i.test(word) ? word.replace(/ies$/i, "y") : /(ss|us)$/i.test(word) ? word : word.replace(/s$/i, ""));

const looksLikeHours = (items: unknown[]) => items.length > 0 && items.every((item) => isRecord(item) && Array.isArray(item.days) && Object.keys(item).every((key) => DAY_KEYS.has(key)));

const guessStrings = (key: string, values: string[]): Guess => {
  const filled = values.filter((value) => value.trim());
  if (IMAGE_KEY.test(key) || (filled.length && filled.every((value) => IMAGE_VALUE.test(value)))) return { type: "image" };
  if (PHONE_KEY.test(key)) return { type: "phone" };
  if (LINK_KEY.test(key) || (filled.length && filled.every((value) => LINK_VALUE.test(value)))) return { type: "link" };
  if (values.some((value) => HTML.test(value))) return { type: "richText" };
  if (filled.length && filled.every((value) => DATE.test(value))) return { type: "text", date: true };
  if (values.some((value) => value.includes("\n") || value.length > 160)) return { type: "text", multiline: true };
  return { type: "text" };
};

/** The fields of records (an object, or the items of a list): every key in the order first seen. */
const specOf = (records: Array<Record<string, unknown>>, notes: string[], where: string, skip: readonly string[] = []): Spec => {
  const keys: string[] = [];
  for (const record of records) for (const key of Object.keys(record)) if (!keys.includes(key) && !skip.includes(key)) keys.push(key);
  const spec: Spec = [];
  for (const key of keys) {
    if (!FIELD_KEY.test(key)) { notes.push(`${where}${key}: not a usable field name (letters, digits and _ only) — left out`); continue; }
    const guess = guessValue(key, records.map((record) => record[key]), notes, `${where}${key}`);
    if (guess) spec.push({ key, label: humanize(key), guess });
  }
  return spec;
};

const guessValue = (key: string, values: unknown[], notes: string[], where: string): Guess | undefined => {
  const present = values.filter((value) => value !== undefined && value !== null);
  if (!present.length) { notes.push(`${where}: always empty (null) — left out`); return undefined; }
  if (present.every((value) => typeof value === "boolean")) return { type: "toggle" };
  if (present.every((value) => typeof value === "number")) return { type: "number", ...(present.every((value) => Number.isInteger(value)) ? { integer: true } : {}) };
  if (present.every((value) => typeof value === "string")) return guessStrings(key, present as string[]);
  if (present.every(Array.isArray)) {
    const items = (present as unknown[][]).flat();
    if (looksLikeHours(items)) return { type: "hours" };
    const itemKey = singular(key);
    if (!items.length) return { type: "list", of: { type: "text" }, itemLabel: humanize(itemKey) };
    const of = guessValue(itemKey, items, notes, `${where}[]`);
    return of ? { type: "list", of, itemLabel: humanize(itemKey) } : undefined;
  }
  // An image is a path or { src, alt?, mobile? } — both may be used in one list.
  const imageObject = (value: unknown) => isRecord(value) && typeof value.src === "string" && Object.keys(value).every((name) => ["src", "alt", "mobile"].includes(name));
  if (present.some(imageObject) && present.every((value) => imageObject(value) || typeof value === "string")) return { type: "image" };
  if (present.every(isRecord)) {
    const records = present as Array<Record<string, unknown>>;
    const fields = specOf(records, notes, `${where}.`);
    return fields.length ? { type: "object", fields } : undefined;
  }
  notes.push(`${where}: mixed kinds of values (${[...new Set(present.map((value) => (Array.isArray(value) ? "list" : typeof value)))].join(", ")}) — left out`);
  return undefined;
};

// ---------------------------------------------------------------- guesses → fields (to check) and → code (to write)

const toField = (entry: Entry): Field => {
  const base = { label: entry.label };
  const guess = entry.guess;
  switch (guess.type) {
    case "text": return { type: "text", ...base, ...(guess.multiline ? { multiline: true } : {}), ...(guess.date ? { pattern: "\\d{4}-\\d{2}-\\d{2}", patternHint: "a date like 2026-10-14" } : {}) };
    case "number": return { type: "number", ...base, ...(guess.integer ? { integer: true } : {}) };
    case "object": return { type: "object", ...base, fields: toFields(guess.fields) };
    case "list": return { type: "list", ...base, itemLabel: guess.itemLabel, of: toField({ key: "", label: guess.itemLabel, guess: guess.of }) };
    default: return { type: guess.type, ...base } as Field;
  }
};
const toFields = (spec: Spec): Record<string, Field> => Object.fromEntries(spec.map((entry) => [entry.key, toField(entry)]));

const q = (text: string) => JSON.stringify(text);
const keyCode = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : q(key));
const fieldCode = (entry: Entry, indent: string): string => {
  const label = `label: ${q(entry.label)}`;
  const guess = entry.guess;
  switch (guess.type) {
    case "text": return `f.text({ ${label}${guess.multiline ? ", multiline: true" : ""}${guess.date ? ', pattern: "\\\\d{4}-\\\\d{2}-\\\\d{2}", patternHint: "a date like 2026-10-14"' : ""} })`;
    case "number": return `f.number({ ${label}${guess.integer ? ", integer: true" : ""} })`;
    case "object": return `f.object({ ${label}, fields: {\n${fieldsCode(guess.fields, `${indent}  `)}${indent}} })`;
    case "list": return `f.list(${fieldCode({ key: "", label: guess.itemLabel, guess: guess.of }, indent)}, { ${label}, itemLabel: ${q(guess.itemLabel)} })`;
    default: return `f.${guess.type}({ ${label} })`;
  }
};
const fieldsCode = (spec: Spec, indent: string) => spec.map((entry) => `${indent}${keyCode(entry.key)}: ${fieldCode(entry, indent)},\n`).join("");

// ---------------------------------------------------------------- downgrade what the content does not pass

/** "hero.items[2].title" / 'a["b c"]' → ["hero", "items", "title"] (list indexes dropped: a list's items share a field). */
const pathKeys = (path: string) => [...path.matchAll(/\.?([A-Za-z_][A-Za-z0-9_]*)|\["((?:[^"\\]|\\.)*)"\]|\[\d+\]/g)].map((match) => match[1] ?? (match[2] !== undefined ? JSON.parse(`"${match[2]}"`) : undefined)).filter((key): key is string => key !== undefined);

/** Make the field at `keys` plain text (or leave it out when it is plain text already). true = something changed. */
const downgrade = (spec: Spec, keys: string[], notes: string[], where: string): boolean => {
  const [key, ...rest] = keys;
  const index = spec.findIndex((entry) => entry.key === key);
  if (index < 0) return false;
  const entry = spec[index];
  // The innermost guess under the lists (a list of lists of images → the image), and how to replace it.
  let get = () => entry.guess;
  let set = (guess: Guess) => { entry.guess = guess; };
  for (let current = get(); current.type === "list"; current = get()) { const list = current; get = () => list.of; set = (guess) => { list.of = guess; }; }
  const inner = get();
  if (rest.length && inner.type === "object") return downgrade(inner.fields, rest, notes, `${where}${key}.`);
  if (inner.type === "text" && !inner.date) { spec.splice(index, 1); notes.push(`${where}${key}: its values do not all fit one kind — left out`); return true; }
  set({ type: "text", multiline: true });
  notes.push(`${where}${key}: guessed as ${inner.type === "text" ? "a date" : inner.type}, but the content does not fit — plain text`);
  return true;
};

/** Phone numbers written the US way ("(215) 772-1111", "215-772-1111") → site.phone.country "US". */
const US_PHONE = /^(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const phoneValues = (value: unknown, key = ""): string[] => (typeof value === "string" ? (PHONE_KEY.test(key) ? [value] : []) : Array.isArray(value) ? value.flatMap((item) => phoneValues(item, key)) : isRecord(value) ? Object.entries(value).flatMap(([name, item]) => phoneValues(item, name)) : []);

// ---------------------------------------------------------------- the site: names, address, repository

const readSiteFacts = (root: string, options: InitOptions) => {
  const pkg = existsSync(join(root, "package.json")) ? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string }) : {};
  const astro = ["astro.config.mjs", "astro.config.ts", "astro.config.js"].map((file) => join(root, file)).find(existsSync);
  const siteUrl = astro ? /\bsite\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/.exec(readFileSync(astro, "utf8"))?.[1] : undefined;
  const git = options.git ?? readGit(root);
  const fromRemote = git.remote ? /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(git.remote) : null;
  const [owner, name] = options.repo ? options.repo.split("/") : fromRemote ? [fromRemote[1], fromRemote[2]] : ["OWNER", "REPOSITORY"];
  if (options.repo && (!owner || !name)) throw new CliError("--repo must be <owner>/<name>", "e.g. --repo my-org/my-site");
  const url = (options.url ?? siteUrl ?? "https://example.com").replace(/\/+$/, "");
  const siteName = options.name ?? (pkg.name ? humanizeTitle(pkg.name.replace(/^@[^/]+\//, "")) : humanizeTitle(basename(root)));
  return { siteName, url, owner, repoName: name, branch: options.branch ?? git.branch ?? "main", guessed: { url: !options.url && !siteUrl, repo: !options.repo && !fromRemote } };
};
const humanizeTitle = (name: string) => name.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
const readGit = (root: string): { remote?: string; branch?: string } => {
  const head = join(root, ".git", "HEAD");
  const config = join(root, ".git", "config");
  const remote = existsSync(config) ? /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(readFileSync(config, "utf8"))?.[1] : undefined;
  const originHead = join(root, ".git", "refs", "remotes", "origin", "HEAD");
  const branch = existsSync(originHead) ? /refs\/remotes\/origin\/(\S+)/.exec(readFileSync(originHead, "utf8"))?.[1] : existsSync(head) ? /ref: refs\/heads\/(\S+)/.exec(readFileSync(head, "utf8"))?.[1] : undefined;
  return { ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) };
};

// ---------------------------------------------------------------- the content

type FileDraft = { kind: "file"; key: string; label: string; path: string; spec: Spec; preview?: string; group?: string; area?: boolean; seo?: { title: string; description: string; image?: string }; sections?: Array<{ key: string; label: string; fields: string[] }>; data: Record<string, unknown> };
type CollectionDraft = { kind: "collection"; key: string; label: string; itemLabel: string; path: string; idField: string; spec: Spec; data: Array<Record<string, unknown>> };

const walkJson = (dir: string): string[] => readdirSync(dir).sort().flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : walkJson(full);
  return extname(name).toLowerCase() === ".json" && !/manifest/i.test(name) ? [full] : [];
});
const resourceKey = (name: string, taken: Set<string>) => {
  let key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "p$1").slice(0, 36) || "page";
  if (!/^[a-z]/.test(key)) key = `p-${key}`.slice(0, 36);
  let unique = key; let n = 2;
  while (taken.has(unique)) unique = `${key}-${n++}`;
  taken.add(unique);
  return unique;
};
const pagePath = (root: string, key: string) => {
  if (/^(home|index|homepage|site|global|settings)$/.test(key)) return "/";
  const pages = join(root, "src", "pages");
  for (const ext of [".astro", ".md", ".mdx", ".html"]) if (existsSync(join(pages, `${key}${ext}`)) || existsSync(join(pages, key, `index${ext}`))) return `/${key}/`;
  return undefined;
};
const ID_FIELDS = ["id", "slug", "key"];

const draftOf = (root: string, file: string, taken: Set<string>, notes: string[]): FileDraft | CollectionDraft | undefined => {
  const path = relative(root, file).split(sep).join("/");
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (error) { notes.push(`${path}: not valid JSON (${(error as Error).message}) — left out`); return undefined; }
  const name = basename(file, extname(file));
  if (isRecord(data)) {
    const key = resourceKey(name, taken);
    const spec = specOf([data], notes, `${path} → `);
    if (!spec.length) { notes.push(`${path}: nothing to edit — left out`); return undefined; }
    const draft: FileDraft = { kind: "file", key, label: humanize(name), path, spec, data };
    const preview = pagePath(root, key);
    if (/polic|privacy|terms|legal|cookie/i.test(name)) draft.group = "Policies";
    if (/^(header|footer|nav|navigation|menu-bar|announcement|banner|popup|notice|topbar|top-bar)$/i.test(name)) { draft.area = true; draft.preview = "/"; }
    else if (preview) draft.preview = preview;
    const text = (field: string) => spec.find((entry) => entry.key === field && entry.guess.type === "text");
    if (/^seo$/i.test(name) && text("title") && text("description")) {
      const image = spec.find((entry) => /image/i.test(entry.key) && entry.guess.type === "image");
      draft.seo = { title: "title", description: "description", ...(image ? { image: image.key } : {}) };
      draft.preview ??= "/";
    }
    // Sections: each group of the page (an object or a list) is one section; single values go first, together.
    const groups = spec.filter((entry) => entry.guess.type === "object" || entry.guess.type === "list");
    if (!draft.seo && groups.length >= 2) {
      const single = spec.filter((entry) => !groups.includes(entry));
      draft.sections = [...(single.length ? [{ key: "general", label: "General", fields: single.map((entry) => entry.key) }] : []), ...groups.map((entry) => ({ key: entry.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "part", label: entry.label, fields: [entry.key] }))];
      const seen = new Set<string>();
      for (const section of draft.sections) { let unique = section.key; let n = 2; while (seen.has(unique)) unique = `${section.key}-${n++}`; seen.add(unique); section.key = unique; }
    }
    return draft;
  }
  if (Array.isArray(data) && data.length && data.every(isRecord)) {
    const records = data as Array<Record<string, unknown>>;
    const idField = ID_FIELDS.find((field) => records.every((record) => typeof record[field] === "string" && (record[field] as string).trim()) && new Set(records.map((record) => record[field])).size === records.length);
    if (!idField) { notes.push(`${path}: a list without a unique "id" / "slug" / "key" in every record — left out (add one to make it a collection)`); return undefined; }
    const key = resourceKey(name, taken);
    const spec = specOf(records, notes, `${path} → `, [idField]);
    const label = humanize(name);
    return { kind: "collection", key, label, itemLabel: humanize(singular(name)), path, idField, spec, data: records };
  }
  notes.push(`${path}: not an object or a list of records — left out`);
  return undefined;
};

/** Check every draft against its content; downgrade what does not fit until all of it does (at most 20 rounds). */
const settle = (drafts: Array<FileDraft | CollectionDraft>, phoneCountry: string | undefined, notes: string[]) => {
  for (const draft of drafts) {
    for (let round = 0; round < 20; round += 1) {
      const records = draft.kind === "file" ? [draft.data] : draft.data;
      const system = draft.kind === "collection" ? [draft.idField] : [];
      const errors = records.flatMap((record) => checkRecordValues({ fields: toFields(draft.spec), record, system, ...(phoneCountry ? { phoneCountry } : {}) }).errors);
      if (!errors.length) break;
      let changed = false;
      for (const problem of errors) changed = downgrade(draft.spec, pathKeys(problem.path), notes, `${draft.path} → `) || changed;
      if (!changed) { notes.push(`${draft.path}: ${errors[0].path} ${errors[0].message} — check this file by hand`); break; }
    }
    if (draft.kind === "file" && draft.sections) draft.sections = draft.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => draft.spec.some((entry) => entry.key === field)) })).filter((section) => section.fields.length);
  }
};

// ---------------------------------------------------------------- preview hints: where a template prints a value

type Hint = { file: string; line: number; expression: string; attribute: string };
const TEMPLATE = /\.(astro|jsx|tsx|svelte|vue|html|mdx)$/i;
const walkTemplates = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort().flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : walkTemplates(full);
  return TEMPLATE.test(name) ? [full] : [];
}) : []);

const fieldAt = (spec: Spec, keys: string[]): Guess | undefined => {
  let current: Spec | undefined = spec;
  let guess: Guess | undefined;
  for (const key of keys) {
    if (/^\d+$/.test(key)) { if (guess?.type !== "list") return undefined; guess = guess.of; current = guess.type === "object" ? guess.fields : undefined; continue; }
    guess = current?.find((entry) => entry.key === key)?.guess;
    if (!guess) return undefined;
    current = guess.type === "object" ? guess.fields : undefined;
  }
  return guess;
};

export const previewHints = (root: string, drafts: Array<FileDraft | CollectionDraft>): Hint[] => {
  const files = new Map(drafts.filter((draft): draft is FileDraft => draft.kind === "file").map((draft) => [resolve(root, draft.path), draft]));
  const hints: Hint[] = [];
  for (const template of walkTemplates(join(root, "src"))) {
    const source = readFileSync(template, "utf8");
    const names = new Map<string, FileDraft>();
    for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.json)["']/g)) {
      const spec = match[2];
      const target = spec.startsWith(".") ? resolve(dirname(template), spec) : spec.startsWith("@/") ? resolve(root, "src", spec.slice(2)) : spec.startsWith("~/") ? resolve(root, "src", spec.slice(2)) : resolve(root, spec.replace(/^\//, ""));
      const draft = files.get(target);
      if (draft) names.set(match[1], draft);
    }
    if (!names.size) continue;
    const lines = source.split(/\r?\n/);
    const seen = new Set<string>();
    lines.forEach((text, index) => {
      // An element that is bound already says so on its line.
      if (text.includes("data-cms-field")) return;
      for (const [name, draft] of names) {
        for (const match of text.matchAll(new RegExp(`\\{\\s*${name.replace(/\$/g, "\\$")}((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])+)\\s*\\}`, "g"))) {
          const keys = [...match[1].matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g)].map((part) => part[1] ?? part[2]);
          const guess = fieldAt(draft.spec, keys);
          if (!guess || guess.type === "object" || guess.type === "list" || guess.type === "hours") continue;
          const path = keys.map((key) => (/^\d+$/.test(key) ? `[${key}]` : `.${key}`)).join("").replace(/^\./, "");
          const attribute = `data-cms-field="${draft.key}.${path}"`;
          if (seen.has(`${index}:${attribute}`)) continue;
          seen.add(`${index}:${attribute}`);
          hints.push({ file: relative(root, template).split(sep).join("/"), line: index + 1, expression: match[0], attribute });
        }
      }
    });
  }
  return hints;
};

// ---------------------------------------------------------------- the draft as code

type Facts = ReturnType<typeof readSiteFacts> & { phoneCountry?: string; contentDirs?: string[] };
const configCode = (facts: Facts, files: FileDraft[], collections: CollectionDraft[], notes: string[]) => {
  const out: string[] = [];
  out.push(`// Vibe CMS — what this site's editors can change. A FIRST DRAFT written by \`npx vibe-cms init\` (vibe-cms ${packageVersion()}, ${new Date().toISOString().slice(0, 10)}):`);
  out.push("// every field was guessed from the content's keys and values and checked against the content as it is today. Read it");
  out.push("// through: rename labels, mark what must be filled in (required: true), lock what only admins may change");
  out.push('// (locked: "admin"), and check every TODO. Then: npm run build (it checks the content) and npx vibe-cms check.');
  if (notes.length) { out.push("//"); out.push("// What init left out or changed (and why):"); for (const note of notes) out.push(`//   - ${note}`); }
  out.push('import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";');
  out.push("");
  out.push("export default defineCmsConfig({");
  out.push("  configVersion: 1,");
  out.push(`  site: { name: ${q(facts.siteName)}, url: ${q(facts.url)}${facts.phoneCountry ? `, phone: { country: ${q(facts.phoneCountry)} }` : ""} },${facts.guessed.url ? " // TODO: the website's real address" : ""}`);
  out.push(`  repo: { owner: ${q(facts.owner)}, name: ${q(facts.repoName)}, branch: ${q(facts.branch)} },${facts.guessed.repo ? " // TODO: the GitHub repository the CMS publishes to" : ""}`);
  out.push('  roles: ["admin", "editor"],');
  if (facts.contentDirs?.length) out.push(`  contentDirs: [${facts.contentDirs.map(q).join(", ")}],`);
  out.push("  files: [");
  for (const file of files) {
    const head = [`key: ${q(file.key)}`, `label: ${q(file.label)}`, `path: ${q(file.path)}`, 'format: "json"', ...(file.preview ? [`preview: ${q(file.preview)}`] : []), ...(file.group ? [`group: ${q(file.group)}`] : []), ...(file.area ? ["area: true", 'description: "TODO: what it holds, in a few words"'] : []), ...(file.seo ? ['layout: "seo"', `seo: { ${Object.entries(file.seo).map(([name, field]) => `${name}: ${q(field)}`).join(", ")} }`] : [])];
    out.push(`    {${file.preview ? "" : " // TODO: preview: the address of the page that shows it (e.g. \"/about/\")"}`);
    out.push(`      ${head.join(", ")},`);
    if (file.sections?.length) out.push(`      sections: [${file.sections.map((section) => `{ key: ${q(section.key)}, label: ${q(section.label)}, fields: [${section.fields.map(q).join(", ")}] }`).join(", ")}],`);
    out.push("      fields: {");
    out.push(fieldsCode(file.spec, "        ").replace(/\n$/, ""));
    out.push("      },");
    out.push("    },");
  }
  out.push("  ],");
  out.push("  collections: [");
  for (const collection of collections) {
    out.push("    {");
    out.push(`      key: ${q(collection.key)}, label: ${q(collection.label)}, itemLabel: ${q(collection.itemLabel)},`);
    out.push(`      store: { kind: "json-array", path: ${q(collection.path)}, idField: ${q(collection.idField)} }, // TODO: preview: the address of one record's page (e.g. "/blog/{${collection.idField}}/"), if it has one`);
    out.push("      fields: {");
    out.push(fieldsCode(collection.spec, "        ").replace(/\n$/, ""));
    out.push("      },");
    out.push("    },");
  }
  out.push("  ],");
  out.push("});");
  out.push("");
  return out.join("\n");
};

/** The same draft as a config object, to check it before anything is written. */
const configObject = (facts: Facts, files: FileDraft[], collections: CollectionDraft[]): CmsConfig => ({
  configVersion: 1,
  site: { name: facts.siteName, url: facts.url, ...(facts.phoneCountry ? { phone: { country: facts.phoneCountry } } : {}) },
  repo: { owner: facts.owner, name: facts.repoName, branch: facts.branch },
  roles: ["admin", "editor"],
  ...(facts.contentDirs?.length ? { contentDirs: facts.contentDirs } : {}),
  files: files.map((file) => ({
    key: file.key, label: file.label, path: file.path, format: "json" as const,
    ...(file.preview ? { preview: file.preview } : {}), ...(file.group ? { group: file.group } : {}), ...(file.area ? { area: true, description: "TODO: what it holds, in a few words" } : {}),
    ...(file.seo ? { layout: "seo" as const, seo: file.seo } : {}), ...(file.sections?.length ? { sections: file.sections } : {}),
    fields: toFields(file.spec),
  })),
  collections: collections.map((collection) => ({
    key: collection.key, label: collection.label, itemLabel: collection.itemLabel,
    store: { kind: "json-array" as const, path: collection.path, idField: collection.idField },
    fields: toFields(collection.spec),
  })),
});

// ---------------------------------------------------------------- the command

export const init = (options: InitOptions) => {
  const { root, log } = options;
  const out = resolve(root, options.out ?? "cms.config.ts");
  if (existsSync(out) && !options.force && !options.dryRun) throw new CliError(`${relative(root, out) || out} already exists — init only writes a first draft`, "move it away, or run again with --force to replace it");
  const dirs = (options.data ? options.data.split(",") : [...DEFAULT_CONTENT_DIRS]).map((dir) => dir.trim()).filter(Boolean);
  const jsonFiles = dirs.flatMap((dir) => (existsSync(join(root, dir)) ? walkJson(join(root, dir)) : []));
  if (!jsonFiles.length) throw new CliError(`no JSON content found in ${dirs.join(", ")}`, "the CMS edits JSON files: move the site's content (texts, prices, photos) into src/data/*.json first, or pass --data <folder>");
  const notes: string[] = [];
  const taken = new Set<string>();
  const drafts = jsonFiles.map((file) => draftOf(root, file, taken, notes)).filter((draft): draft is FileDraft | CollectionDraft => draft !== undefined);
  if (!drafts.length) throw new CliError("none of the JSON files can be edited as they are", notes.join("\n  "));
  const phones = drafts.flatMap((draft) => phoneValues(draft.data));
  const phoneCountry = phones.length && phones.every((phone) => US_PHONE.test(phone.trim())) ? "US" : undefined;
  settle(drafts, phoneCountry, notes);
  // Content outside src/data and src/content is allowed by naming its folders (contentDirs).
  const inDefault = (dir: string) => DEFAULT_CONTENT_DIRS.some((base) => dir === base || dir.startsWith(`${base}/`));
  const contentDirs = dirs.map((dir) => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "")).filter((dir) => !inDefault(dir));
  const facts = { ...readSiteFacts(root, options), phoneCountry, ...(contentDirs.length ? { contentDirs } : {}) };
  const files = drafts.filter((draft): draft is FileDraft => draft.kind === "file" && draft.spec.length > 0);
  const collections = drafts.filter((draft): draft is CollectionDraft => draft.kind === "collection" && draft.spec.length > 0);
  // Only a draft the package itself accepts is written.
  const { errors } = checkCmsConfig(configObject(facts, files, collections));
  if (errors.length) throw new CliError(`the draft does not pass the config check (please report this): ${errors.map((problem) => `${problem.path}: ${problem.message}`).join("; ")}`);
  const code = configCode(facts, files, collections, notes);
  const hints = previewHints(root, drafts);
  const count = (spec: Spec): number => spec.reduce((total, entry) => total + (entry.guess.type === "object" ? count(entry.guess.fields) : entry.guess.type === "list" && entry.guess.of.type === "object" ? count(entry.guess.of.fields) : 1), 0);
  if (options.dryRun) log(code);
  else writeFileSync(out, code);
  log(`${options.dryRun ? "Draft (not written)" : `Wrote ${relative(root, out)}`}: ${files.length} ${files.length === 1 ? "page" : "pages"} (files), ${collections.length} ${collections.length === 1 ? "collection" : "collections"}, ${[...files, ...collections].reduce((total, draft) => total + count(draft.spec), 0)} fields — checked against the content as it is.`);
  if (notes.length) log(`Left out or changed (${notes.length}) — listed at the top of the file too:\n${notes.map((note) => `  - ${note}`).join("\n")}`);
  if (hints.length) {
    log(`Preview: ${hints.length} ${hints.length === 1 ? "place prints" : "places print"} a value of the content — add the attribute to that element so the preview can point at the field:`);
    for (const hint of hints.slice(0, 40)) log(`  ${hint.file}:${hint.line}  ${hint.expression}  →  ${hint.attribute}`);
    if (hints.length > 40) log(`  … and ${hints.length - 40} more`);
  }
  log("Next: read the draft (labels, required, locked, every TODO), then npm run build and npx vibe-cms check (README → Install in a site, step 3).");
  return { files: files.length, collections: collections.length, notes, hints, code };
};
