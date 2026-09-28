/**
 * P5: the CMS API, runtime-agnostic (Request → Response), so the Astro route, a test Worker in `wrangler dev --local`
 * and Node tests all run the same code. Identity, stores, GitHub and the clock are injected.
 *
 * Routes (under /api/cms; every route needs an identity):
 *   GET    /content                         files + collections from cms.config (label, count, my drafts)
 *   GET    /files/:key                      live content + version + my draft
 *   PUT    /files/:key                      save my draft   { content, expectedRevision, sourceVersion? }
 *   DELETE /files/:key                      discard my draft
 *   GET    /collections/:key                records (id, label, version, my draft)
 *   GET    /collections/:key/items/:id      live record + version + my draft
 *   PUT    /collections/:key/items/:id      save my draft of one record (new id = new record)
 *   DELETE /collections/:key/items/:id      discard my draft
 *   POST   /publish                         { resources: [...] } → exactly one commit
 *   GET    /live-version                    the version of the content this Worker serves
 * Every GET answers with the header x-cms-live-version (F-16).
 */
import type { CmsCollection, CmsConfig, CmsFile } from "../config/index.js";
import { checkRecordValues } from "../check/values.js";
import { checkPublishLocks, LockedFieldError, lockedFieldBody, saveDraftChecked, type AuditLog, type Role } from "../locks/index.js";
import {
  assertUserId, createContentReader, DraftConflictError, DraftTooLargeError, MAX_DRAFT_BYTES, parseResourceId, resourceId, textVersion, valueVersion,
  type ContentSource, type Draft, type DraftStore,
} from "../store/index.js";
import { parseMarkdown } from "../writer/markdown.js";
import { recordPath, writeArrayItem, writeFile, writeMarkdownItem } from "../writer/index.js";
import type { WriteResult } from "../writer/json.js";
import { GitPublishError, type CommitAuthor, type GitPublisher } from "./github.js";

export { createGitHubPublisher, GitPublishError, type CommitAuthor, type CommitInput, type GitHubOptions, type GitPublisher } from "./github.js";

// ---------------------------------------------------------------- identity

export type Identity = { userId: string; role: Role };
/** Identity for a request. undefined = sign-in is not set up on this site (503); null = not signed in (401). */
export type Identify = (request: Request) => Identity | null | undefined | Promise<Identity | null | undefined>;

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
  /** Test seam: the writer used at publish (default: the P3 writer). */
  write?: (collectionOrFile: { kind: "file" } | { kind: "json-array"; idField: string } | { kind: "markdown" }, text: string | undefined, id: string | undefined, content: unknown) => WriteResult;
};

export const DEFAULT_AUTHOR: CommitAuthor = { name: "Vibe CMS", email: "vibe-cms@users.noreply.github.com" };

const defaultWrite: NonNullable<CmsApiDeps["write"]> = (target, text, id, content) => {
  if (target.kind === "file") return writeFile(text, content);
  if (target.kind === "json-array") return writeArrayItem(text ?? "[]\n", target.idField, id!, content as Record<string, unknown>);
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

  const idFieldOf = (collection: CmsCollection) => (collection.store.kind === "json-array" ? collection.store.idField : collection.store.slugField);
  const systemOf = (collection: CmsCollection) => [idFieldOf(collection), ...(collection.status ? [collection.status.field] : []), ...(collection.store.kind === "markdown-dir" ? ["body"] : [])];
  const fileOf = (key: string) => config.files.find((entry) => entry.key === key) ?? fail(404, "not_found", `No file "${key}" in cms.config.`);
  const collectionOf = (key: string) => config.collections.find((entry) => entry.key === key) ?? fail(404, "not_found", `No collection "${key}" in cms.config.`);
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

  // Live content (what this Worker was built with).
  let liveFiles: Promise<Record<string, string>> | undefined;
  const loadLive = () => (liveFiles ??= (async () => {
    const out: Record<string, string> = {};
    const paths = [...config.files.map((file) => file.path), ...config.collections.filter((c) => c.store.kind === "json-array").map((c) => (c.store as { path: string }).path)];
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
    if (target.kind === "file") return text === undefined ? { value: undefined, version: "missing" } : { value: JSON.parse(text.replace(/^﻿/, "")), version: await textVersion(text) };
    const store = target.collection.store;
    if (store.kind === "json-array") {
      const list = text === undefined ? [] : (JSON.parse(text.replace(/^﻿/, "")) as Array<Record<string, unknown>>);
      const item = list.find((entry) => entry?.[store.idField] === target.id);
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
  const checkValues = async (target: Target, content: unknown, extraIds: Map<string, Set<string>> = new Map()) => {
    const ids = await idsForReferences();
    for (const [key, set] of extraIds) for (const id of set) ids.get(key)?.add(id);
    if (target.kind === "file") return checkRecordValues({ fields: target.file.fields, record: content, ids });
    const result = checkRecordValues({ fields: target.collection.fields, record: content, ids, system: systemOf(target.collection) });
    const idField = idFieldOf(target.collection);
    const record = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
    if (record[idField] !== target.id) result.errors.push({ path: idField, message: `must be "${target.id}" (the record's id)`, hint: "the id cannot be changed in a draft" });
    return result;
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

  const draftView = (draft: Draft | undefined, version: string) =>
    draft ? { content: draft.content, revision: draft.revision, sourceVersion: draft.sourceVersion, updatedAt: draft.updatedAt, label: draft.label, stale: draft.sourceVersion !== version } : null;

  // ---------------------------------------------------------------- handlers

  const listContent = async (user: Identity) => {
    const drafts = need(deps.drafts, "storage");
    const mine = await drafts.mine(user.userId);
    const files = config.files.map((file) => ({ kind: "file", key: file.key, label: file.label, resource: resourceId({ kind: "file", key: file.key }), hasDraft: mine.some((row) => row.resource === resourceId({ kind: "file", key: file.key })) }));
    const collections = await Promise.all(config.collections.map(async (collection) => ({
      kind: "collection", key: collection.key, label: collection.label, itemLabel: collection.itemLabel,
      count: (await reader.items(collection.key)).length, drafts: mine.filter((row) => row.kind === "item" && row.resourceKey === collection.key).length,
    })));
    return json({ files, collections });
  };

  const listItems = async (user: Identity, key: string) => {
    const collection = collectionOf(key);
    const drafts = need(deps.drafts, "storage");
    const mine = (await drafts.mine(user.userId)).filter((row) => row.kind === "item" && row.resourceKey === key);
    const records = await reader.items(key);
    const items = records.map((record) => {
      const parsed = parseResourceId(record.resource);
      const id = parsed.kind === "item" ? parsed.id : "";
      return { id, resource: record.resource, label: recordLabel(collection, record.data, id), version: record.version, hasDraft: mine.some((row) => row.resource === record.resource) };
    });
    const known = new Set(items.map((item) => item.resource));
    const newDrafts = mine.filter((row) => !known.has(row.resource)).map((row) => ({ id: row.itemId, resource: row.resource, label: row.label, version: null, hasDraft: true, isNew: true }));
    return json({ key, label: collection.label, itemLabel: collection.itemLabel, items: [...items, ...newDrafts] });
  };

  const getResource = async (user: Identity, target: Target) => {
    const drafts = need(deps.drafts, "storage");
    const current = await live(target);
    const draft = await drafts.get(user.userId, target.resource);
    if (current.value === undefined && !draft) fail(404, "not_found", `${target.resource} does not exist.`);
    return json({ resource: target.resource, label: target.kind === "file" ? target.label : recordLabel(target.collection, current.value ?? draft?.content, target.id), content: current.value ?? null, version: current.version, draft: draftView(draft, current.version) });
  };

  const putDraft = async (request: Request, user: Identity, target: Target) => {
    const drafts = need(deps.drafts, "storage");
    const audit = need(deps.audit, "storage");
    const body = await readBody(request);
    const expectedRevision = body.expectedRevision;
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) fail(400, "expected_revision_required", "expectedRevision is required: 0 for a new draft, else the revision you loaded.");
    if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) fail(400, "bad_request", "content must be an object.");
    const checked = await checkValues(target, body.content);
    if (checked.errors.length) fail(422, "invalid_content", "The content does not match cms.config.", { errors: checked.errors });
    const current = await live(target);
    const sourceVersion = typeof body.sourceVersion === "string" && body.sourceVersion ? body.sourceVersion : current.version;
    const label = target.kind === "file" ? target.label : recordLabel(target.collection, body.content, target.id);
    try {
      const draft = await saveDraftChecked({ config, role: user.role, drafts, audit, source: current.value, now, input: { userId: user.userId, resource: target.resource, label, content: body.content, sourceVersion, expectedRevision: expectedRevision as number } });
      return json({ resource: target.resource, draft: draftView(draft, current.version), warnings: checked.warnings });
    } catch (error) {
      if (error instanceof DraftConflictError) fail(409, "draft_conflict", error.message, { currentRevision: error.current });
      if (error instanceof DraftTooLargeError) fail(413, "draft_too_large", error.message);
      throw error;
    }
  };

  const deleteDraft = async (user: Identity, target: Target) => json({ resource: target.resource, deleted: await need(deps.drafts, "storage").discard(user.userId, target.resource) });

  const publish = async (request: Request, user: Identity) => {
    const drafts = need(deps.drafts, "storage");
    const audit = need(deps.audit, "storage");
    const publisher = need(deps.publisher, "publisher");
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
        const changed: string[] = [];
        const befores = new Map<string, unknown>();
        for (const { target, draft } of loaded) {
          const branch = await onBranch(target, texts[pathOf(target)]);
          befores.set(target.resource, branch.value);
          if (branch.version !== draft.sourceVersion) changed.push(target.resource);
        }
        if (changed.length) return await failWith(409, "source_changed", "The content changed since you started editing — reload, check, and publish again.", { resources: changed });

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
        }

        // 4. Write with the format-keeping writer (several records of one file are applied in turn).
        const next: Record<string, string | undefined> = { ...texts };
        const warnings: Array<{ resource: string; code: "rewrote_whole_file" }> = [];
        for (const { target, draft } of loaded) {
          const path = pathOf(target);
          const kind = target.kind === "file" ? { kind: "file" as const } : target.collection.store.kind === "json-array" ? { kind: "json-array" as const, idField: target.collection.store.idField } : { kind: "markdown" as const };
          const result = write(kind, next[path], target.kind === "item" ? target.id : undefined, draft.content);
          next[path] = result.text;
          if (result.rewroteWholeFile) warnings.push({ resource: target.resource, code: "rewrote_whole_file" });
        }
        const files = Object.fromEntries(paths.filter((path) => next[path] !== texts[path]).map((path) => [path, next[path] as string]));

        // 5. One commit (none when nothing changed), branch moved without force; if it moved under us, go again.
        let commitSha: string | null = null;
        if (Object.keys(files).length) {
          const labels = loaded.map(({ draft, target }) => draft.label || target.label);
          const message = `cms: publish ${labels.join(", ")}\n\nBy: ${user.userId} (${user.role}) via Vibe CMS\nResources: ${loaded.map(({ target }) => target.resource).join(", ")}`;
          const result = await publisher.commit({ parent: head.sha, files, message, author, date: now() });
          if ("conflict" in result) continue;
          commitSha = result.sha;
        }
        await Promise.all(loaded.map(({ target }) => audit.record({ at: now(), userId: user.userId, role: user.role, action: "succeeded", stage: "publish", resource: target.resource, detail: { publishId, commitSha, attempt, ...(warnings.some((warning) => warning.resource === target.resource) ? { warning: "rewrote_whole_file" } : {}) } })));
        for (const { target } of loaded) await drafts.clearAfterPublish(user.userId, target.resource);
        const expectedLiveVersion = await combinedVersion({ ...(await loadLive()), ...Object.fromEntries(Object.entries(next).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
        return json({ commitSha, resources: loaded.map(({ target }) => target.resource), files: Object.keys(files), expectedLiveVersion, warnings, attempts: attempt });
      }
      return await failWith(502, "branch_moving", `The branch kept changing during publish (${maxAttempts} tries) — try again in a moment.`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof GitPublishError) return await failWith(502, error.code, error.message);
      return await failWith(500, "internal_error", "Publishing failed.");
    }
  };

  // ---------------------------------------------------------------- router

  const routes: Array<{ pattern: RegExp; methods: Record<string, (request: Request, user: Identity, match: RegExpMatchArray) => Promise<Response>> }> = [
    { pattern: /^\/content$/, methods: { GET: (_request, user) => listContent(user) } },
    { pattern: /^\/live-version$/, methods: { GET: async () => json({ liveVersion: await getLiveVersion(), branch: config.repo.branch }) } },
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
