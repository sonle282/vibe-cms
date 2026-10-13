/**
 * P12b / M12: Activity (admins only), as in the Mr Spa CMS — the last 100 events in plain words, newest first: Date ·
 * Person · What happened · Change (the commit) · Result (Done / Failed); filters All · Publishing · Sign-ins · Failed;
 * "From the last N events." + Refresh. The server decides (GET /api/cms/activity answers 403 to editors).
 */
import { clear, h } from "./dom.js";
import { peopleTabs, shortDate, type ScreenKit } from "./people.js";

export type ActivityEntry = {
  id: number; at: string; userId: string; who: string | null; role: "owner" | "editor" | "anonymous";
  action: string; stage: "draft" | "publish" | "auth" | "people"; resource: string; what: string; detail: Record<string, unknown>;
};
type ActivityPage = { kind: string; entries: ActivityEntry[]; next: number | null };

export const ACTIVITY_FILTERS: Array<[string, string]> = [["all", "All"], ["publish", "Publishing"], ["signin", "Sign-ins"], ["failed", "Failed"]];

const fieldsOf = (detail: Record<string, unknown>) => (Array.isArray(detail.fields) ? detail.fields : []).map((entry) => (entry && typeof entry === "object" ? String((entry as { field?: unknown }).field ?? "") : "")).filter(Boolean);

/** One row in words: "Published Salon info", "Refused: Price (admin only) in Service · nail-art". */
export const describeActivity = (entry: ActivityEntry): { text: string; tone: "ok" | "bad" | "plain" } => {
  const { action, what, detail, stage } = entry;
  const short = typeof detail.commitSha === "string" ? ` (${detail.commitSha.slice(0, 7)})` : "";
  switch (action) {
    case "succeeded": return { text: detail.commitSha === null ? `Published ${what} — nothing had changed` : `Published ${what}`, tone: "ok" };
    case "failed": return { text: `Publishing ${what} failed`, tone: "bad" };
    case "denied": {
      const verb = stage === "publish" ? "publish" : "save";
      if (detail.reason === "owner_only") return { text: `Refused to ${verb} ${what}: only admins can change it`, tone: "bad" };
      const fields = fieldsOf(detail);
      return { text: `Refused to ${verb} ${what}: ${fields.length ? fields.join(", ") : "admin-only fields"} ${fields.length === 1 ? "is" : "are"} for admins only`, tone: "bad" };
    }
    case "login": return { text: "Signed in", tone: "plain" };
    case "login_failed": return { text: "Sign-in failed", tone: "bad" };
    case "logout": return { text: "Signed out", tone: "plain" };
    case "password_change": return { text: "Changed their password", tone: "plain" };
    case "bootstrap": return { text: "Created the first admin", tone: "ok" };
    case "user_create": return { text: `Added ${what}`, tone: "plain" };
    case "user_disable": return { text: `Turned off ${what}`, tone: "plain" };
    case "user_enable": return { text: `Turned on ${what}`, tone: "plain" };
    case "user_password_reset": return { text: `Reset the password of ${what}${detail.by === "cli" ? " (from the command line)" : ""}`, tone: "plain" };
    case "user_role_change": return { text: `Changed the role of ${what}${typeof detail.to === "string" ? ` to ${detail.to}` : ""}`, tone: "plain" };
    default: return { text: `${action.replace(/_/g, " ")} — ${what}`, tone: "plain" };
  }
};

/** The Mr Spa CMS's Activity: the last 100 events, filtered in the page. */
export const activityScreen = async (kit: ScreenKit, stillHere: () => boolean, kind = "all") => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["People & activity"]];
  if (user.role !== "owner") return kit.show({ title: "People & activity", crumbs }, kit.message("Activity", "Only an admin can see the activity log."));
  let filter = ACTIVITY_FILTERS.some(([key]) => key === kind) ? kind : "all";
  const status = h(doc, "span", { class: "vc-users-status", role: "status", "aria-live": "polite" });
  const refresh = h(doc, "button", { type: "button", class: "vc-button" }, "Refresh");
  const filters = h(doc, "div", { class: "vc-activity-filters", role: "group", "aria-label": "Show" },
    ...ACTIVITY_FILTERS.map(([key, label]) => h(doc, "button", { type: "button", class: "vc-activity-filter", "data-activity-filter": key, "aria-pressed": String(key === filter), onclick: () => { filter = key; void load(); } }, label)));
  const tbody = h(doc, "tbody");
  const load = async () => {
    for (const button of filters.querySelectorAll<HTMLElement>("button")) button.setAttribute("aria-pressed", String(button.dataset.activityFilter === filter));
    status.textContent = "Loading…"; status.dataset.state = "idle"; refresh.disabled = true;
    const page = await api.get<ActivityPage>(`/api/cms/activity?kind=${encodeURIComponent(filter)}&limit=100`);
    refresh.disabled = false;
    if (!stillHere()) return;
    if (!page.ok) { status.textContent = page.message || "Unable to load audit log."; status.dataset.state = "error"; return; }
    clear(tbody);
    for (const entry of page.data.entries) {
      const { text, tone } = describeActivity(entry);
      const sha = typeof entry.detail.commitSha === "string" ? entry.detail.commitSha : "";
      tbody.append(h(doc, "tr", { "data-id": String(entry.id) },
        h(doc, "td", { title: new Date(entry.at).toLocaleString() }, shortDate(entry.at)),
        h(doc, "td", {}, entry.who ?? "—"),
        h(doc, "td", { class: "vc-activity-what" }, text),
        h(doc, "td", {}, sha ? h(doc, "code", { class: "vc-activity-commit", title: sha }, sha.slice(0, 7)) : "—"),
        h(doc, "td", {}, h(doc, "span", { class: `vc-content-status vc-activity-result${tone === "bad" ? " is-failed" : ""}` }, tone === "bad" ? "Failed" : "Done"))));
    }
    if (!page.data.entries.length) tbody.append(h(doc, "tr", {}, h(doc, "td", { colspan: "5", class: "vc-activity-empty" }, "Nothing to show here yet.")));
    const count = page.data.entries.length;
    status.textContent = `From the last ${count} ${count === 1 ? "event" : "events"}.`;
  };
  refresh.addEventListener("click", () => { void load(); });
  const title = kit.heading("Activity");
  title.classList.add("vc-sr-only");
  kit.show({ title: "People & activity", crumbs }, [
    title,
    h(doc, "div", { class: "vc-activity-view" },
      peopleTabs(doc, "activity"),
      h(doc, "div", { class: "vc-activity-toolbar" }, filters, status, refresh),
      h(doc, "div", { class: "vc-workspace-card" },
        h(doc, "table", { class: "vc-users-table" }, h(doc, "thead", {}, h(doc, "tr", {}, ...["Date", "Person", "What happened", "Change", "Result"].map((text) => h(doc, "th", { scope: "col" }, text)))), tbody))),
  ]);
  await load();
};
