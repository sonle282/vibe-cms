import { sameValue } from "../writer/json.js";
import type { Field } from "../config/index.js";

/**
 * F3: carry a draft over to content that changed on the website after it was started (a three-way merge, field by
 * field). `base` = what the draft started from, `theirs` = what the website has now, `mine` = the draft.
 *
 * Objects merge key by key; a list and a plain value are one field each (a list changed on both sides is a conflict,
 * never two orders spliced). A field only one side changed takes that side; a field both changed the same way is
 * fine; a field both changed differently is a conflict (`conflicts` holds its path, e.g. "hero.title").
 */
export type Rebased = { content: unknown; conflicts: string[] };

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const merge = (base: unknown, theirs: unknown, mine: unknown, path: string, conflicts: string[]): unknown => {
  if (sameValue(mine, base)) return theirs;
  if (sameValue(theirs, base) || sameValue(mine, theirs)) return mine;
  if (isObject(base) && isObject(theirs) && isObject(mine)) {
    const out: Record<string, unknown> = {};
    // Keys in the draft's order, then the ones only the website has.
    for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
      const value = merge(base[key], theirs[key], mine[key], path ? `${path}.${key}` : key, conflicts);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  conflicts.push(path);
  return mine;
};

export const rebase = (base: unknown, theirs: unknown, mine: unknown): Rebased => {
  const conflicts: string[] = [];
  const content = merge(base, theirs, mine, "", conflicts);
  return { content, conflicts };
};

/** F3: a conflict's path in words, from the field labels ("hero.title" → "Hero › Title"); "" = the whole record. */
export const conflictLabel = (fields: Record<string, Field>, path: string): string => {
  if (!path) return "Everything";
  const words: string[] = [];
  let at: Record<string, Field> | undefined = fields;
  for (const part of path.split(".")) {
    const field: Field | undefined = at?.[part];
    words.push(field?.label || part);
    at = field?.type === "object" ? field.fields : undefined;
  }
  return words.join(" › ");
};
