/**
 * P20: where a collection's records are, in one place for the store, the checks, the API and the writer.
 *
 * - "json-array": a JSON file holding a list of records — or, with `pointer` ("projects"), a list inside the file's
 *   object (the other keys stay as they are);
 * - "json-object": a JSON object keyed by id ({ "privacy-policy": { "slug": "privacy-policy", … } }) — each record
 *   holds its id (`idField`) too; `pointer` as above;
 * - "markdown-dir": one .md file per record.
 */
import type { CmsCollection } from "./index.js";

export type CollectionStore = CmsCollection["store"];
export type JsonStore = Exclude<CollectionStore, { kind: "markdown-dir" }>;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The field that holds a record's id. */
export const storeIdField = (store: CollectionStore) => (store.kind === "markdown-dir" ? store.slugField : store.idField);
/** The one file of a JSON store (undefined for markdown-dir). */
export const storePath = (store: CollectionStore) => (store.kind === "markdown-dir" ? undefined : store.path);
export const isJsonStore = (store: CollectionStore): store is JsonStore => store.kind !== "markdown-dir";

/** The part of the file's value that holds the records (the value itself, or the one at `pointer`). */
export const storeHolder = (store: JsonStore, data: unknown): unknown => {
  if (!store.pointer) return data;
  return store.pointer.split(".").reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), data);
};

/**
 * The records of a JSON store's file value, or why it is not one ("expected a list…"). For json-object every record
 * is its value, keyed by its id.
 */
export const storeRecords = (store: JsonStore, data: unknown): Array<{ id: unknown; record: unknown; at: string }> | string => {
  const holder = storeHolder(store, data);
  const where = store.pointer ? `${store.pointer}` : "the file";
  if (store.kind === "json-array") {
    if (!Array.isArray(holder)) return `expected a list of records ([ … ]) at ${where}, got ${holder === undefined ? "nothing" : typeof holder}`;
    return holder.map((record, index) => ({ id: isRecord(record) ? record[store.idField] : undefined, record, at: `${store.pointer ? `${store.pointer}` : ""}[${index}]` }));
  }
  if (!isRecord(holder)) return `expected an object of records keyed by id ({ "id": { … } }) at ${where}`;
  return Object.entries(holder).map(([key, record]) => ({ id: key, record, at: `${store.pointer ? `${store.pointer}.` : ""}${key}` }));
};

/** The file's whole value with one record replaced, added (at the end) or removed (null). */
export const withStoreRecord = (store: JsonStore, data: unknown, id: string, record: Record<string, unknown> | null): unknown => {
  const place = (holder: unknown): unknown => {
    if (store.kind === "json-array") {
      const list = Array.isArray(holder) ? [...holder] : [];
      const index = list.findIndex((entry) => isRecord(entry) && entry[store.idField] === id);
      if (record === null) { if (index >= 0) list.splice(index, 1); } else if (index >= 0) list[index] = record; else list.push(record);
      return list;
    }
    const object = isRecord(holder) ? { ...holder } : {};
    if (record === null) delete object[id]; else object[id] = record;
    return object;
  };
  if (!store.pointer) return place(data);
  const keys = store.pointer.split(".");
  const go = (at: unknown, depth: number): unknown => {
    const object = isRecord(at) ? { ...at } : {};
    object[keys[depth]] = depth === keys.length - 1 ? place(object[keys[depth]]) : go(object[keys[depth]], depth + 1);
    return object;
  };
  return go(data, 0);
};

/** An empty file of a store (a new site's first record). */
export const emptyStoreFile = (store: JsonStore) => (store.pointer ? "{}\n" : store.kind === "json-array" ? "[]\n" : "{}\n");
