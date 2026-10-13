/**
 * P12c / M12: Version history, as in the Mr Spa CMS — a dialog over the editor (every role; the top bar's clock icon):
 * "Published versions for this resource. Choosing Restore creates a draft only.", the last 10 versions read from the
 * site's git history (CMS publishes and edits made in the code), each with its date, "by …", what restoring it would
 * change ("Changed: Banner › Heading · Added: …") and "Restore as draft". Restoring makes it my draft — it goes live
 * only when published; it asks first only when I already have a draft ("Replace current draft").
 */
import type { Field } from "../config/index.js";
import { summarizeChanges, type Change } from "./changes.js";
import { openDialog } from "./dialog.js";
import { clear, h } from "./dom.js";
import type { ScreenKit } from "./people.js";

export type HistoryVersion = { commit: string; date: string; title: string; who: string | null; viaCms: boolean; removed: boolean; content?: Record<string, unknown> | null };
type HistoryView = { resource: string; label: string; versions: HistoryVersion[]; live?: Record<string, unknown> | null };
export type HistoryTarget = { label: string; fields: Record<string, Field>; href: string };

/** The Mr Spa CMS's summary line: "Changed: Banner › Heading · Added: Gallery" (each place once, at most 20). */
export const historySummary = (changes: Change[]) => [...new Set(changes.map((change) => `${change.kind === "added" || change.kind === "created" ? "Added" : change.kind === "removed" ? "Removed" : "Changed"}: ${change.label}`))].slice(0, 20).join(" · ");

/** Open the Version history dialog of one resource; `restored` runs after a version became my draft. */
export const openHistory = (kit: ScreenKit, resource: string, target: HistoryTarget, restored: () => void) => {
  const { doc, api } = kit;
  const status = h(doc, "p", { class: "vc-history-status", role: "status", "aria-live": "polite" });
  const list = h(doc, "div", { class: "vc-history-list" });
  const dialog = openDialog(doc, {
    title: "Version history", text: "Published versions for this resource. Choosing Restore creates a draft only.",
    body: [status, list], buttons: [{ label: "Close", value: "close" }], dismiss: "close",
  });
  dialog.element.classList.add("vc-history-dialog");

  const restore = async (version: HistoryVersion, button: HTMLButtonElement) => {
    dialog.busy(true); button.disabled = true;
    status.textContent = "Creating restore draft…";
    let done = await api.post<{ resource: string }>("/api/cms/history/restore", { resource, commit: version.commit });
    if (!done.ok && done.error === "draft_exists") {
      if (!(await kit.ask("Replace current draft\n\nThis resource already has a draft. Replace it with this historical version?", { confirm: "Replace draft" }))) {
        status.textContent = "Restore cancelled.";
        dialog.busy(false); button.disabled = false;
        return;
      }
      done = await api.post<{ resource: string }>("/api/cms/history/restore", { resource, commit: version.commit, replace: true });
    }
    dialog.busy(false); button.disabled = false;
    if (!done.ok) { status.textContent = done.message || "Unable to create the restore draft."; return; }
    dialog.close("close");
    restored();
  };

  const load = async () => {
    status.textContent = "Loading published versions…";
    clear(list);
    const result = await api.get<HistoryView>(`/api/cms/history?resource=${encodeURIComponent(resource)}&limit=10&contents=1`);
    if (!result.ok) { status.textContent = result.message || "Unable to load version history."; return; }
    const { versions, live } = result.data;
    status.textContent = `${versions.length} published ${versions.length === 1 ? "version" : "versions"}.`;
    if (!versions.length) { list.append(h(doc, "p", { class: "vc-note" }, "No published versions found for this resource.")); return; }
    for (const version of versions) {
      const date = new Date(version.date);
      const gone = version.removed || version.content === null || version.content === undefined;
      const changes = gone ? [] : summarizeChanges({ fields: target.fields, before: live ?? undefined, after: version.content! });
      const text = gone ? "This version is unavailable." : changes.length ? historySummary(changes) : "Nothing is different from what the website shows now.";
      const button = gone ? null : h(doc, "button", { type: "button", class: "vc-button" }, "Restore as draft");
      button?.addEventListener("click", () => { void restore(version, button); });
      list.append(h(doc, "article", { class: "vc-history-entry", "data-commit": version.commit },
        h(doc, "div", { class: "vc-history-entry-head" },
          h(doc, "strong", {}, Number.isNaN(date.getTime()) ? "Published version" : date.toLocaleString()),
          h(doc, "span", {}, `by ${version.who || "unknown actor"}`)),
        h(doc, "p", {}, text),
        h(doc, "div", { class: "vc-history-entry-actions" }, button, h(doc, "code", { title: version.commit }, version.commit.slice(0, 8)))));
    }
  };
  void load();
  return dialog;
};
