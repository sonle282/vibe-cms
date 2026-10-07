/**
 * P7: the admin shell — navigation, the overview, collection lists, and the editor for a file or a record, saving
 * drafts through the CMS API (P5). Hash routes, so /admin stays one server route:
 *   #/                                   overview (every file and collection, with my drafts)
 *   #/files/<key>                        edit a file
 *   #/collections/<key>                  the records of a collection (search, add)
 *   #/collections/<key>/items/<id>       edit a record
 *   #/collections/<key>/new              a new record
 * Review / publish (P8), preview (P9) and images (P10) build on this. Nothing is saved without "Save draft"; leaving
 * with unsaved changes asks first.
 */
import type { Field } from "../config/index.js";
import { checkRecordValues } from "../check/values.js";
import { createClient, humanMessage, type ApiFail, type Client, type Fetch } from "./api.js";
import type { AdminBoot, BootCollection, BootFile } from "./boot.js";
import { clear, h } from "./dom.js";
import { createForm, type Form, type ReferenceTarget } from "./form.js";
import { clone, countChanges, ID_PATTERN, slugify } from "./value.js";

export type AdminOptions = {
  root: HTMLElement;
  boot: AdminBoot;
  /** Injectable for tests; the page's fetch otherwise. */
  fetch?: Fetch;
  /** Injectable for tests; window.confirm otherwise. */
  confirm?: (message: string) => boolean;
  window?: Window;
};

type Screen = { title: string; crumbs: Array<[string, string?]>; dirty?: () => number; save?: () => Promise<void>; leave?: () => void };

type FileView = { resource: string; label: string; content: unknown; version: string; draft: null | { content: unknown; revision: number; sourceVersion: string; stale: boolean; updatedAt: string } };
type ListView = { key: string; label: string; itemLabel: string; items: Array<{ id: string; resource: string; label: string; version: string | null; hasDraft: boolean; isNew?: boolean }> };
type ContentView = { files: Array<{ key: string; label: string; hasDraft: boolean }>; collections: Array<{ key: string; label: string; itemLabel: string; count: number; drafts: number }> };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const startAdmin = (options: AdminOptions) => {
  const { root, boot } = options;
  const win = options.window ?? (root.ownerDocument.defaultView as Window);
  const doc = root.ownerDocument;
  const api: Client = createClient(options.fetch ?? ((input, init) => win.fetch(input, init)));
  const ask = options.confirm ?? ((message: string) => win.confirm(message));
  const { user } = boot;

  // ---------------------------------------------------------------- shell

  const link = (href: string, text: string, extra: Record<string, string> = {}) => h(doc, "a", { href, ...extra }, text);
  const navItems = [
    link("#/", "Overview", { "data-route": "#/" }),
    ...boot.files.map((file) => link(`#/files/${file.key}`, file.label, { "data-route": `#/files/${file.key}` })),
    ...boot.collections.map((collection) => link(`#/collections/${collection.key}`, collection.label, { "data-route": `#/collections/${collection.key}` })),
  ];
  const signOut = h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: async () => {
    if (current?.dirty?.() && !ask(leaveMessage(current.dirty()))) return;
    dirtyGuard = false;
    await api.post("/api/auth/logout", {});
    win.location.assign("/admin");
  } }, "Sign out");
  const nav = h(doc, "nav", { class: "vc-nav", "aria-label": "Content" },
    h(doc, "div", { class: "vc-brand" }, h(doc, "span", { class: "vc-brand-name" }, boot.site.name), h(doc, "span", { class: "vc-brand-sub" }, "Vibe CMS")),
    h(doc, "ul", { class: "vc-nav-list" }, navItems.map((item) => h(doc, "li", {}, item))),
    h(doc, "div", { class: "vc-user" }, h(doc, "span", { class: "vc-user-name" }, user.displayName), h(doc, "span", { class: "vc-user-role" }, user.role === "owner" ? "Owner" : "Editor"), signOut));
  const crumbs = h(doc, "nav", { class: "vc-crumbs", "aria-label": "Breadcrumb" });
  const saveState = h(doc, "span", { class: "vc-save-state", role: "status", "aria-live": "polite" });
  const actions = h(doc, "div", { class: "vc-actions" });
  const body = h(doc, "div", { class: "vc-body" });
  const toast = h(doc, "div", { class: "vc-toast", role: "status", "aria-live": "polite", "aria-atomic": "true", hidden: true });
  const main = h(doc, "main", { class: "vc-main", id: "vc-main" }, h(doc, "header", { class: "vc-top" }, crumbs, h(doc, "div", { class: "vc-top-right" }, saveState, actions)), body);
  clear(root);
  root.append(h(doc, "a", { class: "vc-skip", href: "#vc-main", onclick: (event: Event) => { event.preventDefault(); main.querySelector<HTMLElement>("h1")?.focus(); } }, "Skip to content"), h(doc, "div", { class: "vc-app" }, nav, main), toast);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string) => { toast.textContent = text; toast.hidden = false; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4000); };
  const setState = (kind: "idle" | "dirty" | "saved" | "busy" | "error", text: string) => { saveState.textContent = text; saveState.dataset.state = kind; };
  const leaveMessage = (count: number) => `Leave without saving?\n\nYou have ${plural(count, "unsaved change")}. If you leave, they are lost.`;

  // ---------------------------------------------------------------- routing

  let current: Screen | undefined;
  let currentHash = "";
  let dirtyGuard = true;
  let ignoreHash = false;
  let generation = 0;

  const show = (screen: Screen, content: Node[]) => {
    current = screen;
    clear(crumbs);
    screen.crumbs.forEach(([text, href], index) => {
      if (index) crumbs.append(h(doc, "span", { class: "vc-crumb-sep", "aria-hidden": "true" }, "/"));
      crumbs.append(href ? link(href, text) : h(doc, "span", { "aria-current": "page" }, text));
    });
    clear(body);
    body.append(...content);
    doc.title = `${screen.title} · ${boot.site.name} · Vibe CMS`;
    const route = currentHash.split("/").slice(0, 3).join("/") || "#/";
    for (const item of navItems) { if (item.dataset.route === route) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); }
  };
  const heading = (text: string) => h(doc, "h1", { class: "vc-title", tabindex: "-1" }, text);
  const message = (title: string, text: string, ...extra: Node[]) => [heading(title), h(doc, "p", { class: "vc-lead" }, text), ...extra];

  const route = async () => {
    const hash = win.location.hash || "#/";
    if (ignoreHash) { ignoreHash = false; return; }
    if (current?.dirty?.() && hash !== currentHash && dirtyGuard && !ask(leaveMessage(current.dirty()))) {
      ignoreHash = true;
      win.location.hash = currentHash;
      return;
    }
    current?.leave?.();
    currentHash = hash;
    const mine = (generation += 1);
    clear(actions);
    setState("idle", "");
    clear(body);
    body.append(h(doc, "p", { class: "vc-loading" }, "Loading…"));
    const parts = hash.replace(/^#\/?/, "").split("/").map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
    const stillHere = () => mine === generation;
    try {
      if (!parts[0]) await overview(stillHere);
      else if (parts[0] === "files" && parts.length === 2) await editFile(parts[1], stillHere);
      else if (parts[0] === "collections" && parts.length === 2) await listCollection(parts[1], stillHere);
      else if (parts[0] === "collections" && parts.length === 3 && parts[2] === "new") await editItem(parts[1], undefined, stillHere);
      else if (parts[0] === "collections" && parts.length === 4 && parts[2] === "items") await editItem(parts[1], parts[3], stillHere);
      else show({ title: "Not found", crumbs: [["Overview", "#/"], ["Not found"]] }, message("Not found", "There is nothing at this address in the CMS.", link("#/", "Go to the overview")));
    } catch {
      if (stillHere()) show({ title: "Error", crumbs: [["Overview", "#/"], ["Error"]] }, message("Something went wrong", "The page could not be shown. Reload to try again."));
    }
    if (stillHere()) main.querySelector<HTMLElement>("h1")?.focus();
  };

  const failed = (result: ApiFail, crumbsFor: Array<[string, string?]>) => {
    if (result.status === 401 || result.error === "password_change_required") { dirtyGuard = false; win.location.assign("/admin"); }
    show({ title: "Error", crumbs: crumbsFor }, message(result.status === 404 ? "Not found" : "Can't open this", result.message));
  };

  // ---------------------------------------------------------------- overview

  const overview = async (stillHere: () => boolean) => {
    const result = await api.get<ContentView>("/api/cms/content");
    if (!stillHere()) return;
    if (!result.ok) return failed(result, [["Overview"]]);
    const pill = (draft: boolean, text = "Draft saved") => h(doc, "span", { class: `vc-pill ${draft ? "vc-pill-draft" : "vc-pill-live"}` }, draft ? text : "Live");
    const cards = [
      ...result.data.files.map((file) => h(doc, "li", {}, h(doc, "a", { class: "vc-card", href: `#/files/${file.key}` }, h(doc, "span", { class: "vc-card-title" }, file.label), h(doc, "span", { class: "vc-card-meta" }, "Page content"), pill(file.hasDraft)))),
      ...result.data.collections.map((collection) => h(doc, "li", {}, h(doc, "a", { class: "vc-card", href: `#/collections/${collection.key}` }, h(doc, "span", { class: "vc-card-title" }, collection.label), h(doc, "span", { class: "vc-card-meta" }, plural(collection.count, collection.itemLabel.toLowerCase())), collection.drafts ? pill(true, `${plural(collection.drafts, "draft")}`) : null))),
    ];
    show({ title: "Overview", crumbs: [["Overview"]] }, [heading(`${boot.site.name}`), h(doc, "p", { class: "vc-lead" }, `Signed in as ${user.displayName}. Pick what to edit. Saving makes a draft; the website changes only when a draft is published.`), h(doc, "ul", { class: "vc-cards" }, cards)]);
  };

  // ---------------------------------------------------------------- collection list

  const collectionOf = (key: string) => boot.collections.find((collection) => collection.key === key);

  const listCollection = async (key: string, stillHere: () => boolean) => {
    const collection = collectionOf(key);
    const crumbsFor: Array<[string, string?]> = [["Overview", "#/"], [collection?.label ?? key]];
    if (!collection) return show({ title: "Not found", crumbs: crumbsFor }, message("Not found", `There is no "${key}" in this site's CMS.`));
    const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
    if (!stillHere()) return;
    if (!result.ok) return failed(result, crumbsFor);
    const items = result.data.items;
    const noun = collection.itemLabel.toLowerCase();
    const count = h(doc, "p", { class: "vc-count", "aria-live": "polite" });
    const tbody = h(doc, "tbody");
    const search = h(doc, "input", { type: "search", class: "vc-input vc-search", placeholder: `Search ${collection.label.toLowerCase()}`, "aria-label": `Search ${collection.label.toLowerCase()}` });
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const shown = items.filter((item) => !query || item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
      clear(tbody);
      for (const item of shown) {
        const status = item.isNew ? h(doc, "span", { class: "vc-pill vc-pill-draft" }, "New · not published")
          : h(doc, "span", { class: "vc-status" }, h(doc, "span", { class: "vc-pill vc-pill-live" }, "Live"), item.hasDraft ? h(doc, "span", { class: "vc-unpublished" }, "Draft saved") : null);
        tbody.append(h(doc, "tr", { "data-id": item.id }, h(doc, "td", {}, link(`#/collections/${key}/items/${encodeURIComponent(item.id)}`, item.label || item.id)), h(doc, "td", { class: "vc-mono" }, item.id), h(doc, "td", {}, status)));
      }
      if (!shown.length) tbody.append(h(doc, "tr", {}, h(doc, "td", { colspan: "3", class: "vc-empty" }, items.length ? `No ${noun} matches “${search.value.trim()}”.` : `No ${noun} yet.`)));
      count.textContent = query ? `${shown.length} of ${plural(items.length, noun)}` : plural(items.length, noun);
    };
    search.addEventListener("input", render);
    render();
    actions.append(link(`#/collections/${key}/new`, `Add ${noun}`, { class: "vc-button vc-primary" }));
    show({ title: collection.label, crumbs: crumbsFor }, [
      heading(collection.label),
      h(doc, "div", { class: "vc-toolbar" }, search, count),
      h(doc, "table", { class: "vc-table" }, h(doc, "thead", {}, h(doc, "tr", {}, h(doc, "th", { scope: "col" }, collection.itemLabel), h(doc, "th", { scope: "col" }, "ID"), h(doc, "th", { scope: "col" }, "Status"))), tbody),
    ]);
  };

  // ---------------------------------------------------------------- editor (file or record)

  const referencesIn = (fields: Record<string, Field>, out = new Set<string>()) => {
    const walk = (field: Field) => {
      if (field.type === "reference") out.add(field.to);
      else if (field.type === "object") Object.values(field.fields).forEach(walk);
      else if (field.type === "list") walk(field.of);
    };
    Object.values(fields).forEach(walk);
    return out;
  };
  const loadReferences = async (fields: Record<string, Field>) => {
    const targets: Record<string, ReferenceTarget> = {};
    await Promise.all([...referencesIn(fields)].map(async (key) => {
      const target = collectionOf(key);
      const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
      targets[key] = { label: target?.label ?? key, itemLabel: target?.itemLabel ?? key, items: result.ok ? result.data.items.map((item) => ({ id: item.id, label: item.label || item.id })) : [] };
    }));
    return targets;
  };

  const editFile = async (key: string, stillHere: () => boolean) => {
    const file = boot.files.find((entry) => entry.key === key);
    if (!file) return show({ title: "Not found", crumbs: [["Overview", "#/"], ["Not found"]] }, message("Not found", `There is no "${key}" in this site's CMS.`));
    await editor({ kind: "file", file, url: `/api/cms/files/${encodeURIComponent(key)}`, crumbs: [["Overview", "#/"]], stillHere });
  };

  const editItem = async (key: string, id: string | undefined, stillHere: () => boolean) => {
    const collection = collectionOf(key);
    if (!collection) return show({ title: "Not found", crumbs: [["Overview", "#/"], ["Not found"]] }, message("Not found", `There is no "${key}" in this site's CMS.`));
    await editor({ kind: "item", collection, id, url: id === undefined ? undefined : `/api/cms/collections/${encodeURIComponent(key)}/items/${encodeURIComponent(id)}`, crumbs: [["Overview", "#/"], [collection.label, `#/collections/${key}`]], stillHere });
  };

  type EditorInput = { stillHere: () => boolean; crumbs: Array<[string, string?]>; url: string | undefined } & ({ kind: "file"; file: BootFile } | { kind: "item"; collection: BootCollection; id: string | undefined });

  const editor = async (input: EditorInput) => {
    const isNew = input.kind === "item" && input.id === undefined;
    const collection = input.kind === "item" ? input.collection : undefined;
    const configFields = input.kind === "file" ? input.file.fields : input.collection.fields;

    // Load the content (or nothing, for a new record), the referenced collections, and the ids already taken.
    const [loaded, references, existing] = await Promise.all([
      input.url ? api.get<FileView>(input.url) : Promise.resolve(undefined),
      loadReferences(configFields),
      collection && isNew ? api.get<ListView>(`/api/cms/collections/${encodeURIComponent(collection.key)}`) : Promise.resolve(undefined),
    ]);
    if (!input.stillHere()) return;
    if (loaded && !loaded.ok) return failed(loaded, [...input.crumbs, [input.kind === "item" ? input.id ?? "" : "Error"]]);
    const view = loaded?.ok ? loaded.data : undefined;

    // Fields the form shows: the config's, plus for records the id, the status (when not declared) and the Markdown body.
    const fields: Record<string, Field> = {};
    const readOnly: Record<string, string> = {};
    if (collection) {
      if (!(collection.idField in collection.fields)) fields[collection.idField] = { type: "text", label: "ID", required: true, help: isNew ? "Used in the page address: lowercase letters, numbers and dashes. It can't be changed later." : undefined };
      if (!isNew) readOnly[collection.idField] = "The ID is fixed so existing links keep working.";
      if (collection.status && !(collection.status.field in collection.fields)) fields[collection.status.field] = { type: "select", label: "Status", options: [collection.status.live, collection.status.draft] };
    }
    Object.assign(fields, configFields);
    if (collection?.markdown && !("body" in fields)) fields.body = { type: "richText", label: "Text", help: "Markdown: **bold**, *italic*, [link](https://…); a blank line starts a new paragraph." };

    let version = view?.version ?? "new";
    let revision = view?.draft?.revision ?? 0;
    let hasDraft = Boolean(view?.draft);
    let saved: Record<string, unknown> = clone((view?.draft?.content ?? view?.content ?? {}) as Record<string, unknown>);
    let saving = false;
    let idTouched = !isNew;
    let autoId = false;
    const titleText = () => {
      if (input.kind === "file") return input.file.label;
      const value = form.value();
      const name = Object.entries(input.collection.fields).find(([key, field]) => field.type === "text" && key !== input.collection.idField && typeof value[key] === "string" && value[key])?.[0];
      return name ? String(value[name]) : isNew ? `New ${input.collection.itemLabel.toLowerCase()}` : view?.label ?? input.id ?? "";
    };

    const banner = h(doc, "div", { class: "vc-banner", role: "alert", hidden: true });
    const showBanner = (text: string, ...extra: Node[]) => { clear(banner); banner.append(h(doc, "p", {}, text), ...extra); banner.hidden = false; };
    const title = heading("");
    const save = h(doc, "button", { type: "button", class: "vc-button vc-primary", "data-action": "save" }, "Save draft");
    const discard = h(doc, "button", { type: "button", class: "vc-button vc-quiet", "data-action": "discard" }, "Discard draft");

    const dirty = () => countChanges(saved, form.value());
    const refresh = () => {
      const count = dirty();
      title.textContent = titleText();
      save.disabled = saving || count === 0;
      discard.hidden = !hasDraft;
      discard.disabled = saving;
      if (saving) setState("busy", "Saving…");
      else if (count) setState("dirty", count === 1 ? "1 unsaved change" : `${count} unsaved changes`);
      else if (hasDraft) setState("saved", "Draft saved · not live yet");
      else setState("idle", "No changes");
    };

    const form: Form = createForm({
      doc, fields, sections: input.kind === "file" ? input.file.sections : undefined, value: saved, role: user.role, references, readOnly,
      onChange: (value, path) => {
        if (collection && isNew && path.length === 1 && path[0] === collection.idField && !autoId) idTouched = true;
        if (collection && isNew && !idTouched && path[0] !== collection.idField) {
          const source = Object.entries(collection.fields).find(([key, field]) => field.type === "text" && key !== collection.idField);
          if (source && path[0] === source[0]) { autoId = true; form.setValue([collection.idField], slugify(String(value[source[0]] ?? ""))); autoId = false; }
        }
        refresh();
      },
    });

    const validate = () => {
      const value = form.value();
      const ids = new Map<string, Set<string>>();
      for (const [key, target] of Object.entries(references)) ids.set(key, new Set(target.items.map((item) => item.id)));
      const system = collection ? [collection.idField, ...(collection.status ? [collection.status.field] : []), ...(collection.markdown ? ["body"] : [])] : [];
      const problems = checkRecordValues({ fields: configFields, record: value, ids, system }).errors.map(({ path, message: text }) => ({ path, message: text }));
      if (collection) {
        const id = value[collection.idField];
        if (typeof id !== "string" || !id) problems.push({ path: collection.idField, message: "Fill in the ID." });
        else if (isNew && !ID_PATTERN.test(id)) problems.push({ path: collection.idField, message: "Use lowercase letters, numbers and dashes only (e.g. spa-pedicure)." });
        else if (isNew && existing?.ok && existing.data.items.some((item) => item.id === id)) problems.push({ path: collection.idField, message: `Another ${collection.itemLabel.toLowerCase()} already uses this ID.` });
      }
      return problems;
    };

    const doSave = async () => {
      if (saving || !dirty()) return;
      banner.hidden = true;
      const problems = validate();
      if (problems.length) {
        form.showErrors(problems);
        setState("error", "Needs attention");
        say(problems.length === 1 ? "One field needs attention." : `${problems.length} fields need attention.`);
        form.focus(problems[0].path.replace(/\[\d+\].*$/, "")) || form.focus(problems[0].path);
        return;
      }
      form.clearErrors();
      const value = form.value();
      const id = collection ? String(value[collection.idField]) : undefined;
      const url = input.url ?? `/api/cms/collections/${encodeURIComponent(collection!.key)}/items/${encodeURIComponent(id!)}`;
      saving = true;
      refresh();
      const result = await api.put<{ draft: { revision: number } }>(url, { content: value, expectedRevision: revision, sourceVersion: version });
      saving = false;
      if (result.ok) {
        revision = result.data.draft.revision;
        hasDraft = true;
        saved = value;
        refresh();
        say("Draft saved. The website has not changed.");
        if (isNew && collection) { dirtyGuard = false; win.location.hash = `#/collections/${collection.key}/items/${encodeURIComponent(id!)}`; dirtyGuard = true; }
        return;
      }
      refresh();
      setState("error", "Not saved");
      if (result.status === 401 || result.error === "password_change_required") showBanner(result.message, h(doc, "a", { href: "/admin", class: "vc-button" }, "Sign in again"));
      else if (result.error === "locked_field" && Array.isArray(result.data.fields)) { form.showErrors((result.data.fields as Array<{ path: string; message: string }>).map((entry) => ({ path: entry.path, message: entry.message }))); showBanner(result.message); }
      else if (result.error === "invalid_content" && Array.isArray(result.data.errors)) { form.showErrors(result.data.errors as Array<{ path: string; message: string }>); showBanner(result.message); }
      else if (result.error === "draft_conflict") showBanner(result.message, h(doc, "button", { type: "button", class: "vc-button", onclick: () => { dirtyGuard = false; win.location.reload(); } }, "Reload"));
      else showBanner(result.message);
    };

    save.addEventListener("click", () => { void doSave(); });
    discard.addEventListener("click", async () => {
      if (!input.url || !ask(`Discard your draft?\n\nYour saved changes to ${titleText()} are deleted. The website does not change.`)) return;
      const result = await api.delete(input.url);
      if (!result.ok) { showBanner(result.message); return; }
      say("Draft discarded.");
      dirtyGuard = false;
      if (view?.content === null || view?.content === undefined) win.location.hash = `#/collections/${collection!.key}`;
      else { saved = clone(form.value()); pending = route(); }
      dirtyGuard = true;
    });
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void doSave(); } };
    doc.addEventListener("keydown", onKey);

    actions.append(discard, save);
    if (view?.draft?.stale) showBanner("The live content changed after this draft was started. Check your draft against the website; publishing it will ask you to reload first.");
    const intro = isNew ? `Fill in the new ${collection!.itemLabel.toLowerCase()} and save a draft. It is not on the website until it is published.`
      : hasDraft ? "You are editing your saved draft. The website shows the published version until the draft is published." : "Changes are saved as a draft first; the website does not change until a draft is published.";
    const crumbsFor: Array<[string, string?]> = [...input.crumbs, [titleText() || "…"]];
    show({ title: titleText(), crumbs: crumbsFor, dirty, save: doSave, leave: () => doc.removeEventListener("keydown", onKey) }, [
      title, h(doc, "p", { class: "vc-lead" }, intro),
      fieldsRequiredNote(fields), banner, form.element,
    ]);
    refresh();
  };

  const fieldsRequiredNote = (fields: Record<string, Field>) => (Object.values(fields).some((field) => field.required)
    ? h(doc, "p", { class: "vc-note" }, h(doc, "span", { class: "vc-required", "aria-hidden": "true" }, "*"), " Required")
    : h(doc, "span", { hidden: true }));

  // Unsaved work: ask before leaving the page.
  win.addEventListener("beforeunload", (event) => { if (dirtyGuard && current?.dirty?.()) { event.preventDefault(); event.returnValue = ""; } });
  let pending = route();
  win.addEventListener("hashchange", () => { pending = route(); });
  /** Resolves once the screen for the current address is shown (tests; the page never needs it). */
  const idle = async () => { let seen: Promise<void> | undefined; while (seen !== pending) { seen = pending; await seen; } };
  return { ready: pending, idle, route, isDirty: () => current?.dirty?.() ?? 0 };
};
