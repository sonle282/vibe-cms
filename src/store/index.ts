/**
 * P3: the CMS store, as three small interfaces so the Worker uses Cloudflare bindings and tests use memory:
 * - ContentSource — the site's content as it was built into the Worker (read-only; "bundled" source).
 * - DraftStore    — drafts in KV, one per (user, resource), with a revision number.
 * - DraftIndex    — the list of drafts in D1 (migrations/0001_draft_index.sql).
 * createDrafts() keeps DraftStore and DraftIndex in step. Nothing here writes to GitHub (P5).
 */
import type { CmsConfig } from "../config/index.js";
import { parseMarkdown } from "../writer/markdown.js";

// ---------------------------------------------------------------- versions

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
/** "sha256:<hex>" of a text — the version of a source file. */
export const textVersion = async (text: string) => `sha256:${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))}`;
/** JSON with keys sorted at every level: equal values give equal text whatever the key order. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
};
/** Version of one record's data (a json-array item changes version only when that item changes). */
export const valueVersion = (value: unknown) => textVersion(canonicalJson(value));

// ---------------------------------------------------------------- resources

export type Resource = { kind: "file"; key: string } | { kind: "item"; key: string; id: string };
export const resourceId = (resource: Resource) => (resource.kind === "file" ? `file:${resource.key}` : `item:${resource.key}:${resource.id}`);
export const parseResourceId = (value: string): Resource => {
  const file = /^file:([a-z][a-z0-9-]*)$/.exec(value);
  if (file) return { kind: "file", key: file[1] };
  const item = /^item:([a-z][a-z0-9-]*):(.+)$/.exec(value);
  if (item) return { kind: "item", key: item[1], id: item[2] };
  throw new RangeError(`not a resource id: ${JSON.stringify(value)}`);
};

// ---------------------------------------------------------------- content source

export interface ContentSource {
  /** The file's text as built, or undefined. Paths are relative to the project root ("src/data/site.json"). */
  read(path: string): Promise<string | undefined>;
  /** Paths under a folder ("src/content/blog"), sorted. */
  list(dir: string): Promise<string[]>;
}

/** Source from the map the integration builds into the Worker (virtual:vibe-cms/content). */
export const createBundledSource = (files: Record<string, string>): ContentSource => ({
  read: async (path) => (Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined),
  list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir.replace(/\/$/, "")}/`)).sort(),
});

export type SourceRecord = { resource: string; path: string; text: string; data: unknown; version: string };

/** Read files and collection records from a ContentSource, with their versions. */
export const createContentReader = (config: CmsConfig, source: ContentSource) => {
  const collection = (key: string) => {
    const found = config.collections.find((entry) => entry.key === key);
    if (!found) throw new RangeError(`no collection "${key}"`);
    return found;
  };
  return {
    async file(key: string): Promise<SourceRecord | undefined> {
      const file = config.files.find((entry) => entry.key === key);
      if (!file) throw new RangeError(`no file "${key}"`);
      const text = await source.read(file.path);
      if (text === undefined) return undefined;
      return { resource: resourceId({ kind: "file", key }), path: file.path, text, data: JSON.parse(text.replace(/^﻿/, "")), version: await textVersion(text) };
    },
    async items(key: string): Promise<SourceRecord[]> {
      const entry = collection(key);
      if (entry.store.kind === "json-array") {
        const { path, idField } = entry.store;
        const text = await source.read(path);
        if (text === undefined) return [];
        const list = JSON.parse(text.replace(/^﻿/, "")) as Array<Record<string, unknown>>;
        return Promise.all(list.map(async (item) => ({ resource: resourceId({ kind: "item", key, id: String(item[idField]) }), path, text, data: item, version: await valueVersion(item) })));
      }
      const { dir, slugField } = entry.store;
      const records: SourceRecord[] = [];
      for (const path of (await source.list(dir)).filter((name) => name.endsWith(".md"))) {
        const text = (await source.read(path)) as string;
        const { data, body } = parseMarkdown(text);
        const id = typeof data[slugField] === "string" ? (data[slugField] as string) : path.slice(dir.length + 1, -3);
        records.push({ resource: resourceId({ kind: "item", key, id }), path, text, data: { ...data, body }, version: await textVersion(text) });
      }
      return records;
    },
    async item(key: string, id: string) {
      return (await this.items(key)).find((record) => record.resource === resourceId({ kind: "item", key, id }));
    },
  };
};

// ---------------------------------------------------------------- drafts (KV)

/** The part of Cloudflare's KVNamespace the store uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

export type Draft = {
  userId: string;
  resource: string;
  label: string;
  content: unknown;
  /** Version of the source this draft started from — publish refuses when the source moved on (409). */
  sourceVersion: string;
  /** 1 on the first save, +1 on every save. */
  revision: number;
  updatedAt: string;
};

export interface DraftStore {
  get(userId: string, resource: string): Promise<Draft | undefined>;
  put(draft: Draft): Promise<void>;
  delete(userId: string, resource: string): Promise<void>;
  /** Every draft key (for checks); resource ids, grouped by user. */
  keys(): Promise<Array<{ userId: string; resource: string }>>;
}

const DRAFT_PREFIX = "draft:";
const draftKey = (userId: string, resource: string) => `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${resource}`;
const splitDraftKey = (key: string) => {
  const rest = key.slice(DRAFT_PREFIX.length);
  const cut = rest.indexOf(":");
  return { userId: decodeURIComponent(rest.slice(0, cut)), resource: rest.slice(cut + 1) };
};

export const createKvDraftStore = (kv: KvLike): DraftStore => ({
  async get(userId, resource) { const text = await kv.get(draftKey(userId, resource)); return text === null ? undefined : (JSON.parse(text) as Draft); },
  async put(draft) { await kv.put(draftKey(draft.userId, draft.resource), JSON.stringify(draft)); },
  async delete(userId, resource) { await kv.delete(draftKey(userId, resource)); },
  async keys() {
    const found: Array<{ userId: string; resource: string }> = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix: DRAFT_PREFIX, ...(cursor ? { cursor } : {}) });
      found.push(...page.keys.map((key) => splitDraftKey(key.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return found;
  },
});

/** In-memory KV for tests and local tools. */
export const createMemoryKv = (): KvLike & { size(): number } => {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
    list: async ({ prefix }) => ({ keys: [...map.keys()].filter((key) => key.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }),
    size: () => map.size,
  };
};

// ---------------------------------------------------------------- draft index (D1)

export type DraftIndexEntry = {
  userId: string;
  resource: string;
  kind: "file" | "item";
  resourceKey: string;
  itemId: string | null;
  label: string;
  sourceVersion: string;
  revision: number;
  updatedAt: string;
};

export interface DraftIndex {
  upsert(entry: DraftIndexEntry): Promise<void>;
  remove(userId: string, resource: string): Promise<void>;
  byUser(userId: string): Promise<DraftIndexEntry[]>;
  byResource(resource: string): Promise<DraftIndexEntry[]>;
  all(): Promise<DraftIndexEntry[]>;
}

/** The part of Cloudflare's D1Database the index uses. */
export interface D1Like {
  prepare(query: string): { bind(...values: unknown[]): D1StatementLike } & D1StatementLike;
}
interface D1StatementLike {
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

type Row = { user_id: string; resource: string; kind: "file" | "item"; resource_key: string; item_id: string | null; label: string; source_version: string; revision: number; updated_at: string };
const fromRow = (row: Row): DraftIndexEntry => ({ userId: row.user_id, resource: row.resource, kind: row.kind, resourceKey: row.resource_key, itemId: row.item_id, label: row.label, sourceVersion: row.source_version, revision: Number(row.revision), updatedAt: row.updated_at });
const COLUMNS = "user_id, resource, kind, resource_key, item_id, label, source_version, revision, updated_at";

export const createD1DraftIndex = (db: D1Like): DraftIndex => ({
  async upsert(entry) {
    await db.prepare(`INSERT INTO cms_draft_index (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, resource) DO UPDATE SET label = excluded.label, source_version = excluded.source_version, revision = excluded.revision, updated_at = excluded.updated_at`)
      .bind(entry.userId, entry.resource, entry.kind, entry.resourceKey, entry.itemId, entry.label, entry.sourceVersion, entry.revision, entry.updatedAt).run();
  },
  async remove(userId, resource) { await db.prepare("DELETE FROM cms_draft_index WHERE user_id = ? AND resource = ?").bind(userId, resource).run(); },
  async byUser(userId) { return (await db.prepare(`SELECT ${COLUMNS} FROM cms_draft_index WHERE user_id = ? ORDER BY updated_at DESC, resource`).bind(userId).all<Row>()).results.map(fromRow); },
  async byResource(resource) { return (await db.prepare(`SELECT ${COLUMNS} FROM cms_draft_index WHERE resource = ? ORDER BY updated_at DESC, user_id`).bind(resource).all<Row>()).results.map(fromRow); },
  async all() { return (await db.prepare(`SELECT ${COLUMNS} FROM cms_draft_index ORDER BY user_id, resource`).all<Row>()).results.map(fromRow); },
});

export const createMemoryDraftIndex = (): DraftIndex => {
  const rows = new Map<string, DraftIndexEntry>();
  const key = (userId: string, resource: string) => JSON.stringify([userId, resource]);
  const newest = (a: DraftIndexEntry, b: DraftIndexEntry) => b.updatedAt.localeCompare(a.updatedAt) || a.resource.localeCompare(b.resource);
  return {
    upsert: async (entry) => { rows.set(key(entry.userId, entry.resource), { ...entry }); },
    remove: async (userId, resource) => { rows.delete(key(userId, resource)); },
    byUser: async (userId) => [...rows.values()].filter((row) => row.userId === userId).sort(newest),
    byResource: async (resource) => [...rows.values()].filter((row) => row.resource === resource).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.userId.localeCompare(b.userId)),
    all: async () => [...rows.values()].sort((a, b) => a.userId.localeCompare(b.userId) || a.resource.localeCompare(b.resource)),
  };
};

// ---------------------------------------------------------------- drafts service

export class DraftConflictError extends Error {
  constructor(public readonly current: number, public readonly expected: number) {
    super(`The draft was saved elsewhere (revision ${current}, expected ${expected}) — reload before saving again.`);
    this.name = "DraftConflictError";
  }
}

export type SaveDraft = { userId: string; resource: string; label?: string; content: unknown; sourceVersion: string; expectedRevision?: number };

/** Drafts in KV + their index in D1, kept in step. `now` is injectable for tests. */
export const createDrafts = ({ store, index, now = () => new Date().toISOString() }: { store: DraftStore; index: DraftIndex; now?: () => string }) => ({
  get: (userId: string, resource: string) => store.get(userId, resource),

  /** Save (create or replace) a user's draft of one resource. expectedRevision guards against a lost update. */
  async save(input: SaveDraft): Promise<Draft> {
    const resource = parseResourceId(input.resource);
    const existing = await store.get(input.userId, input.resource);
    const current = existing?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== current) throw new DraftConflictError(current, input.expectedRevision);
    const draft: Draft = { userId: input.userId, resource: input.resource, label: input.label ?? existing?.label ?? "", content: input.content, sourceVersion: input.sourceVersion, revision: current + 1, updatedAt: now() };
    await store.put(draft);
    await index.upsert({ userId: draft.userId, resource: draft.resource, kind: resource.kind, resourceKey: resource.key, itemId: resource.kind === "item" ? resource.id : null, label: draft.label, sourceVersion: draft.sourceVersion, revision: draft.revision, updatedAt: draft.updatedAt });
    return draft;
  },

  /** Throw a draft away (Discard). */
  async discard(userId: string, resource: string) { await store.delete(userId, resource); await index.remove(userId, resource); },

  /** After a successful publish (P8): the publisher's draft of that resource is removed. Others keep theirs (now stale). */
  async clearAfterPublish(userId: string, resource: string) { await store.delete(userId, resource); await index.remove(userId, resource); },

  mine: (userId: string) => index.byUser(userId),
  forResource: (resource: string) => index.byResource(resource),

  /** KV keys and index rows that do not match (should be empty). */
  async mismatches() {
    const keys = new Set((await store.keys()).map(({ userId, resource }) => JSON.stringify([userId, resource])));
    const rows = new Set((await index.all()).map(({ userId, resource }) => JSON.stringify([userId, resource])));
    return { onlyInKv: [...keys].filter((key) => !rows.has(key)).map((key) => JSON.parse(key) as [string, string]), onlyInIndex: [...rows].filter((key) => !keys.has(key)).map((key) => JSON.parse(key) as [string, string]) };
  },
});
