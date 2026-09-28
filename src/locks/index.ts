/**
 * P4: fields locked for the owner, checked on the server. `checkLocks` is pure: (config, role, before, after) → the
 * violations, each with the field's path and label ("Only the owner can change Price"). `enforceLocks` records an audit
 * "denied" row and throws LockedFieldError (HTTP 403) — used when a draft is saved AND again at publish, because the
 * role can change in between. Values are never written to the audit, only paths and labels.
 *
 * Rules for an editor (the owner may do anything):
 * 1. A field with locked: "owner" keeps its value — at any depth (object, list, collection item). A locked object or list
 *    is locked as a whole. Empty values ("", null, missing, [], {}) count as the same value.
 * 2. A new item (collection record or list entry) may be added when every locked field in it is empty.
 * 3. Items may be re-ordered: collection records are matched by their id, list entries by "id" when they have one,
 *    otherwise by equal content, then by position.
 * 4. An item whose locked fields hold a value may not be removed.
 */
import type { CmsCollection, CmsConfig, Field } from "../config/index.js";
import { isRecord, pathStep, toTree, type FieldTree } from "../config/tree.js";
import { parseResourceId, type DraftStore, type SaveDraft } from "../store/index.js";
import { sameValue } from "../writer/json.js";

export type Role = "owner" | "editor";
export type LockReason = "changed" | "added" | "removed";
export type LockViolation = {
  /** Where in the content: "price", "groups[0].items[1].price", "address". */
  path: string;
  /** The field's labels from the top: "Groups › Items › Price". */
  field: string;
  /** The locked field's own label: "Price". */
  label: string;
  reason: LockReason;
  message: string;
};
export type LockTarget =
  | { kind: "file"; key: string }
  | { kind: "item"; key: string }
  | { kind: "collection"; key: string };

/** "", null, undefined, [], {} and containers of only those. */
export const isBlank = (value: unknown): boolean => {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.every(isBlank);
  if (isRecord(value)) return Object.values(value).every(isBlank);
  return false;
};
const sameLocked = (a: unknown, b: unknown) => (isBlank(a) && isBlank(b)) || sameValue(a, b);

const hasLocks = (field: Field): boolean =>
  field.locked === "owner" || (field.type === "object" && Object.values(field.fields).some(hasLocks)) || (field.type === "list" && hasLocks(field.of));
const treeHasLocks = (tree: FieldTree): boolean => [...tree.values()].some((node) => (node instanceof Map ? treeHasLocks(node) : hasLocks(node)));

type Found = { path: string; labels: string[]; label: string };
/** "a Service", "an Item". */
const article = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
type Ctx = { violations: LockViolation[]; thing: string };

const violation = (ctx: Ctx, found: Found, reason: LockReason, thing = ctx.thing) => {
  const field = found.labels.join(" › ");
  const message = reason === "changed" ? `Only the owner can change ${field}`
    : reason === "added" ? `Only the owner can add ${thing} with ${field} filled in — leave ${found.label} empty for the owner`
    : `Only the owner can remove ${thing} that has ${field}`;
  ctx.violations.push({ path: found.path, field, label: found.label, reason, message });
};

/** Locked fields inside `value` that hold something. */
const filledField = (field: Field, value: unknown, path: string, labels: string[], out: Found[]) => {
  if (field.locked === "owner") { if (!isBlank(value)) out.push({ path, labels, label: field.label }); return; }
  if (field.type === "object" && isRecord(value)) filledTree(toTree(field.fields), value, path, labels, out);
  if (field.type === "list" && Array.isArray(value)) value.forEach((item, index) => filledField(field.of, item, `${path}[${index}]`, labels, out));
};
const collect = (field: Field, value: unknown, path: string, labels: string[]) => { const out: Found[] = []; filledField(field, value, path, labels, out); return out; };
const filledTree = (tree: FieldTree, value: Record<string, unknown> | undefined, path: string, labels: string[], out: Found[]) => {
  for (const [key, node] of tree) {
    const child = value?.[key];
    if (node instanceof Map) filledTree(node, isRecord(child) ? child : undefined, pathStep(path, key), labels, out);
    else filledField(node, child, pathStep(path, key), [...labels, node.label], out);
  }
  return out;
};

const compareTree = (ctx: Ctx, tree: FieldTree, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, path: string, labels: string[]) => {
  for (const [key, node] of tree) {
    const b = before?.[key]; const a = after?.[key];
    if (node instanceof Map) { if (treeHasLocks(node)) compareTree(ctx, node, isRecord(b) ? b : undefined, isRecord(a) ? a : undefined, pathStep(path, key), labels); }
    else compareField(ctx, node, b, a, pathStep(path, key), [...labels, node.label]);
  }
};

const compareField = (ctx: Ctx, field: Field, before: unknown, after: unknown, path: string, labels: string[]) => {
  if (field.locked === "owner") { if (!sameLocked(before, after)) violation(ctx, { path, labels, label: field.label }, "changed"); return; }
  if (!hasLocks(field)) return;
  if (field.type === "object") compareTree(ctx, toTree(field.fields), isRecord(before) ? before : undefined, isRecord(after) ? after : undefined, path, labels);
  else if (field.type === "list") compareList(ctx, field.of, Array.isArray(before) ? before : [], Array.isArray(after) ? after : [], path, labels, field.itemLabel ? article(field.itemLabel) : `an item of ${field.label}`);
};

/** Pair list entries (rule 3), then compare pairs, check new entries (rule 2) and removed ones (rule 4). */
const compareList = (ctx: Ctx, of: Field, before: unknown[], after: unknown[], path: string, labels: string[], thing: string) => {
  const pairOf = new Array<number | undefined>(after.length);
  const used = new Set<number>();
  const idOf = (item: unknown) => (isRecord(item) && typeof item.id === "string" && item.id ? item.id : undefined);
  // 1. same "id"
  after.forEach((item, index) => {
    const id = idOf(item);
    if (id === undefined) return;
    const found = before.findIndex((old, oldIndex) => !used.has(oldIndex) && idOf(old) === id);
    if (found >= 0) { pairOf[index] = found; used.add(found); }
  });
  // 2. equal content (a moved entry)
  after.forEach((item, index) => {
    if (pairOf[index] !== undefined || idOf(item) !== undefined) return;
    const found = before.findIndex((old, oldIndex) => !used.has(oldIndex) && idOf(old) === undefined && sameValue(old, item));
    if (found >= 0) { pairOf[index] = found; used.add(found); }
  });
  // 3. same position
  after.forEach((item, index) => {
    if (pairOf[index] !== undefined || idOf(item) !== undefined) return;
    if (index < before.length && !used.has(index) && idOf(before[index]) === undefined) { pairOf[index] = index; used.add(index); }
  });
  after.forEach((item, index) => {
    const at = `${path}[${index}]`;
    if (pairOf[index] !== undefined) compareField(ctx, of, before[pairOf[index]!], item, at, labels);
    else for (const found of collect(of, item, at, labels)) violation(ctx, found, "added", thing);
  });
  before.forEach((item, index) => {
    if (used.has(index)) return;
    for (const found of collect(of, item, `${path}[${index}]`, labels)) violation(ctx, found, "removed", thing);
  });
};

const collectionOf = (config: CmsConfig, key: string): CmsCollection => {
  const found = config.collections.find((entry) => entry.key === key);
  if (!found) throw new RangeError(`no collection "${key}"`);
  return found;
};
const idFieldOf = (collection: CmsCollection) => (collection.store.kind === "json-array" ? collection.store.idField : collection.store.slugField);

/** One collection record: before undefined = new record, after undefined = removed record. */
const compareRecord = (ctx: Ctx, tree: FieldTree, before: unknown, after: unknown, path: string) => {
  const b = isRecord(before) ? before : undefined; const a = isRecord(after) ? after : undefined;
  if (!b && a) for (const found of filledTree(tree, a, path, [], [])) violation(ctx, found, "added");
  else if (b && !a) for (const found of filledTree(tree, b, path, [], [])) violation(ctx, found, "removed");
  else if (b && a) compareTree(ctx, tree, b, a, path, []);
};

export type CheckLocksInput = { config: CmsConfig; role: Role; target: LockTarget; before: unknown; after: unknown };

/** The editor rules above. Owner → always []. */
export const checkLocks = ({ config, role, target, before, after }: CheckLocksInput): LockViolation[] => {
  if (role === "owner") return [];
  if (target.kind === "file") {
    const file = config.files.find((entry) => entry.key === target.key);
    if (!file) throw new RangeError(`no file "${target.key}"`);
    const ctx: Ctx = { violations: [], thing: "this" };
    compareTree(ctx, toTree(file.fields), isRecord(before) ? before : undefined, isRecord(after) ? after : undefined, "", []);
    return ctx.violations;
  }
  const collection = collectionOf(config, target.key);
  const tree = toTree(collection.fields);
  const ctx: Ctx = { violations: [], thing: article(collection.itemLabel) };
  if (target.kind === "item") { compareRecord(ctx, tree, before, after, ""); return ctx.violations; }
  // Whole collection (e.g. re-order, or several records at once): records matched by id, never by position.
  const idField = idFieldOf(collection);
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  const byId = (items: Record<string, unknown>[]) => new Map(items.map((item) => [String(item[idField]), item]));
  const old = byId(list(before)); const next = byId(list(after));
  for (const [id, item] of next) compareRecord(ctx, tree, old.get(id), item, `[${JSON.stringify(id)}]`);
  for (const [id, item] of old) if (!next.has(id)) compareRecord(ctx, tree, item, undefined, `[${JSON.stringify(id)}]`);
  return ctx.violations;
};

// ---------------------------------------------------------------- enforcement + audit

export type AuditEntry = {
  at: string;
  userId: string;
  /** "anonymous" only for a failed sign-in with an unknown username. */
  role: Role | "anonymous";
  action: "started" | "succeeded" | "failed" | "denied"
    | "login" | "login_failed" | "logout" | "password_change" | "bootstrap"
    | "user_create" | "user_disable" | "user_enable" | "user_password_reset" | "user_role_change";
  stage: "draft" | "publish" | "auth" | "people";
  resource: string;
  /** JSON-able detail. Never content values — only paths, labels, reasons, ids. */
  detail: Record<string, unknown>;
};
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  /** Newest first. */
  list(options?: { resource?: string; limit?: number }): Promise<Array<AuditEntry & { id: number }>>;
}

export class LockedFieldError extends Error {
  readonly status = 403;
  constructor(public readonly violations: LockViolation[], public readonly stage: "draft" | "publish") {
    super(violations.map((entry) => entry.message).join("; "));
    this.name = "LockedFieldError";
  }
}

/** The 403 body the API returns: which fields, why — no values. */
export const lockedFieldBody = (error: LockedFieldError) => ({
  error: "locked_field",
  message: error.message,
  fields: error.violations.map(({ path, field, label, reason, message }) => ({ path, field, label, reason, message })),
});
export const lockedFieldResponse = (error: LockedFieldError) =>
  new Response(JSON.stringify(lockedFieldBody(error)), { status: 403, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export type EnforceInput = CheckLocksInput & { userId: string; resource: string; stage: "draft" | "publish"; audit: AuditLog; now?: () => string };

/** Check; on a violation write one audit "denied" row and throw LockedFieldError. */
export const enforceLocks = async ({ audit, userId, resource, stage, now = () => new Date().toISOString(), ...input }: EnforceInput) => {
  const violations = checkLocks(input);
  if (!violations.length) return;
  await audit.record({ at: now(), userId, role: input.role, action: "denied", stage, resource, detail: { reason: "locked_field", fields: violations.map(({ path, field, reason }) => ({ path, field, reason })) } });
  throw new LockedFieldError(violations, stage);
};

/** The lock target for a draft resource id ("file:site" / "item:services:<id>"). */
export const targetOf = (resource: { kind: "file" | "item"; key: string }): LockTarget => ({ kind: resource.kind, key: resource.key });

// ---------------------------------------------------------------- the two places the rules apply

/**
 * Save a draft only when the user may make this change (P5's PUT calls this). `source` = the resource's current value
 * (file content, collection record, or undefined for a new record). A refused draft is not written.
 */
export const saveDraftChecked = async ({ config, role, drafts, audit, source, input, now }: {
  config: CmsConfig; role: Role; drafts: DraftStore; audit: AuditLog; source: unknown; input: SaveDraft; now?: () => string;
}) => {
  const resource = parseResourceId(input.resource);
  await enforceLocks({ config, role, target: targetOf(resource), before: source, after: input.content, userId: input.userId, resource: input.resource, stage: "draft", audit, ...(now ? { now } : {}) });
  return drafts.save(input);
};

/**
 * Before publishing (P5 / P8): check again with the role the user has NOW — it may have changed since the draft was
 * saved. `after` undefined = the record is being removed.
 */
export const checkPublishLocks = ({ config, role, userId, audit, resource, before, after, now }: {
  config: CmsConfig; role: Role; userId: string; audit: AuditLog; resource: string; before: unknown; after: unknown; now?: () => string;
}) => enforceLocks({ config, role, target: targetOf(parseResourceId(resource)), before, after, userId, resource, stage: "publish", audit, ...(now ? { now } : {}) });
