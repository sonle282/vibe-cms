/**
 * P7: the admin shell — navigation, the overview, collection lists, and the editor for a file or a record, saving
 * drafts through the CMS API (P5). Hash routes, so /admin stays one server route:
 *   #/                                   overview (every file and collection, with my drafts)
 *   #/files/<key>                        edit a file
 *   #/collections/<key>                  the records of a collection (search, add)
 *   #/collections/<key>/items/<id>       edit a record
 *   #/collections/<key>/new              a new record
 *   #/people · #/account                 P8b: people (owners only) · my account (change my password)
 *   #/publish  ·  #/publish/<resource>   P8: review my drafts (what each changes, in plain words) and publish them in
 *                                        one commit; then watch /live-version until the website serves them ("Live")
 * Preview (P9) and images (P10) build on this. Nothing is saved without "Save draft"; leaving with unsaved changes asks
 * first; nothing is published without the review screen.
 */
import type { Field } from "../config/index.js";
import { checkRecordValues } from "../check/values.js";
import { createClient, humanMessage, type ApiFail, type Client, type Fetch } from "./api.js";
import type { AdminBoot, BootCollection, BootFile } from "./boot.js";
import { clear, h } from "./dom.js";
import { summarizeChanges, type Change, type ReferenceLabels } from "./changes.js";
import { createForm, type Form, type ReferenceTarget } from "./form.js";
import { openImagePicker, prepareImage, type LibraryImage, type Prepare } from "./media.js";
import { configBinds, fieldAt, type PreviewOwner } from "./bridge.js";
import { createPreview, previewUrl, type Preview } from "./preview.js";
import { accountScreen, peopleScreen, type ScreenKit } from "./people.js";
import { clone, countChanges, getAt, ID_PATTERN, parsePathText, pathText, slugify, type Path } from "./value.js";

export type AdminOptions = {
  root: HTMLElement;
  boot: AdminBoot;
  /** Injectable for tests; the page's fetch otherwise. */
  fetch?: Fetch;
  /** Injectable for tests; window.confirm otherwise. */
  confirm?: (message: string) => boolean;
  window?: Window;
  /** P8: how often to ask /live-version after publishing, and for how long before saying "still publishing". */
  pollMs?: number;
  maxWaitMs?: number;
  /** Where an unfinished publish is remembered across reloads (localStorage by default; null = nowhere). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
  /** P10: how a chosen file is prepared before uploading (resize + WebP in the browser by default). */
  prepareImage?: Prepare;
  /** P9: show the preview next to the form (default: on for wide windows, then as the person last left it). */
  preview?: boolean;
};

/**
 * The fields the editor shows for a file or record: the config's, plus for records the ID (when not declared), the
 * status (when not declared) and the Markdown body. The review screen compares through the same fields.
 */
export const editorFields = (target: { kind: "file"; file: BootFile } | { kind: "item"; collection: BootCollection; isNew: boolean }) => {
  if (target.kind === "file") return target.file.fields;
  const { collection, isNew } = target;
  const fields: Record<string, Field> = {};
  if (!(collection.idField in collection.fields)) fields[collection.idField] = { type: "text", label: "ID", required: true, help: isNew ? "Used in the page address: lowercase letters, numbers and dashes. It can't be changed later." : undefined };
  if (collection.status && !(collection.status.field in collection.fields)) fields[collection.status.field] = { type: "select", label: "Status", options: [collection.status.live, collection.status.draft] };
  Object.assign(fields, collection.fields);
  if (collection.markdown && !("body" in fields)) fields.body = { type: "richText", label: "Text", help: "Format with the toolbar; “Edit Markdown” shows the text as Markdown." };
  return fields;
};

type DraftRow = { resource: string; kind: "file" | "item"; key: string; id: string | null; label: string; group: string; updatedAt: string; revision: number; isNew: boolean; stale: boolean };
type PublishResult = { commitSha: string | null; resources: string[]; files: string[]; expectedLiveVersion: string; warnings: Array<{ resource: string; code: string; fields?: string[] }>; attempts: number };
type PendingPublish = { expected: string; at: number; userId: string; labels: string[] };
const PENDING_KEY = "vibe-cms:publishing";

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
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
  const storage = options.storage === undefined ? (() => { try { return win.localStorage; } catch { return null; } })() : options.storage;
  const { user } = boot;
  const media = boot.media ?? { uploads: false, base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 };
  const prepare = options.prepareImage ?? prepareImage(win);
  /** P10: the image sheet for an image field. */
  const pickImage = (current: string, done: (image: { src: string }) => void) => openImagePicker({
    doc, api, media, prepare, current, onPick: done,
    upload: async (prepared) => {
      const headers: Record<string, string> = { "x-file-name": encodeURIComponent(prepared.name) };
      if (prepared.width && prepared.height) { headers["x-image-width"] = String(prepared.width); headers["x-image-height"] = String(prepared.height); }
      const result = await api.upload<{ image: LibraryImage & { reused?: boolean } }>("/api/cms/media", prepared.blob, headers);
      if (!result.ok) { if (result.status === 401 || result.error === "password_change_required") { dirtyGuard = false; win.location.assign("/admin"); } return { ok: false, message: result.message }; }
      return { ok: true, image: { ...result.data.image, source: "upload" } };
    },
  });

  // ---------------------------------------------------------------- shell

  const link = (href: string, text: string, extra: Record<string, string> = {}) => h(doc, "a", { href, ...extra }, text);
  const navItems = [
    link("#/", "Overview", { "data-route": "#/" }),
    ...boot.files.map((file) => link(`#/files/${file.key}`, file.label, { "data-route": `#/files/${file.key}` })),
    ...boot.collections.map((collection) => link(`#/collections/${collection.key}`, collection.label, { "data-route": `#/collections/${collection.key}` })),
  ];
  // P8: my drafts waiting to be published, with a count.
  const draftBadge = h(doc, "span", { class: "vc-badge", hidden: true });
  const publishLink = h(doc, "a", { href: "#/publish", "data-route": "#/publish", class: "vc-nav-publish" }, "Review & publish ", draftBadge);
  navItems.push(publishLink);
  // P8b: People, for owners only (the server refuses editors anyway).
  if (user.role === "owner") navItems.push(link("#/people", "People", { "data-route": "#/people" }));
  const refreshDrafts = async () => {
    const result = await api.get<{ drafts: DraftRow[] }>("/api/cms/drafts");
    const count = result.ok ? result.data.drafts.length : 0;
    draftBadge.textContent = String(count);
    draftBadge.hidden = count === 0;
    draftBadge.setAttribute("aria-label", `${plural(count, "draft")} waiting`);
    return result;
  };
  // P8: is the last publish live yet?
  const liveBox = h(doc, "div", { class: "vc-live", role: "status", "aria-live": "polite", hidden: true });
  const signOut = h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: async () => {
    if (current?.dirty?.() && !ask(leaveMessage(current.dirty()))) return;
    dirtyGuard = false;
    await api.post("/api/auth/logout", {});
    win.location.assign("/admin");
  } }, "Sign out");
  const nav = h(doc, "nav", { class: "vc-nav", "aria-label": "Content" },
    h(doc, "div", { class: "vc-brand" }, h(doc, "span", { class: "vc-brand-name" }, boot.site.name), h(doc, "span", { class: "vc-brand-sub" }, "Vibe CMS")),
    h(doc, "ul", { class: "vc-nav-list" }, navItems.map((item) => h(doc, "li", {}, item))),
    liveBox,
    h(doc, "div", { class: "vc-user" }, h(doc, "a", { class: "vc-user-name", href: "#/account", title: "My account" }, user.displayName), h(doc, "span", { class: "vc-user-role" }, user.role === "owner" ? "Owner" : "Editor"), signOut));
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
    const route = currentHash.startsWith("#/publish") ? "#/publish" : currentHash.split("/").slice(0, 3).join("/") || "#/";
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
      else if (parts[0] === "publish" && parts.length <= 2) await review(parts[1] || undefined, stillHere);
      else if (parts[0] === "people" && parts.length === 1) await peopleScreen(kit, stillHere);
      else if (parts[0] === "account" && parts.length === 1) await accountScreen(kit, stillHere);
      else show({ title: "Not found", crumbs: [["Overview", "#/"], ["Not found"]] }, message("Not found", "There is nothing at this address in the CMS.", link("#/", "Go to the overview")));
    } catch {
      if (stillHere()) show({ title: "Error", crumbs: [["Overview", "#/"], ["Error"]] }, message("Something went wrong", "The page could not be shown. Reload to try again."));
    }
    // The screen's heading gets focus (screen readers announce the page), unless the screen asked for a field (P9).
    const after = focusAfterShow;
    focusAfterShow = undefined;
    if (stillHere() && !after?.()) main.querySelector<HTMLElement>("h1")?.focus();
  };

  const failed = (result: ApiFail, crumbsFor: Array<[string, string?]>) => {
    if (result.status === 401 || result.error === "password_change_required") { dirtyGuard = false; win.location.assign("/admin"); }
    show({ title: "Error", crumbs: crumbsFor }, message(result.status === 404 ? "Not found" : "Can't open this", result.message));
  };

  // Screens in other modules (P8b) get the shell's pieces.
  const kit: ScreenKit = {
    doc, api, user, heading, message, say, ask, actions,
    show: (screen, content) => show(screen, content),
    failed: (result, crumbsFor) => failed(result, crumbsFor),
    copy: async (text) => { try { await win.navigator.clipboard.writeText(text); return true; } catch { return false; } },
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

  // ---------------------------------------------------------------- P9: preview helpers

  /** "Homepage · Banner › Heading", "Service · Price", "Footer links › Group 2 › Group title". */
  const describeField = (fields: Record<string, Field>, path: Path, prefix: string) => {
    const labels: string[] = [];
    for (let length = 1; length <= path.length; length += 1) {
      const step = path[length - 1];
      const found = fieldAt(fields, path.slice(0, length));
      if (typeof step === "number") { const list = fieldAt(fields, path.slice(0, length - 1))?.field; labels.push(`${list?.type === "list" ? list.itemLabel ?? "Item" : "Item"} ${step + 1}`); continue; }
      if (found && !found.rest.length && found.field.label && labels[labels.length - 1] !== found.field.label) labels.push(found.field.label);
    }
    return [prefix, labels.join(" › ")].filter(Boolean).join(" · ");
  };
  const describeOwner = (owner: PreviewOwner, path: Path) => {
    const [kind, key] = owner.split(":");
    if (kind === "file") {
      const file = boot.files.find((entry) => entry.key === key);
      if (!file) return path.join(".");
      const section = file.sections?.find((entry) => entry.fields.includes(String(path[0])) || entry.fields.some((field) => keyMatches(field, path)));
      return describeField(file.fields, path, section?.label ?? file.label);
    }
    const collection = boot.collections.find((entry) => entry.key === key);
    return collection ? describeField(editorFields({ kind: "item", collection, isNew: false }), path, collection.itemLabel) : path.join(".");
  };
  const keyMatches = (key: string, path: Path) => key.split(".").every((part, index) => path[index] === part);
  const sectionKeyOf = (owner: PreviewOwner, path: Path) => {
    const [kind, key] = owner.split(":");
    if (kind !== "file") return undefined;
    return boot.files.find((entry) => entry.key === key)?.sections?.find((entry) => entry.fields.some((field) => keyMatches(field, path)))?.key;
  };
  const hashOf = (owner: PreviewOwner) => {
    const [kind, key, ...rest] = owner.split(":");
    return kind === "file" ? `#/files/${key}` : `#/collections/${key}/items/${encodeURIComponent(rest.join(":"))}`;
  };
  const previewPreference = () => {
    if (options.preview !== undefined) return options.preview;
    try { const saved = storage?.getItem("vibe-cms:preview"); if (saved === "on" || saved === "off") return saved === "on"; } catch { /* no storage */ }
    return (win.innerWidth || 0) >= 1200;
  };
  /** After a click in the preview on another record's content: the field to open when its editor shows. */
  let pendingFocus: string | undefined;
  /** Set by a screen that wants focus somewhere other than its heading once it is shown. */
  let focusAfterShow: (() => boolean) | undefined;

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
    const fields = input.kind === "file" ? editorFields(input) : editorFields({ kind: "item", collection: input.collection, isNew });
    const readOnly: Record<string, string> = collection && !isNew ? { [collection.idField]: "The ID is fixed so existing links keep working." } : {};

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
    const resourceOf = () => (input.kind === "file" ? `file:${input.file.key}` : `item:${input.collection.key}:${input.id ?? String(form.value()[input.collection.idField] ?? "")}`);
    const publish = h(doc, "button", { type: "button", class: "vc-button", "data-action": "publish", onclick: () => { win.location.hash = `#/publish/${encodeURIComponent(resourceOf())}`; } }, "Review & publish");

    const dirty = () => countChanges(saved, form.value());
    const refresh = () => {
      const count = dirty();
      title.textContent = titleText();
      save.disabled = saving || count === 0;
      discard.hidden = !hasDraft;
      discard.disabled = saving;
      publish.hidden = !hasDraft && !count;
      publish.disabled = saving || count > 0 || !hasDraft;
      publish.title = count ? "Save a draft first" : "";
      if (saving) setState("busy", "Saving…");
      else if (count) setState("dirty", count === 1 ? "1 unsaved change" : `${count} unsaved changes`);
      else if (hasDraft) setState("saved", "Draft saved · not live yet");
      else setState("idle", "No changes");
    };

    const form: Form = createForm({
      doc, fields, sections: input.kind === "file" ? input.file.sections : undefined, value: saved, role: user.role, references, readOnly, pickImage,
      markdown: collection?.markdown && !("body" in collection.fields) ? ["body"] : [],
      onChange: (value, path) => {
        if (collection && isNew && path.length === 1 && path[0] === collection.idField && !autoId) idTouched = true;
        if (collection && isNew && !idTouched && path[0] !== collection.idField) {
          const source = Object.entries(collection.fields).find(([key, field]) => field.type === "text" && key !== collection.idField);
          if (source && path[0] === source[0]) { autoId = true; form.setValue([collection.idField], slugify(String(value[source[0]] ?? ""))); autoId = false; }
        }
        preview?.update(value, path, isNew ? owner() : undefined);
        refresh();
      },
    });

    // P9: the page next to the form, showing this draft as it is typed.
    const owner = (): PreviewOwner => (input.kind === "file" ? `file:${input.file.key}` : `item:${input.collection.key}:${input.id ?? (String(form.value()[input.collection.idField] ?? "") || "new")}`);
    const pattern = input.kind === "file" ? input.file.preview : input.collection.preview;
    let preview: Preview | undefined;
    let previewToggle: HTMLButtonElement | undefined;
    let suppressScroll = false;
    let lastFocused = "";
    if (pattern) {
      const placeholders = /\{[^}]+\}/.test(pattern);
      const url = isNew && placeholders ? undefined : previewUrl(pattern, saved) ?? (placeholders ? undefined : pattern);
      preview = createPreview({
        doc, win, url, title: input.kind === "file" ? input.file.label : `${input.collection.itemLabel}`,
        unavailable: isNew ? `A new ${collection!.itemLabel.toLowerCase()} gets its own page once it is published.` : "This record's page could not be found from its fields.",
        owner: owner(), value: () => form.value(), fields, markdown: collection?.markdown && !("body" in collection.fields) ? ["body"] : [],
        newItem: isNew && collection && !placeholders ? { collection: collection.key } : undefined,
        binds: input.kind === "file" ? configBinds(input.file.key, input.file.fields) : undefined,
        describe: describeOwner, sectionOf: sectionKeyOf,
        referenceLabel: (to, id) => references[to]?.items.find((item) => item.id === id)?.label ?? id,
        onSelect: ({ owner: selectedOwner, path }) => {
          const text = pathText(path);
          if (selectedOwner !== owner()) { pendingFocus = text; win.location.hash = hashOf(selectedOwner); return; }
          suppressScroll = true;
          reveal(text);
          suppressScroll = false;
        },
      });
      previewToggle = h(doc, "button", { type: "button", class: "vc-button vc-quiet", "data-action": "preview", "aria-pressed": "false" }, "Preview");
    }
    /** Focus a field (or the closest one that has its own control). */
    const reveal = (text: string) => {
      let key = text;
      while (key) { if (form.focus(key)) { lastFocused = key; return true; } key = /^(.*?)(\.[^.[\]]+|\[[^\]]*\])$/.exec(key)?.[1] ?? ""; }
      return false;
    };
    form.element.addEventListener("focusin", (event) => {
      const at = (event.target as Element | null)?.closest?.("[data-path]")?.getAttribute("data-path");
      if (!at || at === lastFocused) return;
      lastFocused = at;
      if (!suppressScroll) preview?.scrollTo(parsePathText(at));
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
      const result = await api.put<{ draft: { revision: number; content: unknown }; cleaned?: Array<{ path: string; removed: string[] }> }>(url, { content: value, expectedRevision: revision, sourceVersion: version });
      saving = false;
      if (result.ok) {
        revision = result.data.draft.revision;
        hasDraft = true;
        // P8c: the server removed unsafe HTML from what was typed — show exactly what was saved, and say where.
        const cleaned = result.data.cleaned ?? [];
        for (const entry of cleaned) { const path = parsePathText(entry.path); form.setValue(path, getAt(result.data.draft.content, path)); }
        saved = cleaned.length ? form.value() : value;
        refresh();
        const unsafe = cleaned.filter((entry) => entry.removed.length > 0);
        if (unsafe.length) {
          const where = (path: string) => { const label = (path.split(/[.[]/)[0] && fields[path.split(/[.[]/)[0]]?.label) || path; return path.includes(".") || path.includes("[") ? `${label} (${path})` : label; };
          showBanner(`Saved, with some HTML removed for safety: ${unsafe.map((entry) => `${where(entry.path)} — ${entry.removed.join(", ")}`).join("; ")}. Scripts, event handlers (onclick…), styles, frames and javascript: links are never kept.`);
          say("Draft saved; some HTML was removed for safety.");
        } else say("Draft saved. The website has not changed.");
        void refreshDrafts();
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
      void refreshDrafts();
      dirtyGuard = false;
      if (view?.content === null || view?.content === undefined) win.location.hash = `#/collections/${collection!.key}`;
      else { saved = clone(form.value()); pending = route(); }
      dirtyGuard = true;
    });
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void doSave(); } };
    doc.addEventListener("keydown", onKey);

    actions.append(...(previewToggle ? [previewToggle] : []), discard, save, publish);
    if (view?.draft?.stale) showBanner("The website changed after this draft was started (someone published). Publishing this draft is refused until you discard it and make your change again on the current content.");
    const intro = isNew ? `Fill in the new ${collection!.itemLabel.toLowerCase()} and save a draft. It is not on the website until it is published.`
      : hasDraft ? "You are editing your saved draft. The website shows the published version until the draft is published." : "Changes are saved as a draft first; the website does not change until a draft is published.";
    const crumbsFor: Array<[string, string?]> = [...input.crumbs, [titleText() || "…"]];
    const content = [title, h(doc, "p", { class: "vc-lead" }, intro), fieldsRequiredNote(fields), banner, form.element];
    const split = preview ? h(doc, "div", { class: "vc-editor-split" }, h(doc, "div", { class: "vc-editor-main" }, ...content), preview.element) : undefined;
    const setPreview = (on: boolean, remember: boolean) => {
      if (!split || !previewToggle) return;
      split.classList.toggle("vc-preview-on", on);
      body.classList.toggle("vc-body-wide", on);
      previewToggle.setAttribute("aria-pressed", String(on));
      preview!.element.hidden = !on;
      if (on) preview!.start();
      if (remember) { try { storage?.setItem("vibe-cms:preview", on ? "on" : "off"); } catch { /* no storage */ } }
    };
    previewToggle?.addEventListener("click", () => setPreview(previewToggle!.getAttribute("aria-pressed") !== "true", true));
    show({ title: titleText(), crumbs: crumbsFor, dirty, save: doSave, leave: () => { doc.removeEventListener("keydown", onKey); preview?.destroy(); body.classList.remove("vc-body-wide"); } }, split ? [split] : content);
    setPreview(previewPreference(), false);
    refresh();
    if (pendingFocus) { const target = pendingFocus; pendingFocus = undefined; focusAfterShow = () => reveal(target); }
  };

  // ---------------------------------------------------------------- P8: review + publish

  const timeOf = (iso: string | number) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }); };

  const changeItem = (change: Change) => {
    const parts: Node[] = [h(doc, "span", { class: "vc-change-label" }, change.label), change.locked ? h(doc, "span", { class: "vc-change-locked" }, " (owner only)") : h(doc, "span"), doc.createTextNode(": ")];
    const text = (cls: string, value: string) => h(doc, cls === "del" ? "del" : "ins", { class: `vc-change-${cls}` }, value || "(empty)");
    if (change.kind === "changed") parts.push(h(doc, "span", { class: "vc-change-what" }, text("del", change.before ?? ""), " → ", text("ins", change.after ?? "")));
    else if (change.kind === "added") parts.push(h(doc, "span", { class: "vc-change-what" }, "added ", text("ins", change.after ?? "")));
    else if (change.kind === "removed") parts.push(h(doc, "span", { class: "vc-change-what" }, "removed ", text("del", change.before ?? "")));
    else if (change.kind === "moved") parts.push(h(doc, "span", { class: "vc-change-what" }, change.after ? `new order: ${change.after}` : "new order"));
    else parts.push(h(doc, "span", { class: "vc-change-what" }, text("ins", change.after ?? "")));
    return h(doc, "li", { class: `vc-change vc-change-${change.kind}`, "data-path": change.path }, ...parts);
  };

  const urlOfDraft = (row: DraftRow) => (row.kind === "file" ? `/api/cms/files/${encodeURIComponent(row.key)}` : `/api/cms/collections/${encodeURIComponent(row.key)}/items/${encodeURIComponent(row.id ?? "")}`);
  const hrefOfDraft = (row: DraftRow) => (row.kind === "file" ? `#/files/${row.key}` : `#/collections/${row.key}/items/${encodeURIComponent(row.id ?? "")}`);
  const fieldsOfDraft = (row: DraftRow) => {
    if (row.kind === "file") { const file = boot.files.find((entry) => entry.key === row.key); return file ? editorFields({ kind: "file", file }) : undefined; }
    const collection = collectionOf(row.key);
    return collection ? editorFields({ kind: "item", collection, isNew: row.isNew }) : undefined;
  };

  const review = async (preselect: string | undefined, stillHere: () => boolean) => {
    const crumbsFor: Array<[string, string?]> = [["Overview", "#/"], ["Review & publish"]];
    const listed = await refreshDrafts();
    if (!stillHere()) return;
    if (!listed.ok) return failed(listed, crumbsFor);
    const rows = listed.data.drafts;
    if (!rows.length) return show({ title: "Review & publish", crumbs: crumbsFor }, message("Nothing to publish", "You have no saved drafts. Edit something and save a draft; it shows up here for review before it goes on the website.", link("#/", "Go to the overview")));

    // Each draft against the live content, compared through the editor's fields, with record names for references.
    const views = await Promise.all(rows.map((row) => api.get<FileView>(urlOfDraft(row))));
    const referenced = new Set<string>();
    for (const row of rows) for (const key of referencesIn(fieldsOfDraft(row) ?? {})) referenced.add(key);
    const labels: ReferenceLabels = {};
    await Promise.all([...referenced].map(async (key) => {
      const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
      labels[key] = Object.fromEntries(result.ok ? result.data.items.map((item) => [item.id, item.label || item.id]) : []);
    }));
    if (!stillHere()) return;

    const banner = h(doc, "div", { class: "vc-banner", role: "alert", hidden: true });
    const showBanner = (...content: Array<Node | string>) => { clear(banner); banner.append(...content.map((entry) => (typeof entry === "string" ? h(doc, "p", {}, entry) : entry))); banner.hidden = false; };
    const boxes: Array<{ row: DraftRow; box: HTMLInputElement; card: HTMLElement }> = [];
    const cards = rows.map((row, index) => {
      const view = views[index];
      const fields = fieldsOfDraft(row);
      const collection = row.kind === "item" ? collectionOf(row.key) : undefined;
      const changes = view.ok && fields && view.data.draft
        ? summarizeChanges({ fields, before: view.data.content ?? undefined, after: view.data.draft.content, references: labels, ...(collection && row.isNew ? { newRecord: { itemLabel: collection.itemLabel, title: row.label } } : {}) })
        : [];
      const id = `vc-pick-${index}`;
      const box = h(doc, "input", { type: "checkbox", id, class: "vc-pick" });
      box.checked = preselect ? row.resource === preselect : true;
      const card = h(doc, "section", { class: "vc-review-card", "data-resource": row.resource, "aria-labelledby": `${id}-title` },
        h(doc, "div", { class: "vc-review-head" },
          box,
          h(doc, "label", { for: id, id: `${id}-title`, class: "vc-review-title" }, row.label, h(doc, "span", { class: "vc-review-group" }, ` · ${row.group}`)),
          h(doc, "span", { class: "vc-review-meta" }, `Saved ${timeOf(row.updatedAt)}`),
          link(hrefOfDraft(row), "Open", { class: "vc-review-open" })),
        row.stale ? h(doc, "p", { class: "vc-review-stale" }, "The website changed after this draft was started, so it cannot be published as it is. Open it, discard the draft and make your change again.") : null,
        !view.ok ? h(doc, "p", { class: "vc-error" }, view.message)
          : changes.length ? h(doc, "ul", { class: "vc-changes" }, changes.map(changeItem))
            : h(doc, "p", { class: "vc-note" }, "No differences from the website. Publishing it only clears the draft."));
      if (row.stale) box.checked = false;
      boxes.push({ row, box, card });
      return card;
    });

    const publishButton = h(doc, "button", { type: "button", class: "vc-button vc-primary", "data-action": "publish-now" }, "Publish");
    const chosen = () => boxes.filter((entry) => entry.box.checked);
    let busy = false;
    const update = () => {
      const count = chosen().length;
      publishButton.textContent = busy ? "Publishing…" : count ? `Publish ${plural(count, "draft")}` : "Publish";
      publishButton.disabled = busy || count === 0;
    };
    for (const entry of boxes) entry.box.addEventListener("change", update);
    update();

    const labelOf = (resource: string) => rows.find((row) => row.resource === resource)?.label ?? resource;
    publishButton.addEventListener("click", async () => {
      const picked = chosen();
      if (!picked.length || busy) return;
      busy = true; update(); banner.hidden = true;
      setState("busy", "Publishing…");
      const result = await api.post<PublishResult>("/api/cms/publish", { resources: picked.map((entry) => entry.row.resource) });
      busy = false;
      if (!result.ok) {
        update();
        setState("error", "Not published");
        if (result.status === 401) { showBanner(result.message, h(doc, "a", { href: "/admin", class: "vc-button" }, "Sign in again")); return; }
        if (result.error === "source_changed") {
          const changed = Array.isArray(result.data.resources) ? (result.data.resources as string[]) : [];
          for (const entry of boxes) if (changed.includes(entry.row.resource)) entry.card.classList.add("vc-review-conflict");
          showBanner(`Not published: ${changed.map(labelOf).join(", ") || "some content"} changed on the website after you started editing. Open ${changed.length === 1 ? "it" : "each one"}, discard the draft and make your change again — or untick ${changed.length === 1 ? "it" : "them"} and publish the rest.`);
          return;
        }
        if (result.error === "locked_field" && Array.isArray(result.data.fields)) { showBanner("Not published: only the owner can change some of these fields.", h(doc, "ul", {}, (result.data.fields as Array<{ message: string }>).map((entry) => h(doc, "li", {}, entry.message)))); return; }
        if (result.error === "invalid_content") { showBanner(`Not published: ${labelOf(String(result.data.resource ?? ""))} has fields that need attention. Open it, fix them and save again.`, h(doc, "ul", {}, (Array.isArray(result.data.errors) ? (result.data.errors as Array<{ path: string; message: string }>) : []).map((entry) => h(doc, "li", {}, `${entry.path}: ${entry.message}`)))); return; }
        showBanner(`Not published. ${result.message}`);
        return;
      }
      const published = result.data;
      void refreshDrafts();
      const names = published.resources.map(labelOf);
      if (published.commitSha) watchLive({ expected: published.expectedLiveVersion, at: now(), userId: user.id, labels: names });
      setState("saved", published.commitSha ? "Published · going live" : "Nothing to change");
      clear(actions);
      const warnings = published.warnings.filter((warning) => warning.code === "rewrote_whole_file");
      const sanitizedNotes = published.warnings.filter((warning) => warning.code === "sanitized");
      show({ title: "Published", crumbs: crumbsFor }, [
        heading(published.commitSha ? "Published" : "Nothing changed on the website"),
        h(doc, "p", { class: "vc-lead" }, published.commitSha
          ? `${names.join(", ")} ${names.length === 1 ? "was" : "were"} sent to the website. It updates in a few minutes — the status on the left says when the changes are live.`
          : "These drafts were the same as the website, so nothing was sent. The drafts are cleared."),
        published.commitSha ? h(doc, "p", { class: "vc-note" }, `Change ${published.commitSha.slice(0, 7)} on ${boot.site.name}'s ${published.files.length === 1 ? "file" : "files"}: ${published.files.join(", ")}.`) : h(doc, "span", { hidden: true }),
        warnings.length ? h(doc, "div", { class: "vc-banner" }, h(doc, "p", {}, `Formatting note: ${warnings.map((warning) => labelOf(warning.resource)).join(", ")} — the whole file was rewritten because its original formatting could not be kept. The content is right; the change on GitHub just looks bigger.`)) : h(doc, "span", { hidden: true }),
        sanitizedNotes.length ? h(doc, "div", { class: "vc-banner" }, h(doc, "p", {}, `Safety note: unsafe HTML was removed before publishing — ${sanitizedNotes.map((warning) => `${labelOf(warning.resource)}: ${(warning.fields ?? []).join("; ")}`).join(" · ")}.`)) : h(doc, "span", { hidden: true }),
        link("#/", "Back to the overview", { class: "vc-button" }),
      ]);
      main.querySelector<HTMLElement>("h1")?.focus();
    });

    actions.append(publishButton);
    const stale = rows.filter((row) => row.stale).length;
    show({ title: "Review & publish", crumbs: crumbsFor }, [
      heading("Review & publish"),
      h(doc, "p", { class: "vc-lead" }, "Check what each draft changes, then publish. Publishing updates the website for everyone (it takes a few minutes); the ticked drafts go out together."),
      stale ? h(doc, "p", { class: "vc-note" }, `${plural(stale, "draft")} can't be published as ${stale === 1 ? "it is" : "they are"} (the website changed since) and ${stale === 1 ? "is" : "are"} unticked.`) : h(doc, "span", { hidden: true }),
      banner,
      h(doc, "div", { class: "vc-review-list" }, cards),
    ]);
  };

  // ---------------------------------------------------------------- P8: is it live yet?

  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const remember = (pending: PendingPublish | null) => { try { if (pending) storage?.setItem(PENDING_KEY, JSON.stringify(pending)); else storage?.removeItem(PENDING_KEY); } catch { /* private mode: just not remembered */ } };
  const showLive = (state: "publishing" | "live" | "late", text: string, ...extra: Node[]) => { clear(liveBox); liveBox.dataset.state = state; liveBox.append(h(doc, "span", { class: "vc-live-text" }, text), ...extra); liveBox.hidden = false; };
  const watchLive = (pending: PendingPublish) => {
    if (liveTimer) clearTimeout(liveTimer);
    remember(pending);
    showLive("publishing", `Publishing… started ${timeOf(pending.at)}. This usually takes a few minutes.`);
    const tick = async () => {
      liveTimer = undefined;
      const result = await api.get<{ liveVersion: string }>("/api/cms/live-version");
      if (result.ok && result.data.liveVersion === pending.expected) {
        remember(null);
        showLive("live", `Live on the website: ${pending.labels.join(", ")}.`);
        say("Your changes are live on the website.");
        return;
      }
      if (now() - pending.at >= maxWaitMs) {
        showLive("late", "Still publishing — the website has not updated yet. Check again in a few minutes.", h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: () => { void tick(); } }, "Check now"));
        return;
      }
      liveTimer = setTimeout(() => { void tick(); }, pollMs);
    };
    liveTimer = setTimeout(() => { void tick(); }, pollMs);
  };
  // A publish started before a reload (by this person) is still watched.
  try {
    const saved = JSON.parse(storage?.getItem(PENDING_KEY) ?? "null") as PendingPublish | null;
    if (saved && saved.userId === user.id && typeof saved.expected === "string" && now() - saved.at < 6 * 3600_000) watchLive(saved);
    else if (saved) remember(null);
  } catch { remember(null); }

  const fieldsRequiredNote = (fields: Record<string, Field>) => (Object.values(fields).some((field) => field.required)
    ? h(doc, "p", { class: "vc-note" }, h(doc, "span", { class: "vc-required", "aria-hidden": "true" }, "*"), " Required")
    : h(doc, "span", { hidden: true }));

  // Unsaved work: ask before leaving the page.
  win.addEventListener("beforeunload", (event) => { if (dirtyGuard && current?.dirty?.()) { event.preventDefault(); event.returnValue = ""; } });
  void refreshDrafts();
  let pending = route();
  win.addEventListener("hashchange", () => { pending = route(); });
  /** Resolves once the screen for the current address is shown (tests; the page never needs it). */
  const idle = async () => { let seen: Promise<void> | undefined; while (seen !== pending) { seen = pending; await seen; } };
  return { ready: pending, idle, route, isDirty: () => current?.dirty?.() ?? 0 };
};
