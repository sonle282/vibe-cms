/**
 * P12b: lists with `fixed: true` — the site's code owns their shape, so nobody (the owner included) adds, removes or
 * moves items; the values inside stay editable. Compared with the content the draft started from (save) and with the
 * branch (publish). Items with an "id" must keep their id at their place; a list inside an item that did not exist
 * before is not compared (there is nothing to keep). Problems name the place and the list, never the values.
 */
import type { Field } from "../config/index.js";
import { isRecord, pathStep, toTree, type FieldTree } from "../config/tree.js";
import type { Problem } from "../config/validate.js";

const record = (value: unknown) => (isRecord(value) ? value : undefined);
const idOf = (item: unknown) => (isRecord(item) && typeof item.id === "string" && item.id ? item.id : undefined);

const compareField = (out: Problem[], field: Field, before: unknown, after: unknown, path: string) => {
  if (before === undefined) return;
  if (field.type === "object") { compareTree(out, toTree(field.fields), record(before), record(after), path); return; }
  if (field.type === "tuple") { field.items.forEach((item, index) => compareField(out, item, Array.isArray(before) ? before[index] : undefined, Array.isArray(after) ? after[index] : undefined, `${path}[${index}]`)); return; }
  if (field.type !== "list") return;
  const old = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const name = field.itemLabel ?? field.of.label;
  if (field.fixed) {
    if (next.length !== old.length) {
      out.push({ path, message: `${field.label} has a fixed set of ${old.length} ${name.toLowerCase()} — it cannot be ${next.length > old.length ? "added to" : "made shorter"}`, hint: "change the values of the items; which items exist is decided in the site's code" });
      return;
    }
    const moved = next.findIndex((item, index) => idOf(item) !== idOf(old[index]));
    if (moved >= 0) { out.push({ path: `${path}[${moved}]`, message: `${field.label} keeps its ${name.toLowerCase()} in a fixed order — they cannot be moved or replaced`, hint: "change the values of the items in place" }); return; }
  }
  next.forEach((item, index) => {
    const id = idOf(item);
    const pair = field.fixed || id === undefined ? old[index] : old.find((entry) => idOf(entry) === id);
    compareField(out, field.of, pair, item, `${path}[${index}]`);
  });
};

const compareTree = (out: Problem[], tree: FieldTree, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, path: string) => {
  if (!before) return;
  for (const [key, node] of tree) {
    if (node instanceof Map) compareTree(out, node, record(before[key]), record(after?.[key]), pathStep(path, key));
    else compareField(out, node, before[key], after?.[key], pathStep(path, key));
  }
};

/** Problems with fixed lists between `before` (undefined = a new record: nothing to keep) and `after`. */
export const checkFixedLists = (fields: Record<string, Field>, before: unknown, after: unknown): Problem[] => {
  const out: Problem[] = [];
  compareTree(out, toTree(fields), record(before), record(after), "");
  return out;
};

