/**
 * M1: the one save state of the open record, as in the Mr Spa CMS (its save-state.ts): the top bar's dot + text, Save
 * draft and Publish all read `deriveSaveState`, so they never disagree. Nothing here reads the DOM.
 */

export type SaveStateKind = "none" | "unsaved" | "saved" | "published" | "busy" | "problem";
/** After a Publish: the website is building, it serves the change, or it has not after the wait. */
export type PublishedState = "publishing" | "live" | "waiting";

export type SaveStateInput = {
  /** How many fields differ from the saved version (0 = none; null = something differs that cannot be counted). */
  unsaved: number | null;
  hasDraft: boolean;
  /** Save is possible at all: loaded, no conflict, nothing else running. */
  canSave: boolean;
  /** Why Publish is blocked, or null. */
  publishBlockReason: string | null;
  busy?: string;
  problem?: string;
  published?: PublishedState;
  /** The record is on the website now: a saved draft says only the changes are not live. */
  recordLive?: boolean;
  host: string;
};

export type SaveState = {
  kind: SaveStateKind;
  label: string;
  /** Only when the top bar is too narrow for `label` (shortened, never cut). */
  shortLabel: string;
  saveEnabled: boolean;
  publishEnabled: boolean;
  publishTooltip: string;
};

export const SAVE_FIRST = "Save a draft first";
export const PUBLISHING_LABEL = "Publishing… this usually takes a few minutes";
export const STILL_PUBLISHING_LABEL = "Still publishing — check again in a few minutes";
export const DRAFT_SAVED_LABEL = "Draft saved · not live yet";
export const DRAFT_SAVED_LIVE_LABEL = "Draft saved · changes not live yet";
export const NO_CHANGES_LABEL = "No changes";

export const unsavedLabel = (count: number | null) => (count === null || count < 1 ? "Unsaved changes" : count === 1 ? "1 unsaved change" : `${count} unsaved changes`);
export const unsavedShortLabel = (count: number | null) => (count === null || count < 1 ? "Unsaved" : `${count} unsaved`);
const publishedLabel = (state: PublishedState, host: string) => (state === "live" ? `Live on ${host}` : state === "waiting" ? STILL_PUBLISHING_LABEL : PUBLISHING_LABEL);
const publishedShortLabel = (state: PublishedState) => (state === "live" ? "Live" : state === "waiting" ? "Still publishing" : "Publishing…");

export const deriveSaveState = (input: SaveStateInput): SaveState => {
  const dirty = input.unsaved === null || input.unsaved > 0;
  const kind: SaveStateKind = input.problem ? "problem" : input.busy ? "busy" : dirty ? "unsaved" : input.published ? "published" : input.hasDraft ? "saved" : "none";
  const label = kind === "problem" ? input.problem!
    : kind === "busy" ? input.busy!
      : kind === "unsaved" ? unsavedLabel(input.unsaved)
        : kind === "published" ? publishedLabel(input.published!, input.host)
          : kind === "saved" ? (input.recordLive ? DRAFT_SAVED_LIVE_LABEL : DRAFT_SAVED_LABEL)
            : NO_CHANGES_LABEL;
  const shortLabel = kind === "unsaved" ? unsavedShortLabel(input.unsaved) : kind === "saved" ? "Draft saved" : kind === "published" ? publishedShortLabel(input.published!) : kind === "problem" ? "Needs attention" : label;
  return {
    kind, label, shortLabel,
    // A problem while there are unsaved edits keeps Save available (e.g. try again after a failed save).
    saveEnabled: input.canSave && dirty && kind !== "busy",
    publishEnabled: !dirty && !input.busy && input.hasDraft && input.publishBlockReason === null,
    publishTooltip: dirty ? SAVE_FIRST : input.publishBlockReason ?? "Review changes before publishing.",
  };
};

/**
 * Why Publish is blocked, in the Mr Spa CMS's words and order (the checks a site's own plugin adds come later, M14).
 */
export const publishBlockReason = (facts: { conflict: boolean; dirty: boolean; hasDraft: boolean; invalid: boolean; changes: number }) => {
  if (facts.conflict) return "Someone else changed this content. Reload before publishing.";
  if (facts.dirty) return "Save your changes before publishing.";
  if (!facts.hasDraft) return "Save a draft before publishing.";
  if (facts.invalid) return "Fix the highlighted fields before publishing.";
  if (!facts.changes) return "No changes to publish yet.";
  return null;
};

/** The fields that differ, as leaf paths with my value, so "Reload and keep my changes" can put them back. */
export type LeafChange = { path: string[]; value: unknown };
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const unsavedLeafChanges = (saved: unknown, current: unknown, prefix: string[] = []): LeafChange[] => {
  if (isPlainObject(saved) && isPlainObject(current)) {
    const keys = [...new Set([...Object.keys(saved), ...Object.keys(current)])];
    return keys.flatMap((key) => unsavedLeafChanges(saved[key], current[key], [...prefix, key]));
  }
  return JSON.stringify(saved) === JSON.stringify(current) ? [] : [{ path: prefix, value: current }];
};
/** Put leaf changes on a copy of `base` (an undefined value removes the field). Arrays count as one value. */
export const applyLeafChanges = <T>(base: T, changes: readonly LeafChange[]): T => {
  const copy = structuredClone(base) as unknown;
  if (!isPlainObject(copy)) return copy as T;
  for (const { path, value } of changes) {
    if (!path.length) continue;
    const parents = path.slice(0, -1);
    const leaf = path[path.length - 1];
    let target: Record<string, unknown> = copy;
    for (const key of parents) { if (!isPlainObject(target[key])) target[key] = {}; target = target[key] as Record<string, unknown>; }
    if (value === undefined) delete target[leaf]; else target[leaf] = structuredClone(value);
  }
  return copy as T;
};
