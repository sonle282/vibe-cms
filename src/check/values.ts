/**
 * Check values against their field types — pure, no file access, so it runs in the Worker too (API PUT / publish, P5)
 * and in the build-time content check (content.ts). Missing required values and wrong types are errors; properties the
 * config does not declare are warnings.
 */
import type { Field } from "../config/index.js";
import type { CheckResult, Problem } from "../config/validate.js";
import { toTree, type FieldTree } from "../config/tree.js";
import { isImageName, type ImageNames } from "../media/names.js";

/** P12g: root = the whole record (pick choices are computed from it); picks = those choices, once per field. */
export type ValueCtx = CheckResult & { ids: Map<string, Set<string>>; root?: Record<string, unknown>; picks?: Map<Field, Set<string> | null>; imageNames?: ImageNames };
type Ctx = ValueCtx;
type Tree = FieldTree;

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const add = (list: Problem[], path: string, message: string, hint?: string) => list.push({ path, message, ...(hint ? { hint } : {}) });
export const describe = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return `text ${JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value)}`;
  return `${typeof value === "boolean" ? "true/false" : typeof value} ${JSON.stringify(value)}`;
};
export const at = (base: string, key: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? (base ? `${base}.${key}` : key) : `${base}[${JSON.stringify(key)}]`);
const empty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** P12d: {word} placeholders the site's code fills in. */
export const TOKEN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const patterns = new Map<string, RegExp>();
/** A text field's pattern, matched against the whole value. */
export const patternOf = (pattern: string) => {
  let found = patterns.get(pattern);
  if (!found) { found = new RegExp(`^(?:${pattern})$`, "u"); patterns.set(pattern, found); }
  return found;
};


export const checkRecord = (ctx: Ctx, record: Record<string, unknown>, tree: Tree, path: string, system: string[] = []) => {
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

export const checkValue = (ctx: Ctx, field: Field, value: unknown, path: string): void => {
  if (empty(value)) { if (field.required) add(ctx.errors, path, `required ("${field.label}") but ${value === undefined ? "missing" : "empty"}`, "fill it in, or remove required: true"); return; }
  switch (field.type) {
    case "text":
      if (typeof value !== "string") { add(ctx.errors, path, `expected text, got ${describe(value)}`, typeof value === "number" || typeof value === "boolean" ? `write it in quotes: "${value}"` : "write it as text in quotes"); return; }
      if (field.maxLength && value.length > field.maxLength) add(ctx.errors, path, `is ${value.length} characters, longer than maxLength ${field.maxLength}`, "shorten it or raise maxLength");
      if (!field.multiline && value.includes("\n")) add(ctx.warnings, path, "has a line break but the field is single-line", "remove the line break or set multiline: true");
      // P12d: the whole value must match the pattern; only the site's own {tokens} may appear between braces.
      if (field.pattern && !patternOf(field.pattern).test(value)) add(ctx.errors, path, `${describe(value)} is not ${field.patternHint ?? `in the form ${field.pattern}`}`, field.patternHint ? `write ${field.patternHint}` : "change it to match the pattern");
      if (field.tokens) for (const match of value.matchAll(TOKEN)) if (!field.tokens.includes(match[1])) add(ctx.errors, path, `{${match[1]}} is not filled in by the website`, `use ${field.tokens.map((token) => `{${token}}`).join(", ")}`);
      return;
    case "richText":
      if (typeof value !== "string") add(ctx.errors, path, `expected rich text (a string), got ${describe(value)}`);
      return;
    case "image": {
      // P12h: images by name — a name of the manifest, or an upload's name.
      const named = (name: unknown, at: string) => { if (ctx.imageNames && typeof name === "string" && name && !isImageName(ctx.imageNames, name)) add(ctx.errors, at, `${describe(name)} is not an image of the site's manifest`, "choose an image from the library"); };
      if (typeof value === "string") { named(value, path); return; }
      if (!isRecord(value) || typeof value.src !== "string" || !value.src) { add(ctx.errors, path, `expected an image path or { "src": … }, got ${describe(value)}`, 'e.g. "/images/hero.jpg" or { "src": "/images/hero.jpg", "alt": "…" }'); return; }
      for (const key of Object.keys(value)) if (!["src", "alt", "mobile"].includes(key)) add(ctx.warnings, `${path}.${key}`, "is not part of an image", "images have src, alt, mobile");
      for (const key of ["alt", "mobile"] as const) if (value[key] !== undefined && typeof value[key] !== "string") add(ctx.errors, `${path}.${key}`, `expected text, got ${describe(value[key])}`);
      if (field.alt && !value.alt) add(ctx.warnings, `${path}.alt`, "is empty", "describe the image for people using screen readers");
      named(value.src, `${path}.src`);
      named(value.mobile, `${path}.mobile`);
      return;
    }
    case "select":
      if (typeof value !== "string" || !field.options.includes(value)) add(ctx.errors, path, `${describe(value)} is not one of the options`, `use ${field.options.map((option) => JSON.stringify(option)).join(", ")}`);
      return;
    case "hours":
      checkHours(ctx, value, path);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) { add(ctx.errors, path, `expected a number, got ${describe(value)}`, typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? `write it without quotes: ${Number(value)}` : undefined); return; }
      if (field.integer && !Number.isInteger(value)) add(ctx.errors, path, `${value} is not a whole number`);
      if (field.min !== undefined && value < field.min) add(ctx.errors, path, `${value} is less than ${field.min}`);
      if (field.max !== undefined && value > field.max) add(ctx.errors, path, `${value} is more than ${field.max}`);
      return;
    case "toggle":
      if (typeof value !== "boolean") add(ctx.errors, path, `expected true or false, got ${describe(value)}`);
      return;
    case "pick": {
      if (typeof value !== "string") { add(ctx.errors, path, `expected the value of one of the choices, got ${describe(value)}`); return; }
      // The choices come from the site's function, on the server; where it is not there (the admin), the server checks.
      if (typeof field.choices !== "function") return;
      ctx.picks ??= new Map();
      if (!ctx.picks.has(field)) {
        try { ctx.picks.set(field, new Set((field.choices(ctx.root ?? {}) ?? []).map((choice) => choice.value))); }
        catch (error) { ctx.picks.set(field, null); add(ctx.errors, path, `the site's choices for "${field.label}" failed: ${(error as Error).message}`, "fix the choices function in cms.config"); }
      }
      const allowed = ctx.picks.get(field);
      if (allowed && !allowed.has(value)) add(ctx.errors, path, `${describe(value)} is not one of the choices of "${field.label}"`, allowed.size ? `e.g. ${[...allowed].slice(0, 3).map((known) => JSON.stringify(known)).join(", ")}` : "there are no choices yet");
      return;
    }
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
    case "tuple":
      if (!Array.isArray(value) || value.length !== field.items.length) { add(ctx.errors, path, `expected ${field.items.length} values in a list [${field.items.map((item) => item.label).join(", ")}], got ${describe(value)}${Array.isArray(value) ? ` of ${value.length}` : ""}`); return; }
      field.items.forEach((item, index) => checkValue(ctx, item, value[index], `${path}[${index}]`));
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

/**
 * One record (a file's content or a collection record) against its fields. ids = record ids per collection, for
 * reference checks (a collection missing from the map is not checked); system = properties that are not fields
 * (the id field, status field, Markdown body).
 */
export const checkRecordValues = ({ fields, record, path = "", ids = new Map(), system = [], imageNames }: { fields: Record<string, Field>; record: unknown; path?: string; ids?: Map<string, Set<string>>; system?: string[]; imageNames?: ImageNames }): CheckResult => {
  const ctx: Ctx = { errors: [], warnings: [], ids, ...(isRecord(record) ? { root: record } : {}), ...(imageNames ? { imageNames } : {}) };
  if (!isRecord(record)) add(ctx.errors, path || "(content)", `expected an object ({ … }), got ${describe(record)}`);
  else checkRecord(ctx, record, toTree(fields), path, system);
  return { errors: ctx.errors, warnings: ctx.warnings };
};
