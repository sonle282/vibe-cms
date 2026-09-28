/**
 * The CMS store, as small interfaces so the Worker uses Cloudflare bindings and tests use memory:
 * - ContentSource — the site's content as it was built into the Worker (read-only; "bundled" source). P3.
 * - DraftStore    — drafts in D1, one per (user, resource), with a revision checked atomically. P3b: D1 is the only
 *                   source of truth (KV is eventually consistent — up to ~60 s between locations — so a revision check
 *                   on KV is not safe); KV keeps sessions only.
 * Nothing here writes to GitHub (P5).
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

// ---------------------------------------------------------------- drafts (D1 = source of truth)

/** A CMS user's internal id (P6 issues them, e.g. "usr_7f3a9c"). Never an email or a name. */
export const INTERNAL_USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const assertUserId = (userId: string) => {
  if (!INTERNAL_USER_ID.test(userId)) throw new RangeError(`not an internal user id: use the CMS user's id (letters, digits, "_", "-"), never an email or a name`);
};

/**
 * Largest draft content (UTF-8 bytes of its JSON) kept in one D1 row. D1 allows 2,000,000 bytes per row / string; the
 * rest of the row (ids, label, version) needs far less than the 100,000 bytes kept free. The largest content file seen
 * on the sites so far is ~750 KB (P3 round-trip).
 */
export const MAX_DRAFT_BYTES = 1_900_000;

export type Draft = {
  userId: string;
  resource: string;
  label: string;
  content: unknown;
  /** Version of the source this draft started from — publish refuses when the source moved on (409). */
  sourceVersion: string;
  /** 1 on the first save, +1 on every save; checked atomically when expectedRevision is given. */
  revision: number;
  updatedAt: string;
};
export type DraftSummary = Omit<Draft, "content"> & { kind: "file" | "item"; resourceKey: string; itemId: string | null };
export type SaveDraft = { userId: string; resource: string; label?: string; content: unknown; sourceVersion: string; expectedRevision?: number };

export class DraftConflictError extends Error {
  constructor(public readonly current: number, public readonly expected: number) {
    super(`The draft was saved elsewhere (revision ${current}, expected ${expected}) — reload before saving again.`);
    this.name = "DraftConflictError";
  }
}
export class DraftTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`The draft is ${bytes} bytes; the most one draft can hold is ${MAX_DRAFT_BYTES}.`);
    this.name = "DraftTooLargeError";
  }
}

export interface DraftStore {
  get(userId: string, resource: string): Promise<Draft | undefined>;
  /**
   * Create or replace a user's draft of one resource. With expectedRevision the save only happens when the stored
   * revision is exactly that (0 = no draft yet); otherwise DraftConflictError. Without it, the last save wins.
   */
  save(input: SaveDraft): Promise<Draft>;
  /** Throw a draft away (Discard). True when there was one. */
  discard(userId: string, resource: string): Promise<boolean>;
  /** After a successful publish (P8): the publisher's draft of that resource goes; others keep theirs (now stale). */
  clearAfterPublish(userId: string, resource: string): Promise<void>;
  /** "My drafts", newest first (no content). */
  mine(userId: string): Promise<DraftSummary[]>;
  /** Everyone's drafts of one resource, newest first (no content). */
  forResource(resource: string): Promise<DraftSummary[]>;
}

const prepare = (input: SaveDraft) => {
  assertUserId(input.userId);
  const resource = parseResourceId(input.resource);
  const content = JSON.stringify(input.content ?? null);
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_DRAFT_BYTES) throw new DraftTooLargeError(bytes);
  return { resource, content };
};
const summary = (draft: Draft): DraftSummary => {
  const resource = parseResourceId(draft.resource);
  const { content: _content, ...rest } = draft;
  return { ...rest, kind: resource.kind, resourceKey: resource.key, itemId: resource.kind === "item" ? resource.id : null };
};

/** The part of Cloudflare's D1Database the store uses. */
export interface D1Like {
  prepare(query: string): D1StatementLike & { bind(...values: unknown[]): D1StatementLike };
}
interface D1StatementLike {
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

type Row = { user_id: string; resource: string; kind: "file" | "item"; resource_key: string; item_id: string | null; label: string; source_version: string; revision: number; updated_at: string; content?: string };
const fromRow = (row: Row): DraftSummary => ({ userId: row.user_id, resource: row.resource, kind: row.kind, resourceKey: row.resource_key, itemId: row.item_id, label: row.label, sourceVersion: row.source_version, revision: Number(row.revision), updatedAt: row.updated_at });
const SUMMARY = "user_id, resource, kind, resource_key, item_id, label, source_version, revision, updated_at";

/** Drafts in D1 (table cms_draft_index, migrations 0001 + 0002). Revision checks are single atomic statements. */
export const createD1DraftStore = (db: D1Like, now: () => string = () => new Date().toISOString()): DraftStore => {
  const current = async (userId: string, resource: string) => Number((await db.prepare("SELECT revision FROM cms_draft_index WHERE user_id = ? AND resource = ?").bind(userId, resource).first<{ revision: number }>())?.revision ?? 0);
  return {
    async get(userId, resource) {
      const row = await db.prepare(`SELECT ${SUMMARY}, content FROM cms_draft_index WHERE user_id = ? AND resource = ?`).bind(userId, resource).first<Row>();
      if (!row) return undefined;
      const { kind: _kind, resourceKey: _key, itemId: _id, ...rest } = fromRow(row);
      return { ...rest, content: JSON.parse(row.content ?? "null") as unknown };
    },
    async save(input) {
      const { resource, content } = prepare(input);
      const at = now();
      const label = input.label ?? "";
      const itemId = resource.kind === "item" ? resource.id : null;
      let row: { revision: number; label: string } | null;
      if (input.expectedRevision === undefined) {
        row = await db.prepare(`INSERT INTO cms_draft_index (${SUMMARY}, content) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (user_id, resource) DO UPDATE SET content = excluded.content, source_version = excluded.source_version, updated_at = excluded.updated_at,
            label = CASE WHEN excluded.label = '' THEN cms_draft_index.label ELSE excluded.label END, revision = cms_draft_index.revision + 1
          RETURNING revision, label`).bind(input.userId, input.resource, resource.kind, resource.key, itemId, label, input.sourceVersion, at, content).first();
      } else if (input.expectedRevision === 0) {
        row = await db.prepare(`INSERT INTO cms_draft_index (${SUMMARY}, content) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (user_id, resource) DO NOTHING RETURNING revision, label`).bind(input.userId, input.resource, resource.kind, resource.key, itemId, label, input.sourceVersion, at, content).first();
      } else {
        row = await db.prepare(`UPDATE cms_draft_index SET content = ?, source_version = ?, updated_at = ?, label = CASE WHEN ? = '' THEN label ELSE ? END, revision = revision + 1
          WHERE user_id = ? AND resource = ? AND revision = ? RETURNING revision, label`).bind(content, input.sourceVersion, at, label, label, input.userId, input.resource, input.expectedRevision).first();
      }
      if (!row) throw new DraftConflictError(await current(input.userId, input.resource), input.expectedRevision ?? 0);
      return { userId: input.userId, resource: input.resource, label: row.label, content: JSON.parse(content) as unknown, sourceVersion: input.sourceVersion, revision: Number(row.revision), updatedAt: at };
    },
    async discard(userId, resource) {
      return Boolean(await db.prepare("DELETE FROM cms_draft_index WHERE user_id = ? AND resource = ? RETURNING revision").bind(userId, resource).first());
    },
    async clearAfterPublish(userId, resource) { await db.prepare("DELETE FROM cms_draft_index WHERE user_id = ? AND resource = ?").bind(userId, resource).run(); },
    async mine(userId) { return (await db.prepare(`SELECT ${SUMMARY} FROM cms_draft_index WHERE user_id = ? ORDER BY updated_at DESC, resource`).bind(userId).all<Row>()).results.map(fromRow); },
    async forResource(resource) { return (await db.prepare(`SELECT ${SUMMARY} FROM cms_draft_index WHERE resource = ? ORDER BY updated_at DESC, user_id`).bind(resource).all<Row>()).results.map(fromRow); },
  };
};

/** In-memory drafts for tests / local tools. The compare-and-set runs without an await in between, so it is atomic. */
export const createMemoryDraftStore = (now: () => string = () => new Date().toISOString()): DraftStore => {
  const rows = new Map<string, Draft>();
  const key = (userId: string, resource: string) => JSON.stringify([userId, resource]);
  const newest = (a: Draft, b: Draft) => b.updatedAt.localeCompare(a.updatedAt);
  return {
    get: async (userId, resource) => structuredClone(rows.get(key(userId, resource))),
    save: async (input) => {
      const { content } = prepare(input);
      const existing = rows.get(key(input.userId, input.resource));
      const revision = existing?.revision ?? 0;
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) throw new DraftConflictError(revision, input.expectedRevision);
      const draft: Draft = { userId: input.userId, resource: input.resource, label: input.label || existing?.label || "", content: JSON.parse(content) as unknown, sourceVersion: input.sourceVersion, revision: revision + 1, updatedAt: now() };
      rows.set(key(input.userId, input.resource), draft);
      return structuredClone(draft);
    },
    discard: async (userId, resource) => rows.delete(key(userId, resource)),
    clearAfterPublish: async (userId, resource) => { rows.delete(key(userId, resource)); },
    mine: async (userId) => [...rows.values()].filter((row) => row.userId === userId).sort((a, b) => newest(a, b) || a.resource.localeCompare(b.resource)).map(summary),
    forResource: async (resource) => [...rows.values()].filter((row) => row.resource === resource).sort((a, b) => newest(a, b) || a.userId.localeCompare(b.userId)).map(summary),
  };
};

export { createD1AuditLog, createMemoryAuditLog } from "./audit.js";
