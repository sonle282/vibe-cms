/**
 * P12c: History (owners) — the versions of one file / record, newest first, read from the site's git history: CMS
 * publishes (this package or an older CMS) and edits made in the code. "Compare" says in plain words what restoring
 * that version would change on the website; "Restore as draft" makes it my draft — it goes live only when published.
 */
import type { Field } from "../config/index.js";
import { describeChange, summarizeChanges } from "./changes.js";
import { clear, h } from "./dom.js";
import type { ScreenKit } from "./people.js";

export type HistoryVersion = { commit: string; date: string; title: string; who: string | null; viaCms: boolean; removed: boolean };
type HistoryView = { resource: string; label: string; versions: HistoryVersion[] };
type VersionView = { content: Record<string, unknown> | null; live: Record<string, unknown> | null; sameAsLive: boolean };
export type HistoryTarget = { label: string; fields: Record<string, Field>; href: string };

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const historyScreen = async (kit: ScreenKit, stillHere: () => boolean, resource: string, target: HistoryTarget | undefined, go: (hash: string) => void) => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["Overview", "#/"], ...(target ? [[target.label, target.href] as [string, string]] : []), ["History"]];
  if (user.role !== "owner") return kit.show({ title: "History", crumbs }, kit.message("History", "Only an owner can see the history and restore older versions."));
  if (!target) return kit.show({ title: "History", crumbs }, kit.message("Not found", "There is nothing with this address in the CMS."));
  const result = await api.get<HistoryView>(`/api/cms/history?resource=${encodeURIComponent(resource)}`);
  if (!stillHere()) return;
  if (!result.ok) return kit.failed(result, crumbs);

  const error = h(doc, "p", { class: "vc-error", role: "alert" });
  const restore = async (version: HistoryVersion, button: HTMLButtonElement) => {
    if (!kit.ask(`Restore the version of ${when(version.date)} as your draft?\n\nThe website does not change until you review and publish it.`)) return;
    error.textContent = "";
    button.disabled = true;
    let done = await api.post<{ resource: string }>("/api/cms/history/restore", { resource, commit: version.commit });
    if (!done.ok && done.error === "draft_exists" && kit.ask("You already have a draft of this. Replace it with the older version?")) done = await api.post<{ resource: string }>("/api/cms/history/restore", { resource, commit: version.commit, replace: true });
    button.disabled = false;
    if (!done.ok) { if (done.error !== "draft_exists") error.textContent = done.message; return; }
    kit.say(`The version of ${when(version.date)} is now your draft. Review it, then publish.`);
    go(target.href);
  };

  const rows = result.data.versions.map((version, index) => {
    const details = h(doc, "div", { class: "vc-history-changes", hidden: true });
    const compare = h(doc, "button", { type: "button", class: "vc-button vc-quiet", "aria-expanded": "false" }, "Compare");
    compare.addEventListener("click", async () => {
      if (!details.hidden) { details.hidden = true; compare.setAttribute("aria-expanded", "false"); return; }
      compare.disabled = true;
      const view = await api.get<VersionView>(`/api/cms/history/version?resource=${encodeURIComponent(resource)}&commit=${version.commit}`);
      compare.disabled = false;
      clear(details);
      if (!view.ok) details.append(h(doc, "p", { class: "vc-error" }, view.message));
      else if (view.data.content === null) details.append(h(doc, "p", {}, "It did not exist in this version."));
      else if (view.data.sameAsLive) details.append(h(doc, "p", {}, "This is what the website shows now."));
      else {
        const changes = summarizeChanges({ fields: target.fields, before: view.data.live ?? undefined, after: view.data.content });
        details.append(h(doc, "p", { class: "vc-help" }, "Restoring it would change:"), h(doc, "ul", { class: "vc-changes" }, changes.map((change) => h(doc, "li", {}, describeChange(change)))));
      }
      details.hidden = false;
      compare.setAttribute("aria-expanded", "true");
    });
    const restoreButton = h(doc, "button", { type: "button", class: "vc-button" }, "Restore as draft");
    restoreButton.addEventListener("click", () => restore(version, restoreButton));
    const source = version.viaCms ? "Published in the CMS" : "Changed in the website's code";
    return h(doc, "li", { class: "vc-history-item", "data-commit": version.commit },
      h(doc, "div", { class: "vc-history-head" },
        h(doc, "time", { datetime: version.date, class: "vc-activity-when" }, when(version.date)),
        h(doc, "span", {}, version.who ?? "—"),
        h(doc, "span", { class: "vc-note" }, `${source}${index === 0 ? " · newest" : ""}`),
        h(doc, "span", { class: "vc-history-actions" }, version.removed ? h(doc, "span", { class: "vc-note" }, "Removed here") : [compare, restoreButton])),
      h(doc, "p", { class: "vc-history-title vc-mono" }, `${version.commit.slice(0, 7)} · ${version.title}`),
      details);
  });
  kit.show({ title: `History · ${target.label}`, crumbs }, [
    kit.heading(`History · ${target.label}`),
    h(doc, "p", { class: "vc-help" }, "Every saved change of this on the website, newest first — from the CMS and from the website's code. Restoring an older version makes it your draft; nothing changes on the website until you publish it."),
    error,
    rows.length ? h(doc, "ol", { class: "vc-history" }, rows) : h(doc, "p", { class: "vc-empty" }, "No history yet."),
  ]);
};
