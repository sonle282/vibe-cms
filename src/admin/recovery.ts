/**
 * M6: a copy of unsaved edits in this browser, as in the Mr Spa CMS — so a refresh, a crash or a closed tab does not
 * lose them. It is not a save: it is written 400 ms after the last edit (and at once when the page goes away), removed
 * as soon as the record has no unsaved changes (Save draft, Discard, Publish, leaving with Discard changes), on sign-out,
 * and it expires after 24 hours. When the record is opened again on the same version of the website, the editor asks
 * "Restore unsaved changes?".
 */

export const RECOVERY_PREFIX = "vibe-cms:unsaved:v1:";
export const RECOVERY_MAX_AGE = 24 * 60 * 60 * 1000;
export const RECOVERY_DELAY = 400;

export type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;
export type RecoverySnapshot = { savedAt: number; user: string | null; version: string; content: unknown };

const keyOf = (resource: string) => `${RECOVERY_PREFIX}${resource}`;

/** The copy of a record's unsaved edits, or null (none, unreadable, or older than 24 hours). */
export const readRecovery = (storage: RecoveryStorage | null | undefined, resource: string, now: number): RecoverySnapshot | null => {
  try {
    const raw = storage?.getItem(keyOf(resource));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as RecoverySnapshot;
    if (!snapshot || typeof snapshot.savedAt !== "number" || typeof snapshot.version !== "string" || now - snapshot.savedAt > RECOVERY_MAX_AGE) return null;
    return snapshot;
  } catch { return null; }
};
export const forgetRecovery = (storage: RecoveryStorage | null | undefined, resource: string) => { try { storage?.removeItem(keyOf(resource)); } catch { /* blocked storage */ } };
/** Sign-out: every copy goes. */
export const forgetAllRecovery = (storage: RecoveryStorage | null | undefined) => {
  try {
    if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key?.startsWith(RECOVERY_PREFIX)) keys.push(key); }
    for (const key of keys) storage.removeItem(key);
  } catch { /* blocked storage */ }
};

/** "3 minutes ago", "about 2 hours ago" (the Mr Spa CMS's words). */
export const recoveryWhen = (savedAt: number, now: number) => {
  const minutes = Math.max(1, Math.round((now - savedAt) / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
};
/** The question when a copy is found: title, then the text (the Mr Spa CMS's). */
export const recoveryQuestion = (noun: string, savedAt: number, now: number) =>
  `Restore unsaved changes?\n\nYou were editing this ${noun} ${recoveryWhen(savedAt, now)} and those changes were not saved (for example the page was refreshed or the tab was closed). Restore them? They come back as unsaved changes; press Save draft to keep them.`;

export type Recovery = { sync(dirty: boolean): void; flush(): void; stop(): void };
/**
 * The copy for one open record: `sync` after every change (written 400 ms later while there are unsaved edits, removed
 * at once when there are none); `flush` writes a pending copy now (the page is going away).
 */
export const createRecovery = (options: { storage: RecoveryStorage | null | undefined; resource: string; user: string; version: () => string; content: () => unknown; dirty: () => boolean; now: () => number; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (timer: unknown) => void }): Recovery => {
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let paused = false;
  const write = () => {
    timer = undefined;
    if (paused || !options.dirty()) return;
    try { options.storage?.setItem(keyOf(options.resource), JSON.stringify({ savedAt: options.now(), user: options.user, version: options.version(), content: options.content() } satisfies RecoverySnapshot)); } catch { /* quota / blocked: just not kept */ }
  };
  return {
    sync: (dirty) => {
      if (paused) return;
      if (timer !== undefined) { clearTimer(timer); timer = undefined; }
      if (dirty) timer = setTimer(write, RECOVERY_DELAY);
      else forgetRecovery(options.storage, options.resource);
    },
    flush: () => { if (timer !== undefined) { clearTimer(timer); write(); } },
    stop: () => { paused = true; if (timer !== undefined) { clearTimer(timer); timer = undefined; } },
  };
};
