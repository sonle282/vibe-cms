/**
 * P7: values the admin edits — paths, copies, equality, "how many changes", slugs. Pure (no DOM), shared by the form
 * and the shell, unit-tested in Node.
 */
import type { Field } from "../config/index.js";

export type Path = Array<string | number>;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** Equal as JSON values; key order does not matter, a missing key equals undefined. */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!same(a[key], b[key])) return false;
    return true;
  }
  return false;
};

/** The readable path used by the value checker (src/check/values.ts): hero.title, extras[1], footerLinks[0].links[2].href. */
export const pathText = (path: Path) => path.reduce<string>((text, step) => {
  if (typeof step === "number") return `${text}[${step}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(step)) return text ? `${text}.${step}` : step;
  return `${text}[${JSON.stringify(step)}]`;
}, "");

/** A field key ("seo.title") as path steps. */
export const keyPath = (key: string): Path => key.split(".");

/** The steps of a readable path: "footerLinks[0].links[2].href" → ["footerLinks", 0, "links", 2, "href"]. */
export const parsePathText = (text: string): Path => {
  const out: Path = [];
  const pattern = /\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|\.?([^.[\]]+)/g;
  for (const match of text.matchAll(pattern)) out.push(match[1] !== undefined ? Number(match[1]) : match[2] !== undefined ? JSON.parse(`"${match[2]}"`) as string : match[3]);
  return out;
};

export const getAt = (root: unknown, path: Path): unknown => {
  let current = root;
  for (const step of path) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[step];
  }
  return current;
};

/**
 * Set a value inside root (mutates). undefined removes the key (or the list slot). Missing objects on the way are
 * created at the END of their parent, so untouched keys keep their order in the file.
 */
export const setAt = (root: Record<string, unknown>, path: Path, value: unknown) => {
  let current: Record<string | number, unknown> | unknown[] = root;
  path.forEach((step, index) => {
    const last = index === path.length - 1;
    const container = current as Record<string | number, unknown>;
    if (last) {
      if (value === undefined) {
        if (Array.isArray(container) && typeof step === "number") container.splice(step, 1);
        else delete container[step];
      } else container[step] = value;
      return;
    }
    let next = container[step];
    if (next === undefined || next === null || typeof next !== "object") {
      next = typeof path[index + 1] === "number" ? [] : {};
      container[step] = next;
    }
    current = next as Record<string, unknown>;
  });
};

/**
 * How many changes between two values, as a person counts them: one per changed value, one per added / removed list
 * item, one for a re-ordered list.
 */
export const countChanges = (before: unknown, after: unknown): number => {
  if (same(before, after)) return 0;
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = (value: unknown) => JSON.stringify(value);
    if (before.length === after.length && [...before.map(key)].sort().join("\n") === [...after.map(key)].sort().join("\n")) return 1;
    const common = Math.min(before.length, after.length);
    let count = Math.abs(before.length - after.length);
    for (let index = 0; index < common; index += 1) count += countChanges(before[index], after[index]);
    return Math.max(count, 1);
  }
  if (isRecord(before) && isRecord(after)) {
    let count = 0;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) count += countChanges(before[key], after[key]);
    return count;
  }
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  return empty(before) && empty(after) ? 0 : 1;
};

/** "Spa Pedicure — Deluxe!" → "spa-pedicure-deluxe" (a new record's id). */
export const slugify = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);

/** Does this value hold anything in a field locked for editors? (An editor may not remove such an item — DESIGN §C.1 rule 4.) */
export const holdsLockedValue = (field: Field, value: unknown): boolean => {
  if (field.locked) return !blank(value);
  if (field.type === "object" && isRecord(value)) return Object.entries(field.fields).some(([key, child]) => holdsLockedValue(child, getAt(value, keyPath(key))));
  if (field.type === "list" && Array.isArray(value)) return value.some((item) => holdsLockedValue(field.of, item));
  return false;
};

/** A new, empty value for a field (a list item the person just added). */
export const emptyValue = (field: Field): unknown => {
  switch (field.type) {
    case "object": return {};
    case "list": case "hours": return [];
    case "reference": return field.multiple ? [] : "";
    default: return "";
  }
};
