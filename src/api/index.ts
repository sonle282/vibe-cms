/**
 * P5: the CMS API, runtime-agnostic (Request → Response), so the Astro route, a test Worker in `wrangler dev --local`
 * and Node tests all run the same code. Identity, stores, GitHub and the clock are injected.
 *
 * Routes (under /api/cms; every route needs an identity):
 *   GET    /content                         files + collections from cms.config (label, count, my drafts)
 *   GET    /files/:key                      live content + version + my draft
 *   PUT    /files/:key                      save my draft   { content, expectedRevision, sourceVersion (new draft), keepMine? (F3) }
 *   DELETE /files/:key                      discard my draft
 *   GET    /collections/:key                records (id, label, version, my draft)
 *   GET    /collections/:key/items/:id      live record + version + my draft
 *   PUT    /collections/:key/items/:id      save my draft of one record (new id = new record)
 *   DELETE /collections/:key/items/:id      discard my draft
 *   POST   /collections/:key/items/:id/visibility   M9: { action: "archive" | "unarchive" } → one commit of its status
 *   GET    /drafts                          my drafts (label, updated, stale = the live content moved on) — P8
 *   GET    /media                           P10: uploads (newest first) + the site's own images (built in)
 *   POST   /media                           P10: upload one prepared image (raw bytes; x-file-name header)
 *   POST   /publish                         { resources: [...] } → exactly one commit (with the uploads it uses)
 *   GET    /live-version                    the version of the content this Worker serves
 *   GET    /activity?kind=&before=&limit=   P12b / M12: the audit log in pages, for owners (kind: all | publish | signin | people | denied | failed)
 *   GET    /history?resource=&limit=&contents=1   P12c / M12 (every role; admin-only resources: admins): the versions of
 *                                          a file / record from the branch's commits (10, up to 25); contents=1 adds each value + live
 *   GET    /history/version?resource=&commit=   one version's content (+ sameAsLive)
 *   POST   /history/restore                 { resource, commit, replace? } → that version becomes my draft
 * P12b: a file / collection with access: "owner" answers 403 owner_only to editors (and is not listed for them); lists
 * with fixed: true and collections with fixed: true keep their shape for everyone (422 fixed_list / fixed_collection).
 * Every GET answers with the header x-cms-live-version (F-16).
 */
import type { CmsCollection, CmsConfig, CmsFile } from "../config/index.js";
import { isAdminOnly } from "../config/roles.js";
import { recordThumbnail } from "./record-image.js";
import { conflictLabel, rebase } from "./rebase.js";
import { checkRecordValues } from "../check/values.js";
import { checkFixedLists } from "../check/structure.js";
import { pickChoices } from "../check/picks.js";
import { ruleContext, runRules } from "../check/rules.js";
import { pluginFiles, runSiteChecks, siteContext } from "../check/site.js";
import { describeCleaned, RICH_TEXT_MAX_CHARS, sanitizeRecord, unsafeOnly, type CleanedField } from "../check/rich-text.js";
import { checkPublishLocks, LockedFieldError, lockedFieldBody, saveDraftChecked, type AuditEntry, type AuditLog, type Role } from "../locks/index.js";
import {
  assertUserId, createContentReader, DraftConflictError, DraftTooLargeError, MAX_DRAFT_BYTES, parseResourceId, resourceId, textVersion, valueVersion,
  type ContentSource, type Draft, type DraftStore,
} from "../store/index.js";
import { parseMarkdown } from "../writer/markdown.js";
import { patchJsonDetailed, recordPath, writeFile, writeMarkdownItem, writeStoreItem } from "../writer/index.js";
import { fileRecord, isJsonStore, storeIdField, storePath, storeRecords, withFileRecord, type JsonStore } from "../config/store.js";
import { sameValue, type WriteResult } from "../writer/json.js";
import { buildState, GitPublishError, type CommitAuthor, type FileContent, type GitPublisher } from "./github.js";
import { cleanDisplayName, MediaError, repoPathOf, uploadPathsIn, type MediaStore } from "../media/index.js";
import { addUsage, imagePlacesOfRecord, type ImageUsage } from "../media/usage.js";
import { addressOfName, mapImageValues, nameOfAddress, uploadNamesIn, uploadTail, type ImageNames } from "../media/names.js";
import type { Identify, Identity, RateLimiter } from "../auth/index.js";

export { createSiteRuntime, loopbackApiUrl, siteEnv, type SiteEnv } from "./runtime.js";
export { adminBoot, bootJson, type AdminBoot } from "../admin/boot.js";
export { buildState, createGitHubPublisher, GitPublishError, rateLimitWait, type CheckRun, type CommitAuthor, type CommitInput, type FileContent, type GitHubOptions, type GitPublisher, type HistoryCommit } from "./github.js";
export { recordThumbnail } from "./record-image.js";
export { conflictLabel, rebase, type Rebased } from "./rebase.js";

// ---------------------------------------------------------------- identity

/** Identity for a request (P6: from the sign-in session). undefined = sign-in is not set up (503); null = not signed in (401). */
export type { Identify, Identity } from "../auth/index.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/**
 * Until P6 adds sign-in: a fixed local identity for development, "usr_dev:owner". It works only when `enabled` (the
 * route passes import.meta.env.DEV — false in every production build) AND the request is for localhost. Otherwise the
 * API answers 503 "auth not configured".
 */
export const devIdentity = ({ enabled, value }: { enabled: boolean; value: unknown }): Identify => (request) => {
  if (!enabled || typeof value !== "string" || !value) return undefined;
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) return undefined;
  const [userId, role] = value.split(":");
  assertUserId(userId);
  return { userId, role: role === "owner" ? "owner" : "editor" };
};

// ---------------------------------------------------------------- responses

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }
}
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): never => { throw new ApiError(status, code, message, extra); };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export type CmsApiDeps = {
  config: CmsConfig;
  source: ContentSource;
  identify: Identify;
  drafts?: DraftStore | undefined;
  audit?: AuditLog | undefined;
  publisher?: GitPublisher | undefined;
  now?: () => string;
  basePath?: string;
  /** Largest request body. Default: the largest draft + 100 KB. */
  maxBodyBytes?: number;
  author?: CommitAuthor;
  /** How many times publish re-reads and retries when the branch moved under it. */
  maxAttempts?: number;
  /** People API (P6, owner only): /users and /users/:id, after identity + Origin checks. */
  people?: (request: Request, user: Identity, id?: string) => Promise<Response>;
  /** P10: uploads in the site's R2 bucket (undefined = no CMS_MEDIA binding: uploading is off). */
  media?: MediaStore | undefined;
  /** P10: the site's own images (public/…), listed at build time for the image library. */
  siteImages?: Array<{ src: string; width?: number; height?: number; bytes: number; name?: string; uploadedAt?: string }>;
  /** P12h: images stored by name in the site's manifest (media.names), with the manifest of this build. */
  imageNames?: ImageNames;
  /** Publish rate limit (20 / minute / user on the first site). */
  publishLimiter?: RateLimiter | undefined;
  /** true in production builds: no publish limiter → publish answers 503. */
  requirePublishLimiter?: boolean;
  /** P12b: names for the Activity screen (id → username / display name). */
  userNames?: () => Promise<Array<{ id: string; username: string; displayName: string }>>;
  /** Test seam: the writer used at publish (default: the P3 writer). */
  write?: (collectionOrFile: { kind: "file"; pointer?: string } | { kind: "json"; store: JsonStore } | { kind: "markdown" }, text: string | undefined, id: string | undefined, content: unknown) => WriteResult;
};

export const DEFAULT_AUTHOR: CommitAuthor = { name: "Vibe CMS", email: "vibe-cms@users.noreply.github.com" };

const defaultWrite: NonNullable<CmsApiDeps["write"]> = (target, text, id, content) => {
  if (target.kind === "file") return target.pointer ? patchJsonDetailed(text ?? "{}\n", withFileRecord(target, JSON.parse((text ?? "{}").replace(/^﻿/, "")), content)) : writeFile(text, content);
  if (target.kind === "json") return writeStoreItem(target.store, text, id!, content as Record<string, unknown>);
  return writeMarkdownItem(text, content as Record<string, unknown>);
};

type Target =
  | { kind: "file"; file: CmsFile; resource: string; label: string }
  | { kind: "item"; collection: CmsCollection; id: string; resource: string; label: string };

/** Version of the whole content set the Worker serves: sha256 over "path + text version" of every content file. */
export const combinedVersion = async (files: Record<string, string>) =>
  textVersion((await Promise.all(Object.keys(files).sort().map(async (path) => `${path}\n${await textVersion(files[path])}`))).join("\n"));

export const createCmsApi = (deps: CmsApiDeps) => {
  const { config, source } = deps;
  const base = (deps.basePath ?? "/api/cms").replace(/\/$/, "");
  const now = deps.now ?? (() => new Date().toISOString());
  const maxBody = deps.maxBodyBytes ?? MAX_DRAFT_BYTES + 100_000;
  const author = deps.author ?? DEFAULT_AUTHOR;
  const maxAttempts = deps.maxAttempts ?? 3;
  const write = deps.write ?? defaultWrite;
  const reader = createContentReader(config, source);

  const idFieldOf = (collection: CmsCollection) => storeIdField(collection.store);
  /** How the writer writes a resource. */
  const writeKindOf = (target: Target) => (target.kind === "file" ? { kind: "file" as const, ...(target.file.pointer ? { pointer: target.file.pointer } : {}) } : isJsonStore(target.collection.store) ? { kind: "json" as const, store: target.collection.store } : { kind: "markdown" as const });
  const systemOf = (collection: CmsCollection) => [idFieldOf(collection), ...(collection.status ? [collection.status.field] : []), ...(collection.store.kind === "markdown-dir" ? ["body"] : [])];
  const fileOf = (key: string) => config.files.find((entry) => entry.key === key) ?? fail(404, "not_found", `No file "${key}" in cms.config.`);
  const collectionOf = (key: string) => config.collections.find((entry) => entry.key === key) ?? fail(404, "not_found", `No collection "${key}" in cms.config.`);
  const recordImage = (collection: CmsCollection, record: unknown) => recordThumbnail(collection.fields, record);
  const recordLabel = (collection: CmsCollection, record: unknown, id: string) => {
    const data = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
    const textKey = Object.keys(collection.fields).find((key) => collection.fields[key].type === "text" && key !== idFieldOf(collection) && typeof data[key] === "string" && data[key]);
    return textKey ? String(data[textKey]) : id;
  };
  const targetOf = (resource: string): Target => {
    const parsed = parseResourceId(resource);
    if (parsed.kind === "file") { const file = fileOf(parsed.key); return { kind: "file", file, resource, label: file.label }; }
    const collection = collectionOf(parsed.key);
    return { kind: "item", collection, id: parsed.id, resource, label: collection.itemLabel };
  };
  const pathOf = (target: Target) => (target.kind === "file" ? target.file.path : recordPath(target.collection, target.id));

  // P12b: owner-only files / collections. A refused save or publish writes one audit "denied" row (reads do not).
  const mayOpen = (user: Identity, entry: CmsFile | CmsCollection) => !isAdminOnly(entry.access) || user.role === "owner";
  const entryOf = (target: Target) => (target.kind === "file" ? target.file : target.collection);
  const requireAccess = async (user: Identity, target: Target, stage?: "draft" | "publish") => {
    const entry = entryOf(target);
    if (mayOpen(user, entry)) return;
    if (stage && deps.audit) await deps.audit.record({ at: now(), userId: user.userId, role: user.role, action: "denied", stage, resource: target.resource, detail: { reason: "owner_only" } });
    fail(403, "owner_only", `Only an admin can open or change ${entry.label}.`);
  };
  /** P12b: fixed lists keep their items; a fixed collection gets no new record. before undefined = a new record. */
  const structureProblems = (target: Target, before: unknown, content: unknown) => {
    if (target.kind === "item" && target.collection.fixed && before === undefined) return [{ path: "", message: `${target.collection.label} has a fixed set of records — a new ${target.collection.itemLabel.toLowerCase()} cannot be added`, hint: "edit one of the existing records; which records exist is decided in the site's code" }];
    return checkFixedLists(entryOf(target).fields, before, content);
  };

  // Live content (what this Worker was built with).
  let liveFiles: Promise<Record<string, string>> | undefined;
  const loadLive = () => (liveFiles ??= (async () => {
    const out: Record<string, string> = {};
    const paths = [...new Set([...config.files.map((file) => file.path), ...config.collections.map((c) => storePath(c.store)).filter((path): path is string => Boolean(path))])];
    for (const collection of config.collections) if (collection.store.kind === "markdown-dir") paths.push(...(await source.list(collection.store.dir)).filter((path) => path.endsWith(".md")));
    for (const path of paths) { const text = await source.read(path); if (text !== undefined) out[path] = text; }
    return out;
  })());
  let liveVersion: Promise<string> | undefined;
  const getLiveVersion = () => (liveVersion ??= loadLive().then(combinedVersion));

  /** Live value + version of a resource ("new" when the record does not exist yet). */
  const live = async (target: Target): Promise<{ value: unknown; version: string }> => {
    if (target.kind === "file") {
      const record = await reader.file(target.file.key);
      return record ? { value: record.data, version: record.version } : { value: undefined, version: "missing" };
    }
    const record = await reader.item(target.collection.key, target.id);
    return record ? { value: record.data, version: record.version } : { value: undefined, version: "new" };
  };

  /** Branch value + version of a resource, from the file texts read at the branch head. */
  const onBranch = async (target: Target, text: string | undefined): Promise<{ value: unknown; version: string }> => {
    if (target.kind === "file") {
      if (text === undefined) return { value: undefined, version: "missing" };
      if (!target.file.pointer) return { value: JSON.parse(text.replace(/^﻿/, "")), version: await textVersion(text) };
      const value = fileRecord(target.file, JSON.parse(text.replace(/^﻿/, "")));
      return value === undefined ? { value: undefined, version: "missing" } : { value, version: await valueVersion(value) };
    }
    const store = target.collection.store;
    if (isJsonStore(store)) {
      const found = text === undefined ? [] : storeRecords(store, JSON.parse(text.replace(/^﻿/, "")));
      const item = typeof found === "string" ? undefined : found.find((entry) => entry.id === target.id)?.record;
      return item ? { value: item, version: await valueVersion(item) } : { value: undefined, version: "new" };
    }
    if (text === undefined) return { value: undefined, version: "new" };
    const { data, body } = parseMarkdown(text);
    return { value: { ...data, body }, version: await textVersion(text) };
  };

  const idsForReferences = async () => {
    const ids = new Map<string, Set<string>>();
    for (const collection of config.collections) ids.set(collection.key, new Set((await reader.items(collection.key)).map((record) => parseResourceId(record.resource)).map((resource) => (resource.kind === "item" ? resource.id : ""))));
    return ids;
  };
  // P12d: the site's rules read the content this Worker serves (loaded once, only when a rule exists).
  let siteMaps: Promise<{ files: Map<string, unknown>; items: Map<string, Array<Record<string, unknown>>> }> | undefined;
  const loadSiteMaps = () => (siteMaps ??= (async () => {
    const files = new Map<string, unknown>();
    for (const file of config.files) { const record = await reader.file(file.key); if (record) files.set(file.key, record.data); }
    const items = new Map<string, Array<Record<string, unknown>>>();
    for (const collection of config.collections) items.set(collection.key, (await reader.items(collection.key)).map((record) => record.data as Record<string, unknown>));
    return { files, items };
  })());
  let rulesContent: Promise<ReturnType<typeof ruleContext>> | undefined;
  const loadRulesContent = () => (rulesContent ??= loadSiteMaps().then(({ files, items }) => ruleContext(files, items)));
  /**
   * P19: the site plugins, on the site as it will be — the content this Worker serves with `changes` put in (a file's
   * new value, or a record replaced / added by its id) — and the repo files they asked for, read from the branch.
   */
  const siteCheck = async (changes: Array<{ target: Target; content: unknown }>, sha: string) => {
    if (!config.plugins?.length) return { errors: [], warnings: [] };
    const base = await loadSiteMaps();
    const files = new Map(base.files);
    const items = new Map([...base.items].map(([key, records]) => [key, [...records]]));
    for (const { target, content } of changes) {
      if (target.kind === "file") { files.set(target.file.key, content); continue; }
      const key = idFieldOf(target.collection);
      const records = items.get(target.collection.key) ?? [];
      const record = { ...(content as Record<string, unknown>), [key]: target.id };
      const at = records.findIndex((entry) => entry[key] === target.id);
      if (at >= 0) records[at] = record; else records.push(record);
      items.set(target.collection.key, records);
    }
    const paths = pluginFiles(config);
    const texts = paths.length ? await need(deps.publisher, "publisher").readFiles(sha, paths) : {};
    return runSiteChecks(config, siteContext(config, files, items, texts, changes.map(({ target }) => target.resource)));
  };
  const siteRefusal = (errors: Array<{ path: string; message: string }>) => `The site's checks refused this: ${errors.map((entry) => entry.message).join(" ")}`;
  const withRules = async (target: Target, content: unknown, result: { errors: Array<{ path: string; message: string; hint?: string }>; warnings: Array<{ path: string; message: string; hint?: string }> }) => {
    const rules = target.kind === "file" ? target.file.rules : target.collection.rules;
    if (!rules) return result;
    const ruled = runRules(rules, content, await loadRulesContent());
    return { errors: [...result.errors, ...ruled.errors], warnings: [...result.warnings, ...ruled.warnings] };
  };
  const checkValues = async (target: Target, content: unknown, extraIds: Map<string, Set<string>> = new Map()) => {
    const ids = await idsForReferences();
    for (const [key, set] of extraIds) for (const id of set) ids.get(key)?.add(id);
    const imageNames = deps.imageNames;
    const phoneCountry = deps.config.site.phone?.country;
    if (target.kind === "file") return withRules(target, content, checkRecordValues({ fields: target.file.fields, record: content, ids, imageNames, phoneCountry }));
    const result = checkRecordValues({ fields: target.collection.fields, record: content, ids, system: systemOf(target.collection), imageNames, phoneCountry });
    const idField = idFieldOf(target.collection);
    const record = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
    if (record[idField] !== target.id) result.errors.push({ path: idField, message: `must be "${target.id}" (the record's id)`, hint: "the id cannot be changed in a draft" });
    return withRules(target, content, result);
  };

  // P12h: the editor works with addresses; drafts, publish and the files hold names. Out: name → address (an upload
  // not built yet is found in the bucket); in: address → name (anything else is kept, and the value check refuses it).
  const fieldsOfTarget = (target: Target) => (target.kind === "file" ? target.file.fields : target.collection.fields);
  const toNames = (target: Target, content: unknown) => {
    const names = deps.imageNames;
    return names ? mapImageValues(fieldsOfTarget(target), content, (value) => nameOfAddress(names, value) ?? value) : content;
  };
  const toAddresses = async (target: Target, content: unknown) => {
    const names = deps.imageNames;
    if (!names || content === undefined || content === null) return content;
    const staged = new Map<string, string>();
    for (const name of uploadNamesIn(names, JSON.stringify(content))) {
      const tail = uploadTail(names, name);
      if (!tail || name in names.manifest || !deps.media || !names.uploads) continue;
      const path = await deps.media.find(`${names.uploads.base}/${tail}`);
      if (path) staged.set(tail, path);
    }
    return mapImageValues(fieldsOfTarget(target), content, (value) => addressOfName(names, value, (tail) => staged.get(tail)) ?? value);
  };

  /** P8c: clean the rich text a user changed (vs `before`); refuse values over the size limit. */
  const clean = (target: Target, content: unknown, before: unknown) => {
    const fields = target.kind === "file" ? target.file.fields : target.collection.fields;
    const result = sanitizeRecord({ fields, record: content, before, markdownBody: target.kind === "item" && target.collection.store.kind === "markdown-dir" });
    if (result.tooLong.length) fail(422, "invalid_content", "The content does not match cms.config.", { errors: result.tooLong.map((path) => ({ path, message: `is longer than ${RICH_TEXT_MAX_CHARS} characters`, hint: "split it into smaller parts" })) });
    return result as { record: unknown; cleaned: CleanedField[] };
  };

  const need = <T>(value: T | undefined, what: string): T => value ?? fail(503, `${what}_not_configured`, `The CMS ${what} is not configured on this site.`);

  const readBody = async (request: Request): Promise<Record<string, unknown>> => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > maxBody) fail(413, "payload_too_large", `The request is larger than ${maxBody} bytes.`);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > maxBody) fail(413, "payload_too_large", `The request is larger than ${maxBody} bytes.`);
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes) || "null"); } catch { fail(400, "bad_json", "The request body is not valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "bad_request", "The request body must be a JSON object.");
    return body as Record<string, unknown>;
  };

  /** F3: `conflicts` = the fields both the website and the draft changed (labels), when the draft is stale. */
  const draftView = (draft: Draft | undefined, version: string, conflicts?: string[]) =>
    draft ? { content: draft.content, revision: draft.revision, sourceVersion: draft.sourceVersion, updatedAt: draft.updatedAt, label: draft.label, stale: draft.sourceVersion !== version, ...(conflicts && draft.sourceVersion !== version ? { conflicts } : {}) } : null;

  /**
   * F3: a draft started from content the website no longer has is carried over field by field: what only the website
   * changed comes in, what only the draft changed stays. Clean → saved again from the current version (no longer stale);
   * else it stays stale with the fields both sides changed (in words; [] = it cannot be carried over, e.g. a draft
   * saved before its starting content was kept, or a record removed from the website).
   */
  const carryOver = async (user: Identity, target: Target, draft: Draft, current: { value: unknown; version: string }): Promise<{ draft: Draft; conflicts?: string[] }> => {
    if (draft.sourceVersion === current.version) return { draft };
    if (draft.sourceContent === undefined || current.value === undefined) return { draft, conflicts: [] };
    const merged = rebase(draft.sourceContent, current.value, draft.content);
    if (merged.conflicts.length) return { draft, conflicts: merged.conflicts.map((path) => conflictLabel(fieldsOfTarget(target), path)) };
    try {
      const saved = await saveDraftChecked({
        config, role: user.role, drafts: need(deps.drafts, "storage"), audit: need(deps.audit, "storage"), source: current.value, now,
        input: { userId: user.userId, resource: target.resource, label: draft.label, content: merged.content, sourceVersion: current.version, sourceContent: current.value, expectedRevision: draft.revision },
      });
      return { draft: saved };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return { draft, conflicts: [] }; // saved meanwhile in another tab, a lock, or too large: it stays stale
    }
  };

  // ---------------------------------------------------------------- handlers

  const listContent = async (user: Identity) => {
    const drafts = need(deps.drafts, "storage");
    const mine = await drafts.mine(user.userId);
    const files = config.files.filter((file) => mayOpen(user, file)).map((file) => ({ kind: "file", key: file.key, label: file.label, resource: resourceId({ kind: "file", key: file.key }), hasDraft: mine.some((row) => row.resource === resourceId({ kind: "file", key: file.key })) }));
    const collections = await Promise.all(config.collections.filter((collection) => mayOpen(user, collection)).map(async (collection) => ({
      kind: "collection", key: collection.key, label: collection.label, itemLabel: collection.itemLabel,
      count: (await reader.items(collection.key)).length, drafts: mine.filter((row) => row.kind === "item" && row.resourceKey === collection.key).length,
    })));
    // M7: an area turned off on the website (its `toggle` is false in the live content) is "Off" on Pages.
    for (const entry of files as Array<Record<string, unknown>>) {
      const file = config.files.find((candidate) => candidate.key === entry.key);
      if (!file?.toggle) continue;
      const live = (await reader.file(file.key))?.data;
      let at: unknown = live;
      for (const part of file.toggle.split(".")) at = at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined;
      if (at !== true) entry.off = true;
    }
    return json({ files, collections });
  };

  /**
   * M8: the fields a collection's list shows or reads (columns, filters, search, the detail line, the preview address,
   * the status), each record's values for them, and its status on the website: live / draft / archived.
   */
  const listFieldsOf = (collection: CmsCollection) => {
    const list = collection.list ?? {};
    const names = new Set<string>([
      ...(list.columns ?? []).map((column) => column.field), ...(list.filters ?? []).map((filter) => filter.field), ...(list.search ?? []),
      ...[...(list.detail ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]), ...[...(collection.preview ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
      ...(collection.status ? [collection.status.field] : []),
    ]);
    names.delete(idFieldOf(collection));
    return [...names];
  };
  const valueAtPath = (data: unknown, path: string) => {
    if (!data || typeof data !== "object") return undefined;
    const record = data as Record<string, unknown>;
    if (path in record) return record[path];
    let at: unknown = record;
    for (const part of path.split(".")) at = at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined;
    return at;
  };
  const listStatus = (collection: CmsCollection, data: unknown): "live" | "draft" | "archived" => {
    if (!collection.status) return "live";
    const value = valueAtPath(data, collection.status.field);
    return value === collection.status.draft ? "draft" : collection.status.archived !== undefined && value === collection.status.archived ? "archived" : "live";
  };

  const listItems = async (user: Identity, key: string) => {
    const collection = collectionOf(key);
    if (!mayOpen(user, collection)) fail(403, "owner_only", `Only an admin can open or change ${collection.label}.`);
    const drafts = need(deps.drafts, "storage");
    const mine = (await drafts.mine(user.userId)).filter((row) => row.kind === "item" && row.resourceKey === key);
    const records = await reader.items(key);
    const items = records.map((record) => {
      const parsed = parseResourceId(record.resource);
      const id = parsed.kind === "item" ? parsed.id : "";
      const image = recordImage(collection, record.data);
      const draft = mine.find((row) => row.resource === record.resource);
      const values = Object.fromEntries(listFieldsOf(collection).map((name) => [name, valueAtPath(record.data, name) ?? null]));
      return {
        id, resource: record.resource, label: recordLabel(collection, record.data, id), version: record.version, hasDraft: Boolean(draft), ...(image ? { image } : {}),
        // M8: what the list shows: the website status, the values of its columns / filters, when my draft was saved.
        status: listStatus(collection, record.data), values, ...(draft ? { draftSavedAt: draft.updatedAt } : {}),
      };
    });
    const known = new Set(items.map((item) => item.resource));
    const newDrafts = mine.filter((row) => !known.has(row.resource)).map((row) => ({ id: row.itemId, resource: row.resource, label: row.label, version: null, hasDraft: true, isNew: true }));
    return json({ key, label: collection.label, itemLabel: collection.itemLabel, items: [...items, ...newDrafts] });
  };

  const getResource = async (user: Identity, target: Target) => {
    await requireAccess(user, target);
    const drafts = need(deps.drafts, "storage");
    const current = await live(target);
    const stored = await drafts.get(user.userId, target.resource);
    if (current.value === undefined && !stored) fail(404, "not_found", `${target.resource} does not exist.`);
    const carried = stored ? await carryOver(user, target, stored, current) : undefined;
    const draft = carried?.draft;
    // P12g: the choices of its pick fields, from what is being edited (the draft, else the live content).
    const choices = pickChoices(target.kind === "file" ? target.file.fields : target.collection.fields, draft?.content ?? current.value);
    const view = draftView(draft, current.version, carried?.conflicts);
    if (view) view.content = await toAddresses(target, view.content);
    return json({ resource: target.resource, label: target.kind === "file" ? target.label : recordLabel(target.collection, current.value ?? draft?.content, target.id), content: (await toAddresses(target, current.value)) ?? null, version: current.version, draft: view, ...(Object.keys(choices).length ? { choices } : {}) });
  };

  const putDraft = async (request: Request, user: Identity, target: Target) => {
    const drafts = need(deps.drafts, "storage");
    const audit = need(deps.audit, "storage");
    await requireAccess(user, target, "draft");
    const body = await readBody(request);
    const expectedRevision = body.expectedRevision;
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) fail(400, "expected_revision_required", "expectedRevision is required: 0 for a new draft, else the revision you loaded.");
    if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) fail(400, "bad_request", "content must be an object.");
    body.content = toNames(target, body.content);
    const current = await live(target);
    const existing = await drafts.get(user.userId, target.resource);
    // F3 "Keep my version": a draft in conflict with the website starts again from the live version — what only the
    // website changed comes in, the fields both changed keep the draft's value.
    const keepMine = body.keepMine === true;
    if (keepMine) {
      if (!existing || existing.sourceContent === undefined || current.value === undefined) fail(409, "cannot_keep_mine", "This draft cannot be carried over to the website's version: discard it and make your change again.");
      if (existing!.sourceVersion !== current.version) body.content = rebase(existing!.sourceContent, current.value, body.content).content;
    }
    const checked = await checkValues(target, body.content);
    if (checked.errors.length) fail(422, "invalid_content", "The content does not match cms.config.", { errors: checked.errors });
    const fixed = structureProblems(target, current.value, body.content);
    if (fixed.length) fail(422, target.kind === "item" && target.collection.fixed && current.value === undefined ? "fixed_collection" : "fixed_list", fixed[0].message, { errors: fixed });
    // The version the user OPENED, not the live one at save time: a publish by someone else in between must still be
    // caught at publish (409). A new draft must say it; an existing draft keeps the version it started from.
    let sourceVersion: string;
    let sourceContent: unknown;
    if (keepMine) ({ version: sourceVersion, value: sourceContent } = current);
    else if (existing) ({ sourceVersion, sourceContent } = existing);
    else {
      if (typeof body.sourceVersion !== "string" || !body.sourceVersion) fail(400, "source_version_required", "sourceVersion is required for a new draft: send the version of the content you opened (the GET's \"version\").");
      if (!/^(sha256:[0-9a-f]{64}|new|missing)$/.test(body.sourceVersion as string)) fail(400, "bad_request", "sourceVersion is not a content version.");
      sourceVersion = body.sourceVersion as string;
      // F3: the content it started from, when that is what this Worker serves (else it is not known here).
      if (sourceVersion === current.version && current.value !== undefined) sourceContent = current.value;
    }
    const label = target.kind === "file" ? target.label : recordLabel(target.collection, body.content, target.id);
    const cleaned = clean(target, body.content, current.value);
    try {
      const draft = await saveDraftChecked({ config, role: user.role, drafts, audit, source: current.value, now, input: { userId: user.userId, resource: target.resource, label, content: cleaned.record, sourceVersion, ...(sourceContent === undefined ? {} : { sourceContent }), expectedRevision: expectedRevision as number } });
      return json({ resource: target.resource, draft: draftView(draft, current.version), warnings: [...checked.warnings, ...unsafeOnly(cleaned.cleaned).map((entry) => ({ path: entry.path, message: `HTML removed for safety: ${entry.removed.join(", ")}` }))], cleaned: cleaned.cleaned });
    } catch (error) {
      if (error instanceof DraftConflictError) fail(409, "draft_conflict", error.message, { currentRevision: error.current });
      if (error instanceof DraftTooLargeError) fail(413, "draft_too_large", error.message);
      throw error;
    }
  };

  /** P8: every draft of mine, newest first; stale = the content it started from is no longer what this Worker serves. */
  const listDrafts = async (user: Identity) => {
    const drafts = need(deps.drafts, "storage");
    const rows = await drafts.mine(user.userId);
    const out = [];
    for (const row of rows) {
      let target: Target;
      try { target = targetOf(row.resource); } catch { continue; } // a file / collection removed from cms.config
      if (!mayOpen(user, entryOf(target))) continue; // owner-only, and this user is an editor now
      const current = await live(target);
      // F3: a draft the website moved past is carried over here too, so the list only flags the real conflicts.
      let summary: { sourceVersion: string; revision: number; updatedAt: string } = row;
      let conflicts: string[] | undefined;
      if (row.sourceVersion !== current.version) {
        const stored = await drafts.get(user.userId, row.resource);
        if (stored) ({ draft: summary, conflicts } = await carryOver(user, target, stored, current));
      }
      out.push({
        resource: row.resource, kind: row.kind, key: row.resourceKey, id: row.itemId, label: row.label || target.label,
        group: target.kind === "file" ? target.label : target.collection.label, updatedAt: summary.updatedAt, revision: summary.revision,
        isNew: current.version === "new", stale: summary.sourceVersion !== current.version, ...(conflicts && summary.sourceVersion !== current.version ? { conflicts } : {}),
      });
    }
    return json({ drafts: out });
  };

  const deleteDraft = async (user: Identity, target: Target) => {
    await requireAccess(user, target);
    return json({ resource: target.resource, deleted: await need(deps.drafts, "storage").discard(user.userId, target.resource) });
  };

  const publish = async (request: Request, user: Identity) => {
    const drafts = need(deps.drafts, "storage");
    const audit = need(deps.audit, "storage");
    const publisher = need(deps.publisher, "publisher");
    if (deps.publishLimiter) {
      let allowed: boolean;
      try { allowed = (await deps.publishLimiter.limit({ key: `cms-publish:${user.userId}` })).success; } catch { return fail(503, "limiter_unavailable", "Publish rate limiting is unavailable."); }
      if (!allowed) fail(429, "too_many_publishes", "Publish limit reached. Please try again in a minute.", { retryAfter: 60 });
    } else if (deps.requirePublishLimiter) fail(503, "publish_limiter_missing", "Publish rate limiting is not configured.");
    const body = await readBody(request);
    const resources = body.resources;
    if (!Array.isArray(resources) || !resources.length || resources.length > 50 || !resources.every((entry) => typeof entry === "string") || new Set(resources).size !== resources.length) {
      fail(400, "bad_request", "resources must be a list of 1–50 different resource ids.");
    }
    const targets = (resources as string[]).map((resource) => { try { return targetOf(resource); } catch (error) { if (error instanceof ApiError) throw error; return fail(400, "bad_request", `Not a resource id: ${resource}`); } });
    const loaded: Array<{ target: Target; draft: Draft }> = [];
    for (const target of targets) {
      const draft = await drafts.get(user.userId, target.resource);
      if (!draft) fail(404, "no_draft", `You have no draft of ${target.resource}.`, { resource: target.resource });
      loaded.push({ target, draft: draft! });
    }
    for (const { target } of loaded) await requireAccess(user, target, "publish");
    const publishId = crypto.randomUUID();
    const record = (action: "started" | "succeeded" | "failed", detail: Record<string, unknown>) =>
      Promise.all(loaded.map(({ target }) => audit.record({ at: now(), userId: user.userId, role: user.role, action, stage: "publish", resource: target.resource, detail: { publishId, ...detail } })));
    try { await record("started", { resources: loaded.length }); } catch { fail(503, "audit_unavailable", "The audit log cannot be written, so nothing was published."); }

    const failWith = async (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => { await record("failed", { code }); return fail(status, code, message, extra); };
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const head = await publisher.head();
        const paths = [...new Set(loaded.map(({ target }) => pathOf(target)))];
        const texts = await publisher.readFiles(head.sha, paths);

        // 1. The source each draft started from must still be what the branch has.
        //    F3: if it moved on, the draft is carried over field by field; only fields both sides changed stop the publish.
        const changed: string[] = [];
        const conflicts: Record<string, string[]> = {};
        const befores = new Map<string, unknown>();
        for (const entry of loaded) {
          const { target, draft } = entry;
          const branch = await onBranch(target, texts[pathOf(target)]);
          befores.set(target.resource, branch.value);
          if (branch.version === draft.sourceVersion) continue;
          const merged = draft.sourceContent !== undefined && branch.value !== undefined ? rebase(draft.sourceContent, branch.value, draft.content) : undefined;
          if (merged && !merged.conflicts.length) { entry.draft = { ...draft, content: merged.content }; continue; }
          changed.push(target.resource);
          conflicts[target.resource] = (merged?.conflicts ?? []).map((path) => conflictLabel(fieldsOfTarget(target), path));
        }
        if (changed.length) return await failWith(409, "source_changed", "The content changed since you started editing — reload, check, and publish again.", { resources: changed, conflicts });

        // P8c: rich text a user changed is cleaned again here (drafts saved before the cleaning existed, or by any client).
        const sanitized: Array<{ resource: string; fields: CleanedField[] }> = [];
        for (const entry of loaded) {
          const result = clean(entry.target, entry.draft.content, befores.get(entry.target.resource));
          if (result.cleaned.length) entry.draft = { ...entry.draft, content: result.record };
          if (unsafeOnly(result.cleaned).length) sanitized.push({ resource: entry.target.resource, fields: unsafeOnly(result.cleaned) });
        }

        // 2. Locks, with the role the user has now.
        const denied: LockedFieldError[] = [];
        for (const { target, draft } of loaded) {
          try { await checkPublishLocks({ config, role: user.role, userId: user.userId, audit, resource: target.resource, before: befores.get(target.resource), after: draft.content, now }); } catch (error) { if (error instanceof LockedFieldError) denied.push(error); else throw error; }
        }
        if (denied.length) return fail(403, "locked_field", denied.map((error) => error.message).join("; "), { fields: denied.flatMap((error) => lockedFieldBody(error).fields) });

        // 3. Types (P2), with the ids of records published together.
        const newIds = new Map<string, Set<string>>();
        for (const { target } of loaded) if (target.kind === "item") (newIds.get(target.collection.key) ?? newIds.set(target.collection.key, new Set()).get(target.collection.key)!).add(target.id);
        for (const { target, draft } of loaded) {
          const checked = await checkValues(target, draft.content, newIds);
          if (checked.errors.length) return await failWith(422, "invalid_content", `${target.resource} does not match cms.config.`, { resource: target.resource, errors: checked.errors });
          const fixed = structureProblems(target, befores.get(target.resource), draft.content);
          if (fixed.length) return await failWith(422, target.kind === "item" && target.collection.fixed && befores.get(target.resource) === undefined ? "fixed_collection" : "fixed_list", fixed[0].message, { resource: target.resource, errors: fixed });
        }

        // 3b. P19: the site plugins, on the whole site as it will be.
        const site = await siteCheck(loaded.map(({ target, draft }) => ({ target, content: draft.content })), head.sha);
        if (site.errors.length) return await failWith(422, "site_check_failed", siteRefusal(site.errors), { errors: site.errors });

        // 4. Write with the format-keeping writer (several records of one file are applied in turn).
        const next: Record<string, string | undefined> = { ...texts };
        const warnings: Array<{ resource: string; code: "rewrote_whole_file" | "sanitized" | "site_check"; fields?: string[]; message?: string }> = sanitized.map((entry) => ({ resource: entry.resource, code: "sanitized" as const, fields: entry.fields.map(describeCleaned) }));
        for (const warning of site.warnings) warnings.push({ resource: warning.path, code: "site_check", message: warning.message });
        for (const { target, draft } of loaded) {
          const path = pathOf(target);
          const kind = writeKindOf(target);
          const result = write(kind, next[path], target.kind === "item" ? target.id : undefined, draft.content);
          next[path] = result.text;
          if (result.rewroteWholeFile) warnings.push({ resource: target.resource, code: "rewrote_whole_file" });
        }
        const files: Record<string, FileContent> = Object.fromEntries(paths.filter((path) => next[path] !== texts[path]).map((path) => [path, next[path] as string]));

        // P10: uploads the published content uses and the branch does not have yet go into the same commit.
        const mediaFiles: string[] = [];
        const settings = deps.media?.settings;
        if (settings) {
          const texts = loaded.map(({ draft }) => JSON.stringify(draft.content)).join("\n");
          const used = uploadPathsIn(texts, settings.base);
          const missing: string[] = [];
          // P12h: an upload named in the content ("uploads/2026/10/chair-1a2b3c4d") that the manifest does not have yet:
          // its staged file goes into media.dir with the content, and the site's build gives it its sizes.
          const names = deps.imageNames;
          if (names?.uploads) {
            for (const name of uploadNamesIn(names, texts)) {
              if (name in names.manifest) continue;
              const tail = uploadTail(names, name)!;
              const path = await deps.media!.find(`${names.uploads.base}/${tail}`);
              if (path) used.push(path); else missing.push(name);
            }
          }
          const repoPaths = used.map((path) => repoPathOf(settings, path));
          const inRepo = used.length && publisher.exists ? await publisher.exists(head.sha, repoPaths) : new Set<string>();
          for (const [index, path] of used.entries()) {
            const repoPath = repoPaths[index];
            if (inRepo.has(repoPath)) continue;
            const staged = await deps.media!.read(path);
            if (!staged) { missing.push(path); continue; }
            files[repoPath] = staged.bytes;
            mediaFiles.push(repoPath);
          }
          if (missing.length) return await failWith(409, "media_missing", `Some images are neither on the website nor uploaded: ${missing.join(", ")} — choose them again.`, { paths: missing });
        }

        // 5. One commit (none when nothing changed), branch moved without force; if it moved under us, go again.
        let commitSha: string | null = null;
        if (Object.keys(files).length) {
          const labels = loaded.map(({ draft, target }) => draft.label || target.label);
          const message = `cms: publish ${labels.join(", ")}\n\nBy: ${user.userId} (${user.role}) via Vibe CMS\nResources: ${loaded.map(({ target }) => target.resource).join(", ")}`;
          const result = await publisher.commit({ parent: head.sha, files, message, author, date: now() });
          if ("conflict" in result) continue;
          commitSha = result.sha;
        }
        await Promise.all(loaded.map(({ target }) => audit.record({ at: now(), userId: user.userId, role: user.role, action: "succeeded", stage: "publish", resource: target.resource, detail: { publishId, commitSha, attempt, ...(warnings.some((warning) => warning.resource === target.resource && warning.code === "rewrote_whole_file") ? { warning: "rewrote_whole_file" } : {}), ...(sanitized.some((entry) => entry.resource === target.resource) ? { sanitized: sanitized.find((entry) => entry.resource === target.resource)!.fields.map((field) => field.path) } : {}) } })));
        for (const { target } of loaded) await drafts.clearAfterPublish(user.userId, target.resource);
        const expectedLiveVersion = await combinedVersion({ ...(await loadLive()), ...Object.fromEntries(Object.entries(next).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
        return json({ commitSha, resources: loaded.map(({ target }) => target.resource), files: Object.keys(files), media: mediaFiles, expectedLiveVersion, warnings, attempts: attempt });
      }
      return await failWith(502, "branch_moving", `The branch kept changing during publish (${maxAttempts} tries) — try again in a moment.`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof GitPublishError) return await failWith(error.httpStatus, error.code, error.message, error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter });
      return await failWith(500, "internal_error", "Publishing failed.");
    }
  };

  /**
   * M9 (Mr Spa: Hide from website / Show on website again): the record's status on the website changes at once — one
   * commit with only its status field set (status.archived / status.live); drafts are not involved. The person's own
   * draft of it, if any, follows (same status, started from the new version), so publishing it later does not undo
   * this nor count as stale.
   */
  const setVisibility = async (request: Request, user: Identity, target: Target) => {
    if (target.kind !== "item") return fail(404, "not_found", "Only a record can be hidden from the website.");
    const collection = target.collection;
    const status = collection.status;
    if (!status?.archived) fail(400, "no_archived_status", `${collection.label} has no "archived" status (cms.config status.archived).`);
    const body = await readBody(request);
    if (body.action !== "archive" && body.action !== "unarchive") fail(400, "bad_request", 'action must be "archive" or "unarchive".');
    const archive = body.action === "archive";
    const audit = need(deps.audit, "storage");
    const drafts = need(deps.drafts, "storage");
    const publisher = need(deps.publisher, "publisher");
    await requireAccess(user, target, "publish");
    if (deps.publishLimiter) {
      let allowed: boolean;
      try { allowed = (await deps.publishLimiter.limit({ key: `cms-publish:${user.userId}` })).success; } catch { return fail(503, "limiter_unavailable", "Publish rate limiting is unavailable."); }
      if (!allowed) fail(429, "too_many_publishes", "Publish limit reached. Please try again in a minute.", { retryAfter: 60 });
    } else if (deps.requirePublishLimiter) fail(503, "publish_limiter_missing", "Publish rate limiting is not configured.");
    const value = archive ? status!.archived! : status!.live;
    const publishId = crypto.randomUUID();
    const record = (action: "started" | "succeeded" | "failed", detail: Record<string, unknown>) => audit.record({ at: now(), userId: user.userId, role: user.role, action, stage: "publish", resource: target.resource, detail: { publishId, visibility: body.action, ...detail } });
    try { await record("started", {}); } catch { fail(503, "audit_unavailable", "The audit log cannot be written, so nothing was changed."); }
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const head = await publisher.head();
        const path = pathOf(target);
        const texts = await publisher.readFiles(head.sha, [path]);
        const branch = await onBranch(target, texts[path]);
        if (branch.value === undefined || branch.value === null || typeof branch.value !== "object") { await record("failed", { code: "not_on_website" }); return fail(404, "not_on_website", `This ${collection.itemLabel.toLowerCase()} is not on the website yet: publish it first.`); }
        const current = branch.value as Record<string, unknown>;
        const label = recordLabel(collection, current, target.id);
        const next = { ...current, [status!.field]: value };
        // P19: the site plugins, with this record's new status.
        const site = await siteCheck([{ target, content: next }], head.sha);
        if (site.errors.length) { await record("failed", { code: "site_check_failed" }); return fail(422, "site_check_failed", siteRefusal(site.errors), { errors: site.errors }); }
        let commitSha: string | null = null;
        if (current[status!.field] !== value) {
          const kind = writeKindOf(target);
          const written = write(kind, texts[path], target.id, next);
          const message = `cms: ${archive ? "hide" : "show"} ${label} ${archive ? "from" : "on"} the website\n\nBy: ${user.userId} (${user.role}) via Vibe CMS\nResources: ${target.resource}`;
          const result = await publisher.commit({ parent: head.sha, files: { [path]: written.text }, message, author, date: now() });
          if ("conflict" in result) continue;
          commitSha = result.sha;
          // My draft of it follows: the same status, from the version the branch has now.
          // The commit has landed: a draft that cannot follow (changed in another tab meanwhile) does not undo it.
          try {
            const mine = await drafts.get(user.userId, target.resource);
            if (mine && mine.content && typeof mine.content === "object") {
              const content = { ...(mine.content as Record<string, unknown>), [status!.field]: value };
              // F3: a draft that keeps its starting content stays on it: the next read carries it over (both sides set
              // the same status, so that field merges cleanly). An older draft follows the new version as before.
              if (mine.sourceContent !== undefined) await drafts.save({ userId: user.userId, resource: target.resource, label: mine.label, content, sourceVersion: mine.sourceVersion, sourceContent: mine.sourceContent, expectedRevision: mine.revision });
              else {
                const after = await onBranch(target, written.text);
                await drafts.save({ userId: user.userId, resource: target.resource, label: mine.label, content, sourceVersion: after.version, expectedRevision: mine.revision });
              }
            }
          } catch { /* the draft keeps its old version: publishing it later says it is stale */ }
        }
        await record("succeeded", { commitSha, attempt });
        return json({ resource: target.resource, status: archive ? "archived" : "live", commitSha });
      }
      await record("failed", { code: "branch_moving" });
      return fail(502, "branch_moving", `The branch kept changing (${maxAttempts} tries) — try again in a moment.`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      await record("failed", { code: error instanceof GitPublishError ? error.code : "internal_error" });
      if (error instanceof GitPublishError) return fail(error.httpStatus, error.code, error.message);
      return fail(500, "internal_error", "Changing what the website shows failed.");
    }
  };

  // ---------------------------------------------------------------- M6: did the site's build fail?

  /** `?commit=<sha>` with `publish.buildCheck` set: the site's build of that commit ("failed" = say so, stop waiting). */
  const buildOf = async (request: Request): Promise<{ build?: string }> => {
    const sha = new URL(request.url).searchParams.get("commit") ?? "";
    const name = config.publish?.buildCheck;
    if (!name || !/^[0-9a-f]{40}$/.test(sha) || !deps.publisher?.checkRuns) return {};
    try { return { build: buildState(await deps.publisher.checkRuns(sha), name) }; } catch { return { build: "unknown" }; }
  };

  // ---------------------------------------------------------------- media (P10)

  /**
   * M5: where the live content uses each image (by address), for the image sheet — group "Pages" for a file, the
   * collection's name (the one it is a tab of, when `under`) for a record. Only what this person may open.
   */
  const imageUsage = async (user?: Identity): Promise<ImageUsage> => {
    const usage: ImageUsage = {};
    for (const file of config.files) {
      if (user && !mayOpen(user, file)) continue;
      const record = await reader.file(file.key);
      if (!record) continue;
      const target: Target = { kind: "file", file, resource: `file:${file.key}`, label: file.label };
      addUsage(usage, imagePlacesOfRecord(file.fields, await toAddresses(target, record.data)), { label: file.label, group: "Pages", resource: target.resource });
    }
    for (const collection of config.collections) {
      if (user && !mayOpen(user, collection)) continue;
      const parent = collection.under ? config.collections.find((entry) => entry.key === collection.under) : undefined;
      for (const record of await reader.items(collection.key)) {
        const parsed = parseResourceId(record.resource);
        const id = parsed.kind === "item" ? parsed.id : "";
        const target: Target = { kind: "item", collection, id, resource: record.resource, label: collection.itemLabel };
        const data = await toAddresses(target, record.data);
        const body = collection.store.kind === "markdown-dir" && data && typeof data === "object" && typeof (data as Record<string, unknown>).body === "string" ? String((data as Record<string, unknown>).body) : undefined;
        addUsage(usage, imagePlacesOfRecord(collection.fields, data, body), { label: recordLabel(collection, data, id), group: (parent ?? collection).label, resource: record.resource });
      }
    }
    return usage;
  };

  // ---------------------------------------------------------------- M11: Media — names, archive, remove (the Mr Spa CMS's rules)

  /** "2026/10/chair-1a2b3c4d": the part of an upload's address that both its address and its name hold (drafts keep either). */
  const uploadStem = (media: NonNullable<typeof deps.media>, src: string) => { const match = media.pattern.exec(src); return match ? `${match[1]}/${match[2]}/${match[3]}-${match[4]}` : undefined; };
  /** Is the upload on the website (built into it, or committed on the publish branch)? Throws when it cannot be told. */
  const isPublished = async (media: NonNullable<typeof deps.media>, src: string) => {
    if ((deps.siteImages ?? []).some((image) => image.src === src)) return true;
    // Without GitHub (local development) the built site's images are the website; with it, a failure to read is "unknown".
    const publisher = deps.publisher;
    if (!publisher?.exists) return false;
    const path = repoPath(media, src);
    return (await publisher.exists((await publisher.head()).sha, [path])).has(path);
  };
  const repoPath = (media: NonNullable<typeof deps.media>, src: string) => `${media.settings.dir}${src.slice(media.settings.base.length)}`;
  /** Where an image is used now: the live content (everything, whoever asks) and every person's saved drafts. */
  const usedBy = async (media: NonNullable<typeof deps.media>, src: string) => {
    const places = (await imageUsage())[src] ?? [];
    const stem = uploadStem(media, src);
    const drafts = stem && deps.drafts ? await deps.drafts.using(stem) : [];
    return { places, drafts };
  };
  const needUpload = (media: NonNullable<typeof deps.media>, value: unknown) => {
    if (typeof value !== "string" || !media.pattern.test(value)) fail(400, "invalid_path", "Only uploaded images can be changed here.");
    return value as string;
  };

  /** The detail panel's "Used on": the live places of the person's reach, and the saved drafts (any person) that use it. */
  const mediaUsage = async (request: Request, user: Identity) => {
    const src = new URL(request.url).searchParams.get("src") ?? "";
    if (!src.startsWith("/")) fail(400, "invalid_path", "Invalid image address.");
    const places = (await imageUsage(user))[src] ?? [];
    const stem = deps.media ? uploadStem(deps.media, src) : undefined;
    let drafts: Array<{ resource: string; label: string; mine: boolean }> = [];
    let draftsKnown = true;
    if (stem && deps.drafts) {
      try { drafts = (await deps.drafts.using(stem)).map((row) => ({ resource: row.resource, label: row.label, mine: row.userId === user.userId })); } catch { draftsKnown = false; }
    }
    return json({ src, places, drafts, draftsKnown });
  };

  const renameMedia = async (request: Request) => {
    const media = need(deps.media, "media");
    const body = await readBody(request) as { src?: unknown; name?: unknown };
    const src = needUpload(media, body.src);
    const name = cleanDisplayName(body.name);
    if (!name) fail(400, "invalid_name", "Enter an image name up to 120 characters.");
    await media.setNote(src, { displayName: name });
    return json({ src, displayName: name });
  };

  const archiveMedia = async (request: Request, user: Identity, archived: boolean) => {
    const media = need(deps.media, "media");
    const body = await readBody(request) as { src?: unknown };
    const src = needUpload(media, body.src);
    if (!archived) { await media.setNote(src, { archivedAt: undefined, archivedBy: undefined }); return json({ src, archived: false }); }
    let published: boolean; let used: Awaited<ReturnType<typeof usedBy>>;
    try { published = await isPublished(media, src); used = await usedBy(media, src); } catch { return fail(503, "usage_unknown", "Could not check whether this image is still used, so it was not archived. Please try again."); }
    if (!published) fail(409, "not_published", "This image is not published yet. Remove it instead.");
    if (used.places.length || used.drafts.length) fail(409, "image_in_use", "This image is still used, so it cannot be archived.");
    const archivedAt = now();
    await media.setNote(src, { archivedAt, archivedBy: user.userId });
    return json({ src, archived: true, archivedAt });
  };

  const removeMedia = async (request: Request) => {
    const media = need(deps.media, "media");
    const src = needUpload(media, new URL(request.url).searchParams.get("src"));
    if (!(await media.staged(src))) fail(404, "not_found", "Media file does not exist.");
    let published: boolean; let used: Awaited<ReturnType<typeof usedBy>>;
    try { published = await isPublished(media, src); used = await usedBy(media, src); } catch { return fail(503, "usage_unknown", "Could not check whether this image is still used, so it was not deleted. Please try again."); }
    if (published) fail(409, "published", "This image is published on the website. Archive it instead.");
    if (used.places.length || used.drafts.length) fail(409, "image_in_use", "This media file is still referenced by CMS content and cannot be deleted.");
    try { await media.remove(src); } catch (error) { if (error instanceof MediaError) fail(error.status, error.code, error.message); throw error; }
    return json({ src, removed: true });
  };

  /** Remove unused images…: uploads never published, used nowhere, uploaded more than 30 days ago. */
  const CLEANUP_AGE = 30 * 24 * 3600 * 1000;
  const cleanupMedia = async (request: Request) => {
    const media = need(deps.media, "media");
    const body = await readBody(request) as { dryRun?: unknown };
    const dryRun = body.dryRun !== false;
    const candidates: string[] = []; let keptRecent = 0;
    try {
      const usage = await imageUsage();
      let cursor: string | undefined;
      const uploads: Array<{ src: string; uploadedAt: string }> = [];
      do { const page = await media.list({ ...(cursor ? { cursor } : {}), limit: 1000 }); uploads.push(...page.images); cursor = page.cursor; } while (cursor);
      const nowMs = Date.parse(now());
      for (const upload of uploads) {
        if (usage[upload.src]?.length) continue;
        const stem = uploadStem(media, upload.src);
        if (stem && deps.drafts && (await deps.drafts.using(stem)).length) continue;
        if (await isPublished(media, upload.src)) continue;
        if (nowMs - Date.parse(upload.uploadedAt) > CLEANUP_AGE) candidates.push(upload.src); else keptRecent += 1;
      }
    } catch { return fail(503, "usage_unknown", "Could not check which images are still used, so nothing was removed. Please try again."); }
    if (!dryRun) for (const src of candidates) await media.remove(src);
    return json({ dryRun, removed: candidates.length, keptRecent });
  };

  const listMedia = async (request: Request, user: Identity) => {
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const uploads = deps.media ? await deps.media.list({ cursor }) : { images: [], cursor: undefined };
    // M11: each upload's display name and archive date (its note).
    const notes = deps.media && !cursor ? await deps.media.notes() : new Map();
    return json({ ...(cursor ? {} : { notes: Object.fromEntries(notes) }), uploads: uploads.images, cursor: uploads.cursor ?? null, site: cursor ? [] : deps.siteImages ?? [], ...(cursor ? {} : { usage: await imageUsage(user) }), uploadsEnabled: Boolean(deps.media), base: deps.media?.settings.base ?? null, maxBytes: deps.media?.settings.maxBytes ?? null });
  };

  const uploadMedia = async (request: Request, user: Identity) => {
    const media = need(deps.media, "media");
    // Same limiter as publishing, its own key: 20 uploads a minute per person.
    if (deps.publishLimiter) {
      let allowed: boolean;
      try { allowed = (await deps.publishLimiter.limit({ key: `cms-media:${user.userId}` })).success; } catch { return fail(503, "limiter_unavailable", "Upload rate limiting is unavailable."); }
      if (!allowed) fail(429, "too_many_uploads", "Too many uploads in a minute. Please wait a moment.", { retryAfter: 60 });
    } else if (deps.requirePublishLimiter) fail(503, "publish_limiter_missing", "Upload rate limiting is not configured.");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > media.settings.maxBytes) fail(413, "image_too_large", `The image is larger than ${Math.round(media.settings.maxBytes / 1024 / 1024)} MB.`);
    // Read at most maxBytes + 1, whatever content-length says (a chunked body has none).
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = request.body?.getReader();
    for (let part = reader ? await reader.read() : { done: true as const, value: undefined }; !part.done; part = await reader!.read()) {
      total += part.value.length;
      if (total > media.settings.maxBytes) { await reader!.cancel(); fail(413, "image_too_large", `The image is larger than ${Math.round(media.settings.maxBytes / 1024 / 1024)} MB.`); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.length; }, 0);
    let fileName = "image";
    try { fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "image"); } catch { /* keep "image" */ }
    const number = (name: string) => { const value = Number(request.headers.get(name)); return Number.isInteger(value) && value > 0 && value < 100_000 ? value : undefined; };
    try {
      const staged = await media.stage({ bytes, fileName, userId: user.userId, width: number("x-image-width"), height: number("x-image-height") });
      return json({ image: staged }, staged.reused ? 200 : 201);
    } catch (error) {
      if (error instanceof MediaError) fail(error.status, error.code, error.message);
      throw error;
    }
  };

  // ---------------------------------------------------------------- activity (P12b)

  /** What each filter of the Activity screen shows. "started" publish rows are never listed (the outcome row is). */
  const ACTIVITY: Record<string, { stages?: Array<AuditEntry["stage"]>; actions: Array<AuditEntry["action"]> }> = {
    all: { actions: ["succeeded", "failed", "denied", "login", "login_failed", "logout", "password_change", "bootstrap", "user_create", "user_disable", "user_enable", "user_password_reset", "user_role_change"] },
    publish: { stages: ["publish"], actions: ["succeeded", "failed"] },
    signin: { stages: ["auth"], actions: ["login", "login_failed", "logout", "password_change", "bootstrap"] },
    people: { stages: ["people"], actions: ["user_create", "user_disable", "user_enable", "user_password_reset", "user_role_change"] },
    denied: { actions: ["denied", "login_failed"] },
    // M12 (Mr Spa): Failed = everything that did not go through.
    failed: { actions: ["failed", "denied", "login_failed"] },
  };
  const ACTIVITY_PAGE = 50;

  /** "Salon info", "Service · nail-art", a person's name — the label of an audit row's resource, from cms.config. */
  const resourceLabel = (resource: string, names: Map<string, string>) => {
    if (resource.startsWith("user:")) return names.get(resource.slice(5)) ?? "A person";
    try {
      const parsed = parseResourceId(resource);
      if (parsed.kind === "file") return config.files.find((entry) => entry.key === parsed.key)?.label ?? parsed.key;
      const collection = config.collections.find((entry) => entry.key === parsed.key);
      return collection ? `${collection.itemLabel} · ${parsed.id}` : parsed.id;
    } catch { return resource; }
  };

  const activity = async (request: Request, user: Identity) => {
    if (user.role !== "owner") fail(403, "owner_only", "Only an admin can see the activity log.");
    const audit = need(deps.audit, "storage");
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "all";
    const filter = ACTIVITY[kind] ?? fail(400, "bad_request", `kind must be one of ${Object.keys(ACTIVITY).join(", ")}.`);
    const beforeText = params.get("before");
    const before = beforeText === null ? undefined : Number(beforeText);
    if (before !== undefined && !(Number.isSafeInteger(before) && before > 0)) fail(400, "bad_request", "before must be the id of an activity row.");
    // M12: the Mr Spa CMS shows the last 100 events (?limit=1..100; 50 by default).
    const asked = Number(params.get("limit") ?? ACTIVITY_PAGE);
    const limit = Number.isInteger(asked) && asked >= 1 && asked <= 100 ? asked : ACTIVITY_PAGE;
    const rows = await audit.list({ limit, before, ...filter });
    const names = new Map((await (deps.userNames?.() ?? Promise.resolve([]))).map((person) => [person.id, person.displayName || person.username]));
    const entries = rows.map((row) => ({
      id: row.id, at: row.at, userId: row.userId, who: names.get(row.userId) ?? (row.userId === "anonymous" ? null : row.userId), role: row.role,
      action: row.action, stage: row.stage, resource: row.resource, what: resourceLabel(row.resource, names), detail: row.detail,
    }));
    return json({ kind, entries, next: rows.length === limit ? rows[rows.length - 1].id : null });
  };

  // ---------------------------------------------------------------- history (P12c)

  /** M12: the Mr Spa CMS shows the last 10 versions (?limit=1..25). */
  const HISTORY_LIMIT = 10;
  const HISTORY_MAX = 25;
  /** The user id in a Vibe CMS commit message ("By: usr_… (owner) via Vibe CMS"). */
  const committedBy = (message: string) => /\nBy: ([A-Za-z0-9_-]{1,80}) \((?:owner|editor)\) via Vibe CMS/.exec(message)?.[1];
  /** M12: every role (as in the Mr Spa CMS's top bar); an admin-only file / collection stays admins only. */
  const historyTarget = async (user: Identity, resource: string | null, stage?: "draft") => {
    if (!resource) return fail(400, "bad_request", "resource is required (e.g. file:site).");
    let target: Target;
    try { target = targetOf(resource); } catch (error) { if (error instanceof ApiError) throw error; return fail(400, "bad_request", `Not a resource id: ${resource}`); }
    await requireAccess(user, target, stage);
    return target;
  };
  const historyPublisher = () => {
    const publisher = need(deps.publisher, "publisher");
    if (!publisher.history) fail(503, "history_not_available", "This site's publisher cannot read the history.");
    return publisher as GitPublisher & Required<Pick<GitPublisher, "history">>;
  };
  /** The resource's value in the file as it was at `sha` (undefined = it did not exist then). */
  const valueAt = async (publisher: GitPublisher, target: Target, sha: string) => (await onBranch(target, (await publisher.readFiles(sha, [pathOf(target)]))[pathOf(target)])).value;
  const commitParam = (value: unknown) => (typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value) ? value : fail(400, "bad_request", "commit must be a commit id."));

  /**
   * The versions of one resource: the branch's commits that changed its file, newest first (a record of a JSON list:
   * only the commits that changed THAT record). Also the publishes made by an older CMS or edits in the code.
   */
  const history = async (request: Request, user: Identity) => {
    const params = new URL(request.url).searchParams;
    const target = await historyTarget(user, params.get("resource"));
    const publisher = historyPublisher();
    const asked = Number(params.get("limit") ?? HISTORY_LIMIT);
    const limit = Number.isInteger(asked) && asked >= 1 && asked <= HISTORY_MAX ? asked : HISTORY_LIMIT;
    // M12: ?contents=1 — each version's value and the live one, so the dialog can say what restoring would change.
    const withContents = params.get("contents") === "1";
    const shared = target.kind === "item" ? isJsonStore(target.collection.store) : Boolean(target.file.pointer);
    const commits = await publisher.history(pathOf(target), shared ? limit + 1 : limit);
    let kept: Array<{ commit: (typeof commits)[number]; removed: boolean; value?: unknown }> = commits.map((commit) => ({ commit, removed: false }));
    if (shared) {
      const values: unknown[] = [];
      for (const commit of commits) values.push(await valueAt(publisher, target, commit.sha));
      // A commit counts when the record differs from the next older commit's; the oldest one read counts when the record is in it.
      const last = commits.length - 1;
      kept = commits.map((commit, index) => ({ commit, removed: values[index] === undefined, value: values[index], changed: index === last ? values[index] !== undefined : !sameValue(values[index], values[index + 1]) }))
        .filter((entry, index) => entry.changed && index < limit);
    } else if (withContents) {
      kept = await Promise.all(kept.map(async (entry) => ({ ...entry, value: await valueAt(publisher, target, entry.commit.sha) })));
    }
    const current = withContents ? await live(target) : undefined;
    const names = new Map((await (deps.userNames?.() ?? Promise.resolve([]))).map((person) => [person.id, person.displayName || person.username]));
    return json({
      resource: target.resource, label: target.kind === "file" ? target.label : target.id,
      versions: kept.map(({ commit, removed, value }) => {
        const by = committedBy(commit.message);
        return {
          commit: commit.sha, date: commit.date, title: commit.message.split("\n")[0], who: (by && names.get(by)) || commit.author || null, viaCms: /^cms: publish\b/.test(commit.message), removed,
          ...(withContents ? { content: value ?? null } : {}),
        };
      }),
      ...(current ? { live: current.value ?? null } : {}),
    });
  };

  /** One version's content, and whether it is what the website shows now. */
  const historyVersion = async (request: Request, user: Identity) => {
    const params = new URL(request.url).searchParams;
    const target = await historyTarget(user, params.get("resource"));
    const commit = commitParam(params.get("commit"));
    const content = await valueAt(historyPublisher(), target, commit);
    const current = await live(target);
    return json({ resource: target.resource, commit, content: content ?? null, live: current.value ?? null, sameAsLive: content !== undefined && sameValue(content, current.value) });
  };

  /** Restore as draft: the old version becomes my draft of the resource; it is published like any draft. */
  const historyRestore = async (request: Request, user: Identity) => {
    const body = await readBody(request);
    const target = await historyTarget(user, typeof body.resource === "string" ? body.resource : null, "draft");
    const commit = commitParam(body.commit);
    const drafts = need(deps.drafts, "storage");
    const audit = need(deps.audit, "storage");
    const content = await valueAt(historyPublisher(), target, commit);
    if (content === undefined) fail(404, "not_in_version", `${target.kind === "file" ? target.label : `This ${target.collection.itemLabel.toLowerCase()}`} did not exist in that version.`);
    const current = await live(target);
    if (sameValue(content, current.value)) fail(409, "same_as_live", "That version is what the website shows now — nothing to restore.");
    const existing = await drafts.get(user.userId, target.resource);
    if (existing && body.replace !== true) fail(409, "draft_exists", "You already have a draft of this. Restoring replaces it — confirm to go on.", { needsConfirmation: true });
    const checked = await checkValues(target, content);
    if (checked.errors.length) fail(422, "invalid_content", "That version no longer fits the site's fields (the CMS settings changed since) — it cannot be restored as it is.", { errors: checked.errors });
    const fixed = structureProblems(target, current.value, content);
    if (fixed.length) fail(422, "fixed_list", fixed[0].message, { errors: fixed });
    const label = target.kind === "file" ? target.label : recordLabel(target.collection, content, target.id);
    try {
      const draft = await saveDraftChecked({ config, role: user.role, drafts, audit, source: current.value, now, input: { userId: user.userId, resource: target.resource, label, content, sourceVersion: current.version, ...(current.value === undefined ? {} : { sourceContent: current.value }), expectedRevision: existing?.revision ?? 0 } });
      return json({ resource: target.resource, commit, draft: draftView(draft, current.version) });
    } catch (error) {
      if (error instanceof DraftConflictError) fail(409, "draft_conflict", error.message, { currentRevision: error.current });
      if (error instanceof DraftTooLargeError) fail(413, "draft_too_large", error.message);
      throw error;
    }
  };

  // ---------------------------------------------------------------- router

  const routes: Array<{ pattern: RegExp; methods: Record<string, (request: Request, user: Identity, match: RegExpMatchArray) => Promise<Response>> }> = [
    { pattern: /^\/content$/, methods: { GET: (_request, user) => listContent(user) } },
    { pattern: /^\/users$/, methods: {
      GET: (request, user) => (deps.people ?? fail(404, "not_found", "People are not available on this site."))(request, user),
      POST: (request, user) => (deps.people ?? fail(404, "not_found", "People are not available on this site."))(request, user),
    } },
    { pattern: /^\/users\/(usr_[a-z2-7]{1,64}|[A-Za-z0-9_-]{1,64})$/, methods: {
      PATCH: (request, user, match) => (deps.people ?? fail(404, "not_found", "People are not available on this site."))(request, user, match[1]),
    } },
    { pattern: /^\/drafts$/, methods: { GET: (_request, user) => listDrafts(user) } },
    { pattern: /^\/activity$/, methods: { GET: (request, user) => activity(request, user) } },
    { pattern: /^\/history$/, methods: { GET: (request, user) => history(request, user) } },
    { pattern: /^\/history\/version$/, methods: { GET: (request, user) => historyVersion(request, user) } },
    { pattern: /^\/history\/restore$/, methods: { POST: (request, user) => historyRestore(request, user) } },
    { pattern: /^\/media$/, methods: { GET: (request, user) => listMedia(request, user), POST: (request, user) => uploadMedia(request, user), DELETE: (request) => removeMedia(request) } },
    // M11: the Media screen.
    { pattern: /^\/media\/usage$/, methods: { GET: (request, user) => mediaUsage(request, user) } },
    { pattern: /^\/media\/name$/, methods: { POST: (request) => renameMedia(request) } },
    { pattern: /^\/media\/archive$/, methods: { POST: (request, user) => archiveMedia(request, user, true) } },
    { pattern: /^\/media\/unarchive$/, methods: { POST: (request, user) => archiveMedia(request, user, false) } },
    { pattern: /^\/media\/cleanup$/, methods: { POST: (request) => cleanupMedia(request) } },
    { pattern: /^\/live-version$/, methods: { GET: async (request) => json({ liveVersion: await getLiveVersion(), branch: config.repo.branch, ...(await buildOf(request)) }) } },
    { pattern: /^\/publish$/, methods: { POST: (request, user) => publish(request, user) } },
    { pattern: /^\/files\/([a-z][a-z0-9-]*)$/, methods: {
      GET: (_request, user, match) => getResource(user, targetOf(`file:${match[1]}`)),
      PUT: (request, user, match) => putDraft(request, user, targetOf(`file:${match[1]}`)),
      DELETE: (_request, user, match) => deleteDraft(user, targetOf(`file:${match[1]}`)),
    } },
    { pattern: /^\/collections\/([a-z][a-z0-9-]*)$/, methods: { GET: (_request, user, match) => listItems(user, match[1]) } },
    { pattern: /^\/collections\/([a-z][a-z0-9-]*)\/items\/([^/]+)$/, methods: {
      GET: (_request, user, match) => getResource(user, targetOf(`item:${match[1]}:${decodeURIComponent(match[2])}`)),
      PUT: (request, user, match) => putDraft(request, user, targetOf(`item:${match[1]}:${decodeURIComponent(match[2])}`)),
      DELETE: (_request, user, match) => deleteDraft(user, targetOf(`item:${match[1]}:${decodeURIComponent(match[2])}`)),
    } },
    { pattern: /^\/collections\/([a-z][a-z0-9-]*)\/items\/([^/]+)\/visibility$/, methods: {
      POST: (request, user, match) => setVisibility(request, user, targetOf(`item:${match[1]}:${decodeURIComponent(match[2])}`)),
    } },
  ];

  const sameSite = (request: Request) => {
    const origin = request.headers.get("origin");
    if (!origin) return false;
    const allowed = new Set([new URL(request.url).origin]);
    try { allowed.add(new URL(config.site.url).origin); } catch { /* checked by the config check */ }
    return allowed.has(origin);
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const isGet = request.method === "GET" || request.method === "HEAD";
    const withVersion = async (response: Response) => {
      if (isGet) { try { response.headers.set("x-cms-live-version", await getLiveVersion()); } catch { /* the response still goes out */ } }
      return response;
    };
    try {
      if (!url.pathname.startsWith(`${base}/`)) fail(404, "not_found", "Not a CMS route.");
      const path = url.pathname.slice(base.length);
      const route = routes.find((entry) => entry.pattern.test(path)) ?? fail(404, "not_found", "Not a CMS route.");
      const method = request.method === "HEAD" ? "GET" : request.method;
      const handler = route.methods[method] ?? fail(405, "method_not_allowed", `${request.method} is not allowed here.`, { allow: Object.keys(route.methods) });
      const user = await deps.identify(request);
      if (user === undefined) fail(503, "auth_not_configured", "Sign-in is not configured on this site yet, so the CMS API is closed.");
      if (user === null) fail(401, "unauthenticated", "Sign in first.");
      assertUserId(user!.userId);
      if (user!.mustChangePassword) fail(403, "password_change_required", "Change your temporary password first (PUT /api/auth/password).");
      if (!isGet && !sameSite(request)) fail(403, "origin_forbidden", "Requests that change content must come from this site.");
      return await withVersion(await handler(request, user!, path.match(route.pattern)!));
    } catch (error) {
      if (error instanceof LockedFieldError) return withVersion(json(lockedFieldBody(error), 403));
      if (error instanceof ApiError) return withVersion(json({ error: error.code, message: error.message, ...error.extra }, error.status, error.status === 405 ? { allow: String((error.extra.allow as string[] | undefined)?.join(", ") ?? "") } : {}));
      return withVersion(json({ error: "internal_error", message: "Something went wrong in the CMS API." }, 500));
    }
  };

  return { handle, liveVersion: getLiveVersion };
};
