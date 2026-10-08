/**
 * P8b: People (owners only) and My account, on the P6 API.
 *   #/people   add a person (a temporary password is shown once), change role, disable / enable, reset a password
 *   #/account  my name and role; change my password (other sessions end, this one goes on)
 * The server decides everything (owner only, never the last active owner, not yourself); the screen only explains.
 * Passwords stay in the page only until it is left: never in the URL, storage or logs; every form posts.
 */
import type { ApiFail, Client } from "./api.js";
import type { BootUser } from "./boot.js";
import { clear, h } from "./dom.js";

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
  say: (text: string) => void;
  ask: (text: string) => boolean;
  failed: (result: ApiFail, crumbs: Array<[string, string?]>) => void;
  actions: HTMLElement;
  /** Copy text to the clipboard; false when the browser refuses. */
  copy?: (text: string) => Promise<boolean>;
};

export const ROLE_HELP = "Owners can do everything: manage people and change owner-only fields (prices, opening hours, phone, email, address). Editors change everything else and publish.";
const roleName = (role: Role) => (role === "owner" ? "Owner" : "Editor");
const when = (iso: string | null) => {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** A labelled input row for the small forms on these screens. */
const row = (doc: Document, id: string, label: string, input: HTMLElement, help?: string) =>
  h(doc, "div", { class: "vc-field" }, h(doc, "label", { class: "vc-label", for: id }, label), input, help ? h(doc, "p", { class: "vc-help" }, help) : null);

export const peopleScreen = async (kit: ScreenKit, stillHere: () => boolean) => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["Overview", "#/"], ["People"]];
  if (user.role !== "owner") return kit.show({ title: "People", crumbs }, kit.message("People", "Only an owner can manage people. Ask an owner of this site if someone needs an account."));
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
  const role = h(doc, "select", { id: "vc-new-role", name: "role", class: "vc-input" }, h(doc, "option", { value: "editor" }, "Editor"), h(doc, "option", { value: "owner" }, "Owner"));
  const addError = h(doc, "p", { class: "vc-error", role: "alert" });
  const addButton = h(doc, "button", { type: "submit", class: "vc-button vc-primary" }, "Add person");
  form.append(
    h(doc, "h2", { id: "vc-add-title", class: "vc-section-title" }, "Add a person"),
    h(doc, "div", { class: "vc-people-fields" },
      row(doc, "vc-new-username", "Username", username, "3–32 letters, numbers, dot, dash or underscore. They sign in with it."),
      row(doc, "vc-new-name", "Name (optional)", displayName, "Shown in the CMS."),
      row(doc, "vc-new-role", "Role", role)),
    addError, addButton);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    addError.textContent = "";
    addButton.disabled = true;
    const created = await api.post<{ user: PublicUser; temporaryPassword?: string }>("/api/cms/users", { username: username.value, displayName: displayName.value, role: role.value });
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
      const name = h(doc, "td", {}, h(doc, "span", { class: "vc-person-name" }, person.displayName), h(doc, "span", { class: "vc-mono" }, ` ${person.username}`), self ? h(doc, "span", { class: "vc-note" }, " (you)") : null);
      const roleCell = h(doc, "td");
      if (self) roleCell.append(roleName(person.role));
      else {
        const select = h(doc, "select", { class: "vc-input vc-role", "aria-label": `Role of ${person.displayName}` }, h(doc, "option", { value: "editor" }, "Editor"), h(doc, "option", { value: "owner" }, "Owner"));
        select.value = person.role;
        select.addEventListener("change", async () => {
          const next = select.value as Role;
          const question = next === "owner"
            ? `Make ${person.displayName} an owner?\n\nOwners can manage people and change owner-only fields (prices, hours, phone, email, address).`
            : `Make ${person.displayName} an editor?\n\nEditors can no longer manage people or change owner-only fields.`;
          if (!kit.ask(question)) { select.value = person.role; return; }
          if (await patch(person, { action: "set-role", role: next })) kit.say(`${person.displayName} is now ${next === "owner" ? "an owner" : "an editor"}.`);
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
          if (!kit.ask(`Reset the password of ${person.displayName}?\n\nThey are signed out everywhere at once and get a temporary password, shown to you once.`)) return;
          const done = await patch(person, { action: "reset-password" });
          if (done?.temporaryPassword) showSecret(done.user, done.temporaryPassword, "Password reset");
        });
        const toggle = person.status === "active"
          ? h(doc, "button", { type: "button", class: "vc-button vc-danger", "aria-label": `Disable ${person.displayName}` }, "Disable")
          : h(doc, "button", { type: "button", class: "vc-button", "aria-label": `Enable ${person.displayName}` }, "Enable");
        toggle.addEventListener("click", async () => {
          if (person.status === "active") {
            if (!kit.ask(`Disable ${person.displayName}?\n\nThey are signed out at once and cannot sign in until an owner enables them again. Their saved drafts stay.`)) return;
            if (await patch(person, { action: "disable" })) kit.say(`${person.displayName} is disabled.`);
          } else if (await patch(person, { action: "enable" })) kit.say(`${person.displayName} can sign in again.`);
        });
        buttons.append(reset, toggle);
      } else buttons.append(h(doc, "a", { href: "#/account", class: "vc-button vc-quiet" }, "My account"));
      tbody.append(h(doc, "tr", { "data-user": person.username }, name, roleCell, status, h(doc, "td", { class: "vc-note" }, when(person.lastLoginAt)), buttons));
    }
  };
  render();

  kit.show({ title: "People", crumbs }, [
    kit.heading("People"),
    h(doc, "p", { class: "vc-lead" }, ROLE_HELP),
    secret,
    h(doc, "section", { class: "vc-section" }, form),
    tableError,
    h(doc, "table", { class: "vc-table vc-people" },
      h(doc, "thead", {}, h(doc, "tr", {}, ...["Person", "Role", "Status", "Last sign-in"].map((text) => h(doc, "th", { scope: "col" }, text)), h(doc, "th", { scope: "col" }, h(doc, "span", { class: "vc-sr-only" }, "Actions")))),
      tbody),
  ]);
};

export const accountScreen = async (kit: ScreenKit, stillHere: () => boolean) => {
  const { doc, api, user } = kit;
  const crumbs: Array<[string, string?]> = [["Overview", "#/"], ["My account"]];
  const me = await api.get<{ user: PublicUser; dev?: boolean }>("/api/auth/me");
  if (!stillHere()) return;
  if (!me.ok) return kit.failed(me, crumbs);
  const person = me.data.user;
  const form = h(doc, "form", { class: "vc-section vc-account", method: "post", "aria-labelledby": "vc-pw-title" });
  const field = (id: string, label: string, autocomplete: string, help?: string) => {
    const input = h(doc, "input", { id, type: "password", class: "vc-input", autocomplete, required: true, ...(autocomplete === "new-password" ? { minlength: "12", maxlength: "200" } : {}) });
    return { input, element: row(doc, id, label, input, help) };
  };
  const current = field("vc-pw-current", "Current password", "current-password");
  const next = field("vc-pw-new", "New password", "new-password", "At least 12 characters. A few unrelated words make a strong one.");
  const again = field("vc-pw-again", "New password again", "new-password");
  const error = h(doc, "p", { class: "vc-error", role: "alert" });
  const submit = h(doc, "button", { type: "submit", class: "vc-button vc-primary" }, "Change password");
  form.append(
    h(doc, "h2", { id: "vc-pw-title", class: "vc-section-title" }, "Change my password"),
    h(doc, "input", { type: "text", name: "username", autocomplete: "username", value: person.username, hidden: true, readonly: true }),
    current.element, next.element, again.element, error, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (next.input.value !== again.input.value) { error.textContent = "The two new passwords are not the same."; again.input.focus(); return; }
    submit.disabled = true;
    const changed = await api.put("/api/auth/password", { currentPassword: current.input.value, newPassword: next.input.value });
    submit.disabled = false;
    if (!changed.ok) { error.textContent = changed.message; current.input.focus(); return; }
    form.reset();
    kit.say("Password changed. You stay signed in here; other devices are signed out.");
  });
  kit.show({ title: "My account", crumbs }, [
    kit.heading("My account"),
    h(doc, "dl", { class: "vc-account-facts" },
      h(doc, "dt", {}, "Name"), h(doc, "dd", {}, person.displayName),
      h(doc, "dt", {}, "Username"), h(doc, "dd", { class: "vc-mono" }, person.username),
      h(doc, "dt", {}, "Role"), h(doc, "dd", {}, `${roleName(person.role)} — ${person.role === "owner" ? "you can manage people and change owner-only fields." : "you can change content and publish; owner-only fields are shown locked."}`),
      h(doc, "dt", {}, "Last sign-in"), h(doc, "dd", {}, when(person.lastLoginAt))),
    me.data.dev ? h(doc, "p", { class: "vc-note" }, "Local development identity: there is no password to change.") : form,
  ]);
};
