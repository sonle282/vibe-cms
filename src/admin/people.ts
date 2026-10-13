/**
 * P8b: People (admins only) and, M2, the Change password dialog of the Mr Spa CMS (from the account menu), on the P6
 * API. /admin/users: add a person (a temporary password is shown once), change role, disable / enable, reset a password.
 * The Admin role is stored as "owner" (its code since P6); every screen says Admin.
 * The server decides everything (owner only, never the last active owner, not yourself); the screen only explains.
 * Passwords stay in the page only until it is left: never in the URL, storage or logs; every form posts.
 */
import type { ApiFail, Client } from "./api.js";
import type { BootUser } from "./boot.js";
import { clear, h } from "./dom.js";
import { openDialog, type ConfirmOptions, type OpenDialog } from "./dialog.js";
import type { Tone, ToastAction } from "./toast.js";
import { adminHref } from "./routes.js";

type Role = "owner" | "editor";
export type PublicUser = {
  id: string; username: string; displayName: string; role: Role; status: "active" | "disabled"; mustChangePassword: boolean;
  createdAt: string; updatedAt: string; lastLoginAt: string | null; passwordChangedAt: string;
};
export type ScreenKit = {
  doc: Document;
  api: Client;
  user: BootUser;
  show: (screen: { title: string; crumbs: Array<[string, string?]> }, content: Node[]) => void;
  heading: (text: string) => HTMLElement;
  message: (title: string, text: string, ...extra: Node[]) => Node[];
  say: (text: string, tone?: Tone, action?: ToastAction) => void;
  /** U3: a dialog (resolves true for the confirm button); tests pass their own, sync or not. */
  ask: (text: string, options?: ConfirmOptions) => boolean | Promise<boolean>;
  failed: (result: ApiFail, crumbs: Array<[string, string?]>) => void;
  actions: HTMLElement;
  /** Copy text to the clipboard; false when the browser refuses. */
  copy?: (text: string) => Promise<boolean>;
};

// M2: the Mr Spa CMS's words.
export const ROLE_HELP = "Admins can add people and see activity. Editors can change content and publish.";
const roleName = (role: Role) => (role === "owner" ? "Admin" : "Editor");
const when = (iso: string | null) => {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** U4: People and Activity are one place with two tabs (Mr Spa 19 / 20). */
export const peopleTabs = (doc: Document, current: "people" | "activity") => h(doc, "nav", { class: "vc-tabs", "aria-label": "People and activity" },
  h(doc, "a", { href: adminHref.users(), class: "vc-tab", ...(current === "people" ? { "aria-current": "page" } : {}) }, "People"),
  h(doc, "a", { href: adminHref.audit(), class: "vc-tab", ...(current === "activity" ? { "aria-current": "page" } : {}) }, "Activity"));
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "?";

/** A labelled input row for the small forms on these screens. */
const row = (doc: Document, id: string, label: string, input: HTMLElement, help?: string) =>
  h(doc, "div", { class: "vc-field" }, h(doc, "label", { class: "vc-label", for: id }, label), input, help ? h(doc, "p", { class: "vc-help" }, help) : null);

/** M12 (Mr Spa): a temporary password — 4 groups of 4 from 55 letters and digits that are not mixed up (no i l o I O 0 1). */
export const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const makeTemporaryPassword = (random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)) => {
  const bytes = random(new Uint8Array(16));
  const text = [...bytes].map((byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("");
  return text.match(/.{4}/g)!.join("-");
};
/** M12 (Mr Spa): "Sep 23" (this year) / "Sep 23, 2025". */
export const shortDate = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
};
/** M12 (Mr Spa): the initials of a username ("lan.showroom" → "LA"). */
export const usernameInitials = (username: string) => username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";

/**
 * M12: People, as in the Mr Spa CMS — the tabs People | Activity, "N users." + Refresh, the table Person · Role ·
 * Status · Last sign-in with a ⋯ per person (Reset password = the admin types it · Disable / Enable), and on the right
 * "Add a person": Username, a temporary password filled in (editable, Copy), the role cards, Create account. Every
 * outcome is said in the status line. The person chooses their own password when they first sign in (kept, §H.1).
 */
export const peopleScreen = async (kit: ScreenKit, stillHere: () => boolean) => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["People & activity"]];
  if (user.role !== "owner") return kit.show({ title: "People & activity", crumbs }, kit.message("People", "Only an admin can manage people. Ask an admin of this site if someone needs an account."));
  const status = h(doc, "span", { class: "vc-users-status", role: "status", "aria-live": "polite" });
  const say = (text: string, state: "idle" | "error" | "success" = "idle") => { status.textContent = text; status.dataset.state = state; };
  const refresh = h(doc, "button", { type: "button", class: "vc-button" }, "Refresh");
  const tbody = h(doc, "tbody");
  let users: PublicUser[] = [];

  const load = async () => {
    say("Loading…"); refresh.disabled = true;
    const result = await api.get<{ users: PublicUser[] }>("/api/cms/users");
    refresh.disabled = false;
    if (!stillHere()) return;
    if (!result.ok) { say(result.message || "Unable to load users.", "error"); return; }
    users = result.data.users;
    render();
    say(`${users.length} ${users.length === 1 ? "user" : "users"}.`);
  };
  refresh.addEventListener("click", () => { void load(); });

  const patch = async (person: PublicUser, body: Record<string, unknown>, fallback: string) => {
    const changed = await api.request<{ user: PublicUser }>("PATCH", `/api/cms/users/${encodeURIComponent(person.id)}`, body);
    if (!changed.ok) { say(changed.message || fallback, "error"); return undefined; }
    return changed.data;
  };
  /** Reset password: the admin types the new one (12–200 characters). */
  const resetPassword = (person: PublicUser) => {
    const input = h(doc, "input", { id: "vc-reset-password", type: "password", class: "vc-input", minlength: "12", maxlength: "200", autocomplete: "new-password", required: true });
    const form = h(doc, "form", { class: "vc-password-form", method: "post" }, h(doc, "label", { class: "vc-field", for: "vc-reset-password" }, h(doc, "span", { class: "vc-label" }, "New password"), input));
    const dialog = openDialog(doc, {
      title: `Reset password for ${person.username}`, body: [form],
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Save password", kind: "primary", value: "save" }],
      onButton: async (value, open) => {
        if (value !== "save") return true;
        if (input.value.length < 12 || input.value.length > 200) { input.reportValidity?.(); return false; }
        open.busy(true);
        const done = await patch(person, { action: "reset-password", password: input.value }, "Unable to reset password.");
        open.busy(false);
        if (done) say("Password reset.", "success");
        return true;
      },
    });
    form.addEventListener("submit", (event) => { event.preventDefault(); dialog.element.querySelector<HTMLElement>('[data-value="save"]')?.click(); });
    input.focus();
  };
  const toggle = async (person: PublicUser) => {
    const on = person.status !== "active";
    const word = on ? "Enable" : "Disable";
    if (!(await kit.ask(`${word} user\n\n${word} ${person.username}?`, { confirm: word }))) return;
    if (await patch(person, { action: on ? "enable" : "disable" }, "Unable to update user.")) await load();
  };
  const render = () => {
    clear(tbody);
    for (const person of users) {
      const menu = rowMenu(doc, `Actions for ${person.username}`, [
        { text: "Reset password", run: () => resetPassword(person) },
        { text: person.status === "active" ? "Disable" : "Enable", run: () => { void toggle(person); } },
      ]);
      tbody.append(h(doc, "tr", { "data-user": person.username },
        h(doc, "td", {}, h(doc, "span", { class: "vc-people-person" }, h(doc, "span", { class: "vc-people-initials", "aria-hidden": "true" }, usernameInitials(person.username)), h(doc, "strong", {}, person.username))),
        h(doc, "td", {}, roleName(person.role)),
        h(doc, "td", {}, h(doc, "span", { class: `vc-content-status${person.status === "active" ? "" : " is-off"}` }, person.status === "active" ? "Active" : "Disabled")),
        h(doc, "td", person.lastLoginAt ? { title: new Date(person.lastLoginAt).toLocaleString() } : {}, person.lastLoginAt ? shortDate(person.lastLoginAt) : "Not yet"),
        h(doc, "td", { class: "vc-user-actions" }, menu)));
    }
  };

  // ---- Add a person
  const username = h(doc, "input", { id: "vc-new-username", name: "username", class: "vc-input", autocomplete: "off", autocapitalize: "none", spellcheck: "false", required: true, placeholder: "e.g. lan.showroom" });
  const password = h(doc, "input", { id: "vc-new-password", name: "password", class: "vc-input", type: "text", autocomplete: "off", spellcheck: "false", required: true, minlength: "12", "aria-describedby": "vc-new-password-help" });
  password.value = makeTemporaryPassword();
  const copy = h(doc, "button", { type: "button", class: "vc-button" }, "Copy");
  copy.addEventListener("click", async () => {
    const ok = kit.copy ? await kit.copy(password.value) : false;
    if (!ok) password.select();
    copy.textContent = ok ? "Copied" : "Select and copy";
    setTimeout(() => { copy.textContent = "Copy"; }, 2000);
  });
  const roleCard = (value: Role, title: string, text: string) => h(doc, "label", { class: "vc-people-role" },
    h(doc, "input", { type: "radio", name: "role", value, checked: value === "editor" }),
    h(doc, "span", {}, h(doc, "strong", {}, title), h(doc, "span", {}, text)));
  const create = h(doc, "button", { type: "submit", class: "vc-button vc-primary" }, "Create account");
  const form = h(doc, "form", { class: "vc-user-form", method: "post", "aria-labelledby": "vc-add-title" },
    h(doc, "label", { class: "vc-people-label", for: "vc-new-username" }, "Username"), username,
    h(doc, "label", { class: "vc-people-label", for: "vc-new-password" }, "Temporary password"),
    h(doc, "div", { class: "vc-people-password" }, password, copy),
    h(doc, "p", { class: "vc-people-help", id: "vc-new-password-help" }, "Share it privately. They choose their own when they first sign in."),
    h(doc, "fieldset", { class: "vc-people-roles" }, h(doc, "legend", {}, "Role"),
      roleCard("editor", "Editor", "Changes content and publishes."),
      roleCard("owner", "Admin", "Also adds people and sees activity.")),
    create);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    create.disabled = true;
    say("Creating user…");
    const role = (form.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value ?? "editor") as Role;
    const created = await api.post<{ user: PublicUser }>("/api/cms/users", { username: username.value, password: password.value, role });
    create.disabled = false;
    if (!created.ok) { say(created.message || "Unable to create user.", "error"); return; }
    form.reset();
    password.value = makeTemporaryPassword();
    say("User created.", "success");
    await load();
  });

  const title = kit.heading("People");
  title.classList.add("vc-sr-only");
  kit.show({ title: "People & activity", crumbs }, [
    title,
    h(doc, "div", { class: "vc-people-layout" },
      h(doc, "div", { class: "vc-people-main" },
        peopleTabs(doc, "people"),
        h(doc, "div", { class: "vc-people-toolbar" }, status, refresh),
        h(doc, "div", { class: "vc-workspace-card" },
          h(doc, "table", { class: "vc-users-table" },
            h(doc, "thead", {}, h(doc, "tr", {}, ...["Person", "Role", "Status", "Last sign-in"].map((text) => h(doc, "th", { scope: "col" }, text)), h(doc, "th", { scope: "col" }, h(doc, "span", { class: "vc-sr-only" }, "Actions")))),
            tbody)),
        h(doc, "p", { class: "vc-people-note" }, ROLE_HELP)),
      h(doc, "aside", { class: "vc-people-panel", "aria-labelledby": "vc-add-title" },
        h(doc, "div", { class: "vc-people-panel-head" }, h(doc, "span", {}, "People"), h(doc, "h2", { id: "vc-add-title" }, "Add a person")),
        form)),
  ]);
  await load();
};

/** M12 (Mr Spa): a row's ⋯ — a small menu of plain items. */
export const rowMenu = (doc: Document, label: string, items: Array<{ text: string; run: () => void }>) => {
  const list = h(doc, "div", { class: "vc-row-menu-list", role: "menu" });
  const button = h(doc, "button", { type: "button", class: "vc-row-menu-button", "aria-label": label, "data-tooltip": label, "aria-haspopup": "menu", "aria-expanded": "false" }, "⋯");
  const close = () => { list.hidden = true; button.setAttribute("aria-expanded", "false"); };
  list.hidden = true;
  for (const item of items) list.append(h(doc, "button", { type: "button", class: "vc-row-menu-item", role: "menuitem", onclick: () => { close(); item.run(); } }, item.text));
  button.addEventListener("click", (event) => { event.stopPropagation(); list.hidden = !list.hidden; button.setAttribute("aria-expanded", String(!list.hidden)); if (!list.hidden) list.querySelector<HTMLElement>("button")?.focus(); });
  list.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); button.focus(); } });
  doc.addEventListener("pointerdown", (event) => { if (!list.hidden && !list.contains(event.target as Node) && event.target !== button) close(); });
  return h(doc, "div", { class: "vc-row-menu" }, button, list);
};

/**
 * M2: "Change your password", the dialog of the Mr Spa CMS (account menu → Change password): current, new, confirm;
 * this session stays signed in (the server signs out the others). The password never leaves the form but to the API.
 */
export const openChangePassword = (kit: ScreenKit) => {
  const { doc, api, user } = kit;
  const field = (id: string, label: string, autocomplete: string) => {
    const input = h(doc, "input", { id, type: "password", class: "vc-input", autocomplete, required: true, ...(autocomplete === "new-password" ? { minlength: "12", maxlength: "200" } : {}) });
    return { input, element: row(doc, id, label, input) };
  };
  const current = field("vc-pw-current", "Current password", "current-password");
  const next = field("vc-pw-new", "New password", "new-password");
  const confirm = field("vc-pw-confirm", "Confirm new password", "new-password");
  const status = h(doc, "p", { class: "vc-password-status", role: "status", "aria-live": "polite" });
  const say = (text: string, tone: "error" | "success") => { status.textContent = text; status.dataset.tone = tone; };
  // A form with method="post", so a password manager sees it and nothing lands in the address if a script fails.
  const form = h(doc, "form", { class: "vc-password-form", method: "post" },
    h(doc, "input", { type: "text", name: "username", autocomplete: "username", value: user.username, hidden: true, readonly: true }),
    current.element, next.element, confirm.element, status);
  const save = async (dialog: OpenDialog) => {
    status.textContent = "";
    if (!form.reportValidity?.() && [current, next, confirm].some((entry) => !entry.input.value)) return false;
    if (next.input.value !== confirm.input.value) { say("New passwords do not match.", "error"); confirm.input.focus(); return false; }
    dialog.busy(true);
    const changed = await api.put("/api/auth/password", { currentPassword: current.input.value, newPassword: next.input.value });
    dialog.busy(false);
    if (!changed.ok) { say(changed.message, "error"); current.input.focus(); return false; }
    form.reset();
    say("Password changed successfully.", "success");
    setTimeout(() => dialog.close("saved"), 650);
    return false;
  };
  const dialog = openDialog(doc, {
    title: "Change your password",
    text: "Use 12–200 characters. Your current CMS session will stay active after saving.",
    body: [form],
    buttons: [{ label: "Cancel", value: "cancel" }, { label: "Save password", kind: "primary", value: "save" }],
    onButton: (value, open) => (value === "save" ? save(open) : true),
  });
  // Enter in a field saves, like a form.
  form.addEventListener("submit", (event) => { event.preventDefault(); void save(dialog); });
  current.input.focus();
  return dialog;
};
