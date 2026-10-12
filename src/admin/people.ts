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

export const peopleScreen = async (kit: ScreenKit, stillHere: () => boolean) => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["People & activity"]];
  if (user.role !== "owner") return kit.show({ title: "People", crumbs: [["People"]] }, kit.message("People", "Only an admin can manage people. Ask an admin of this site if someone needs an account."));
  const result = await api.get<{ users: PublicUser[] }>("/api/cms/users");
  if (!stillHere()) return;
  if (!result.ok) return kit.failed(result, crumbs);
  let users = result.data.users;

  // The one place a temporary password appears: shown once, with a copy button, gone when the page is left.
  const secret = h(doc, "div", { class: "vc-secret", role: "status", "aria-live": "polite", hidden: true });
  const showSecret = (person: PublicUser, password: string, what: string) => {
    clear(secret);
    const code = h(doc, "code", { class: "vc-secret-value" }, password);
    const copy = h(doc, "button", { type: "button", class: "vc-button" }, "Copy");
    copy.addEventListener("click", async () => { const ok = kit.copy ? await kit.copy(password) : false; kit.say(ok ? "Copied." : "Select the password and copy it."); });
    secret.append(
      h(doc, "p", { class: "vc-secret-title" }, `${what} — temporary password for ${person.displayName} (${person.username}):`),
      h(doc, "div", { class: "vc-secret-row" }, code, copy),
      h(doc, "p", { class: "vc-help" }, "It is shown only now. Give it to them in person or by phone (not by email or chat if you can avoid it). They choose their own password when they first sign in."),
      h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: () => { clear(secret); secret.hidden = true; } }, "Done — hide it"),
    );
    secret.hidden = false;
    secret.querySelector<HTMLElement>("button")?.focus();
  };

  // ---- add a person
  const form = h(doc, "form", { class: "vc-people-add", method: "post", "aria-labelledby": "vc-add-title" });
  const username = h(doc, "input", { id: "vc-new-username", name: "username", class: "vc-input", autocomplete: "off", autocapitalize: "none", spellcheck: "false", required: true, minlength: "3", maxlength: "32", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}" });
  const displayName = h(doc, "input", { id: "vc-new-name", name: "displayName", class: "vc-input", autocomplete: "off", maxlength: "60" });
  // U4: the role as two cards (Mr Spa 19), Editor first.
  const roleCard = (value: Role, title: string, text: string) => h(doc, "label", { class: "vc-choice" },
    h(doc, "input", { type: "radio", name: "role", value, checked: value === "editor" }),
    h(doc, "span", { class: "vc-choice-text" }, h(doc, "span", { class: "vc-choice-title" }, title), h(doc, "span", { class: "vc-choice-help" }, text)));
  const role = h(doc, "fieldset", { id: "vc-new-role", class: "vc-choices" }, h(doc, "legend", { class: "vc-label" }, "Role"),
    roleCard("editor", "Editor", "Changes content and publishes."),
    roleCard("owner", "Admin", "Also adds people and sees activity."));
  const roleValue = () => (form.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value ?? "editor") as Role;
  const addError = h(doc, "p", { class: "vc-error", role: "alert" });
  const addButton = h(doc, "button", { type: "submit", class: "vc-button vc-primary vc-wide" }, "Add person");
  form.append(
    h(doc, "div", { class: "vc-side-head" }, h(doc, "span", { class: "vc-side-crumb" }, "People"), h(doc, "h2", { id: "vc-add-title", class: "vc-side-title" }, "Add a person")),
    h(doc, "div", { class: "vc-people-fields" },
      row(doc, "vc-new-username", "Username", username, "3–32 letters, numbers, dot, dash or underscore. They sign in with it."),
      row(doc, "vc-new-name", "Name (optional)", displayName, "Shown in the CMS."),
      role),
    h(doc, "p", { class: "vc-help" }, "A temporary password is made for them and shown to you once. They choose their own when they first sign in."),
    addError, addButton);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    addError.textContent = "";
    addButton.disabled = true;
    const created = await api.post<{ user: PublicUser; temporaryPassword?: string }>("/api/cms/users", { username: username.value, displayName: displayName.value, role: roleValue() });
    addButton.disabled = false;
    if (!created.ok) { addError.textContent = created.message; username.focus(); return; }
    form.reset();
    users = [...users, created.data.user].sort((a, b) => a.username.localeCompare(b.username));
    render();
    if (created.data.temporaryPassword) showSecret(created.data.user, created.data.temporaryPassword, "Added");
    kit.say(`${created.data.user.displayName} was added.`);
  });

  // ---- the list
  const tableError = h(doc, "p", { class: "vc-error", role: "alert" });
  const tbody = h(doc, "tbody");
  const patch = async (person: PublicUser, body: Record<string, unknown>) => {
    tableError.textContent = "";
    const changed = await api.request<{ user: PublicUser; temporaryPassword?: string }>("PATCH", `/api/cms/users/${encodeURIComponent(person.id)}`, body);
    if (!changed.ok) { tableError.textContent = `${person.displayName}: ${changed.message}`; render(); return undefined; }
    users = users.map((entry) => (entry.id === person.id ? changed.data.user : entry));
    render();
    return changed.data;
  };
  const render = () => {
    clear(tbody);
    for (const person of users) {
      const self = person.id === user.id;
      const name = h(doc, "td", {}, h(doc, "span", { class: "vc-person" }, h(doc, "span", { class: "vc-initials", "aria-hidden": "true" }, initialsOf(person.displayName)), h(doc, "span", {}, h(doc, "span", { class: "vc-person-name" }, person.displayName), h(doc, "span", { class: "vc-mono" }, ` ${person.username}`), self ? h(doc, "span", { class: "vc-note" }, " (you)") : null)));
      const roleCell = h(doc, "td");
      if (self) roleCell.append(roleName(person.role));
      else {
        const select = h(doc, "select", { class: "vc-input vc-role", "aria-label": `Role of ${person.displayName}` }, h(doc, "option", { value: "editor" }, "Editor"), h(doc, "option", { value: "owner" }, "Admin"));
        select.value = person.role;
        select.addEventListener("change", async () => {
          const next = select.value as Role;
          const question = next === "owner"
            ? `Make ${person.displayName} an admin?\n\nAdmins can add people, see activity and change admin-only fields.`
            : `Make ${person.displayName} an editor?\n\nEditors can no longer add people or change admin-only fields.`;
          if (!(await kit.ask(question, { confirm: next === "owner" ? "Make admin" : "Make editor" }))) { select.value = person.role; return; }
          if (await patch(person, { action: "set-role", role: next })) kit.say(`${person.displayName} is now ${next === "owner" ? "an admin" : "an editor"}.`);
        });
        roleCell.append(select);
      }
      const status = h(doc, "td", {},
        h(doc, "span", { class: `vc-pill ${person.status === "active" ? "vc-pill-live" : "vc-pill-off"}` }, person.status === "active" ? "Active" : "Disabled"),
        person.mustChangePassword && person.status === "active" ? h(doc, "span", { class: "vc-unpublished" }, " Must choose a password") : null);
      const buttons = h(doc, "td", { class: "vc-people-actions" });
      if (!self) {
        const reset = h(doc, "button", { type: "button", class: "vc-button", "aria-label": `Reset password of ${person.displayName}` }, "Reset password");
        reset.addEventListener("click", async () => {
          if (!(await kit.ask(`Reset the password of ${person.displayName}?\n\nThey are signed out everywhere at once and get a temporary password, shown to you once.`, { confirm: "Reset password", danger: true }))) return;
          const done = await patch(person, { action: "reset-password" });
          if (done?.temporaryPassword) showSecret(done.user, done.temporaryPassword, "Password reset");
        });
        const toggle = person.status === "active"
          ? h(doc, "button", { type: "button", class: "vc-button vc-danger", "aria-label": `Disable ${person.displayName}` }, "Disable")
          : h(doc, "button", { type: "button", class: "vc-button", "aria-label": `Enable ${person.displayName}` }, "Enable");
        toggle.addEventListener("click", async () => {
          if (person.status === "active") {
            if (!(await kit.ask(`Disable ${person.displayName}?\n\nThey are signed out at once and cannot sign in until an admin enables them again. Their saved drafts stay.`, { confirm: "Disable", danger: true }))) return;
            if (await patch(person, { action: "disable" })) kit.say(`${person.displayName} is disabled.`);
          } else if (await patch(person, { action: "enable" })) kit.say(`${person.displayName} can sign in again.`);
        });
        buttons.append(reset, toggle);
      } else buttons.append(h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: () => openChangePassword(kit) }, "Change password"));
      tbody.append(h(doc, "tr", { "data-user": person.username }, name, roleCell, status, h(doc, "td", { class: "vc-note" }, when(person.lastLoginAt)), buttons));
    }
  };
  render();

  const title = kit.heading("People");
  title.classList.add("vc-sr-only");
  kit.show({ title: "People", crumbs }, [
    title,
    peopleTabs(doc, "people"),
    h(doc, "div", { class: "vc-split" },
      h(doc, "div", { class: "vc-split-main" },
        secret,
        tableError,
        h(doc, "table", { class: "vc-table vc-people" },
          h(doc, "thead", {}, h(doc, "tr", {}, ...["Person", "Role", "Status", "Last sign-in"].map((text) => h(doc, "th", { scope: "col" }, text)), h(doc, "th", { scope: "col" }, h(doc, "span", { class: "vc-sr-only" }, "Actions")))),
          tbody),
        h(doc, "p", { class: "vc-help" }, ROLE_HELP)),
      h(doc, "aside", { class: "vc-split-side" }, form)),
  ]);
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
