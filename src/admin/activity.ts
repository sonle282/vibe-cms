/**
 * P12b: Activity (owners only) — the audit log in plain words, newest first, 50 at a time: who published what, who
 * signed in, people changes, and what was refused (owner-only fields, owner-only sections, failed sign-ins). Filters:
 * All · Publishing · Sign-ins · People · Refused. The server decides (GET /api/cms/activity answers 403 to editors).
 */
import { clear, h } from "./dom.js";
import type { ScreenKit } from "./people.js";

export type ActivityEntry = {
  id: number; at: string; userId: string; who: string | null; role: "owner" | "editor" | "anonymous";
  action: string; stage: "draft" | "publish" | "auth" | "people"; resource: string; what: string; detail: Record<string, unknown>;
};
type ActivityPage = { kind: string; entries: ActivityEntry[]; next: number | null };

export const ACTIVITY_FILTERS: Array<[string, string]> = [["all", "All"], ["publish", "Publishing"], ["signin", "Sign-ins"], ["people", "People"], ["denied", "Refused"]];

const fieldsOf = (detail: Record<string, unknown>) => (Array.isArray(detail.fields) ? detail.fields : []).map((entry) => (entry && typeof entry === "object" ? String((entry as { field?: unknown }).field ?? "") : "")).filter(Boolean);

/** One row in words: "Published Salon info", "Refused: Price (owner only) in Service · nail-art". */
export const describeActivity = (entry: ActivityEntry): { text: string; tone: "ok" | "bad" | "plain" } => {
  const { action, what, detail, stage } = entry;
  const short = typeof detail.commitSha === "string" ? ` (${detail.commitSha.slice(0, 7)})` : "";
  switch (action) {
    case "succeeded": return { text: detail.commitSha === null ? `Published ${what} — nothing had changed` : `Published ${what}${short}`, tone: "ok" };
    case "failed": return { text: `Publishing ${what} failed${typeof detail.code === "string" ? ` (${detail.code.replace(/_/g, " ")})` : ""}`, tone: "bad" };
    case "denied": {
      const verb = stage === "publish" ? "publish" : "save";
      if (detail.reason === "owner_only") return { text: `Refused to ${verb} ${what}: only owners can change it`, tone: "bad" };
      const fields = fieldsOf(detail);
      return { text: `Refused to ${verb} ${what}: ${fields.length ? fields.join(", ") : "owner-only fields"} ${fields.length === 1 ? "is" : "are"} for owners only`, tone: "bad" };
    }
    case "login": return { text: "Signed in", tone: "plain" };
    case "login_failed": return { text: `Failed sign-in (${detail.reason === "disabled" ? "account disabled" : detail.reason === "unknown_user" ? "unknown username" : "wrong password"})`, tone: "bad" };
    case "logout": return { text: "Signed out", tone: "plain" };
    case "password_change": return { text: "Changed their password", tone: "plain" };
    case "bootstrap": return { text: "Created the first owner", tone: "ok" };
    case "user_create": return { text: `Added ${what}`, tone: "plain" };
    case "user_disable": return { text: `Disabled ${what}`, tone: "plain" };
    case "user_enable": return { text: `Enabled ${what}`, tone: "plain" };
    case "user_password_reset": return { text: `Reset the password of ${what}${detail.by === "cli" ? " (from the command line)" : ""}`, tone: "plain" };
    case "user_role_change": return { text: `Changed the role of ${what}${typeof detail.to === "string" ? ` to ${detail.to}` : ""}`, tone: "plain" };
    default: return { text: `${action.replace(/_/g, " ")} — ${what}`, tone: "plain" };
  }
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const activityScreen = async (kit: ScreenKit, stillHere: () => boolean, kind = "all") => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["Activity"]];
  if (user.role !== "owner") return kit.show({ title: "Activity", crumbs }, kit.message("Activity", "Only an owner can see the activity log."));
  const filter = ACTIVITY_FILTERS.some(([key]) => key === kind) ? kind : "all";
  const first = await api.get<ActivityPage>(`/api/cms/activity?kind=${encodeURIComponent(filter)}`);
  if (!stillHere()) return;
  if (!first.ok) return kit.failed(first, crumbs);

  const tabs = h(doc, "nav", { class: "vc-filters", "aria-label": "Show" }, ACTIVITY_FILTERS.map(([key, label]) =>
    h(doc, "a", { href: key === "all" ? "#/activity" : `#/activity/${key}`, class: "vc-filter", ...(key === filter ? { "aria-current": "page" } : {}) }, label)));
  const tbody = h(doc, "tbody");
  const more = h(doc, "button", { type: "button", class: "vc-button" }, "Show older");
  const error = h(doc, "p", { class: "vc-error", role: "alert" });
  let next = first.data.next;
  const add = (entries: ActivityEntry[]) => {
    for (const entry of entries) {
      const { text, tone } = describeActivity(entry);
      tbody.append(h(doc, "tr", { "data-id": String(entry.id) },
        h(doc, "td", { class: "vc-activity-when" }, h(doc, "time", { datetime: entry.at }, when(entry.at))),
        h(doc, "td", {}, entry.who ?? "—", entry.role !== "anonymous" ? h(doc, "span", { class: "vc-note" }, ` ${entry.role === "owner" ? "Owner" : "Editor"}`) : null),
        h(doc, "td", { class: `vc-activity-${tone}` }, text)));
    }
    more.hidden = next === null;
  };
  more.addEventListener("click", async () => {
    if (next === null) return;
    more.disabled = true; error.textContent = "";
    const page = await api.get<ActivityPage>(`/api/cms/activity?kind=${encodeURIComponent(filter)}&before=${next}`);
    more.disabled = false;
    if (!page.ok) { error.textContent = page.message; return; }
    next = page.data.next;
    add(page.data.entries);
    kit.say(`${page.data.entries.length} older entries shown.`);
  });
  clear(tbody);
  add(first.data.entries);
  const empty = first.data.entries.length ? null : h(doc, "p", { class: "vc-empty" }, filter === "all" ? "Nothing has happened yet." : "Nothing of this kind yet.");
  kit.show({ title: "Activity", crumbs }, [
    kit.heading("Activity"),
    h(doc, "p", { class: "vc-help" }, "Who published what, sign-ins, changes to people, and what the CMS refused. Contents are never shown here."),
    tabs,
    empty ?? h(doc, "table", { class: "vc-table vc-activity" }, h(doc, "thead", {}, h(doc, "tr", {}, h(doc, "th", { scope: "col" }, "When"), h(doc, "th", { scope: "col" }, "Who"), h(doc, "th", { scope: "col" }, "What"))), tbody),
    error, more,
  ]);
};
