/**
 * P7: the admin shell — navigation, the overview, collection lists, and the editor for a file or a record, saving
 * drafts through the CMS API (P5). M1: addresses by path like the Mr Spa CMS (src/admin/routes.ts) — /admin opens the
 * first page's editor; the hash addresses of before still work. Preview (P9) and images (P10) build on this. Nothing
 * is saved without "Save draft"; leaving with unsaved changes asks first; nothing is published without a review.
 * M1: the frame of the Mr Spa CMS — the rail (Pages, the collections, Media, Drafts; Users and the account at the
 * bottom), the top bar (breadcrumb, Laptop / Tablet / Mobile, the one save state, View live / Version history /
 * Discard draft / Reload and keep my changes / Check again — folded into ⋯ on a narrow bar —, Save draft, Publish).
 */
import type { Field } from "../config/index.js";
import type { PickChoices } from "../check/picks.js";
import { checkRecordValues } from "../check/values.js";
import { createClient, humanMessage, type ApiFail, type Client, type Fetch } from "./api.js";
import type { AdminBoot, BootCollection, BootFile } from "./boot.js";
import { clear, h, icon } from "./dom.js";
import { confirmDialog, openDialog, type ConfirmOptions } from "./dialog.js";
import { createToast } from "./toast.js";
import { installTooltips } from "./tooltip.js";
import { summarizeChanges, type Change, type ReferenceLabels } from "./changes.js";
import { createForm, type Form, type ReferenceTarget } from "./form.js";
import { ACCEPTED_TYPES, adjustImage, measureImage, openImagePicker, prepareImage, type Adjust, type LibraryImage, type Measure, type Prepare, type PreparedImage } from "./media.js";
import { configBinds, fieldAt, type PreviewOwner } from "./bridge.js";
import { createPreview, previewUrl, type Preview } from "./preview.js";
import { createInspector, inspectorSections, type Inspector } from "./inspector.js";
import { openChangePassword, peopleScreen, type ScreenKit } from "./people.js";
import { activityScreen } from "./activity.js";
import { historyScreen, type HistoryTarget } from "./history.js";
import { ADMIN_BASE, adminHref, legacyHashPath, parseAdminPath, type AdminRoute } from "./routes.js";
import { applyLeafChanges, deriveSaveState, publishBlockReason, unsavedLeafChanges, type LeafChange, type PublishedState, type SaveState } from "./save-state.js";
import { clone, countChanges, getAt, ID_PATTERN, keyPath, parsePathText, pathText, slugify, type Path } from "./value.js";

export type AdminOptions = {
  root: HTMLElement;
  boot: AdminBoot;
  /** Injectable for tests; the page's fetch otherwise. */
  fetch?: Fetch;
  /** Injectable for tests (sync or not); the CMS dialog otherwise (U3, never the browser's confirm). */
  confirm?: (message: string, options?: ConfirmOptions) => boolean | Promise<boolean>;
  window?: Window;
  /** P8: how often to ask /live-version after publishing, and for how long before saying "still publishing". */
  pollMs?: number;
  maxWaitMs?: number;
  /** Where an unfinished publish is remembered across reloads (localStorage by default; null = nowhere). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
  /** P10: how a chosen file is prepared before uploading (resize + WebP in the browser by default). */
  prepareImage?: Prepare;
  /** P12f: tests replace the canvas work (happy-dom has no canvas). */
  adjustImage?: Adjust;
  measureImage?: Measure;
  /** P9: show the page in the canvas when the content has one (default; tests may turn it off). */
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
type PendingPublish = { expected: string; at: number; userId: string; labels: string[]; resources?: string[] };
const PENDING_KEY = "vibe-cms:publishing";

type Screen = { title: string; crumbs: Array<[string, string?]>; dirty?: () => number; save?: () => Promise<void>; leave?: () => void; refreshState?: () => void; resource?: string };

type FileView = { resource: string; label: string; content: unknown; version: string; draft: null | { content: unknown; revision: number; sourceVersion: string; stale: boolean; updatedAt: string }; choices?: PickChoices };
/** P12g: pick values in plain words in the review ("packages/the-essential-reset" → "The Essential Reset"). */
const choiceLabelsOf = (choices: PickChoices | undefined) => Object.fromEntries(Object.values(choices ?? {}).flat().map((choice) => [choice.value, choice.label]));
type ListView = { key: string; label: string; itemLabel: string; items: Array<{ id: string; resource: string; label: string; version: string | null; hasDraft: boolean; isNew?: boolean; image?: string }> };
type ContentView = { files: Array<{ key: string; label: string; hasDraft: boolean }>; collections: Array<{ key: string; label: string; itemLabel: string; count: number; drafts: number }> };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const startAdmin = (options: AdminOptions) => {
  const { root, boot } = options;
  const win = options.window ?? (root.ownerDocument.defaultView as Window);
  const doc = root.ownerDocument;
  const api: Client = createClient(options.fetch ?? ((input, init) => win.fetch(input, init)));
  const ask = (message: string, choice?: ConfirmOptions) => Promise.resolve(options.confirm ? options.confirm(message, choice) : confirmDialog(doc, message, choice));
  /** U3: leaving with unsaved changes — "Keep editing" is the safe choice, "Discard changes" is red. */
  const askLeave = (count: number) => ask(leaveMessage(count), { cancel: "Keep editing", confirm: "Discard changes", danger: true });
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
  const storage = options.storage === undefined ? (() => { try { return win.localStorage; } catch { return null; } })() : options.storage;
  const { user } = boot;
  const media = boot.media ?? { uploads: false, base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 };
  const prepare = options.prepareImage ?? prepareImage(win);
  /** P10: the image sheet for an image field. */
  // P12f: crop / resize in the browser (canvas); tests pass their own.
  const adjust = options.adjustImage ?? adjustImage(win);
  const measure = options.measureImage ?? measureImage(win);
  const uploadImage = async (prepared: PreparedImage): Promise<{ ok: true; image: LibraryImage } | { ok: false; message: string }> => {
    const headers: Record<string, string> = { "x-file-name": encodeURIComponent(prepared.name) };
    if (prepared.width && prepared.height) { headers["x-image-width"] = String(prepared.width); headers["x-image-height"] = String(prepared.height); }
    const result = await api.upload<{ image: LibraryImage & { reused?: boolean } }>("/api/cms/media", prepared.blob, headers);
    if (!result.ok) { if (result.status === 401 || result.error === "password_change_required") { dirtyGuard = false; win.location.assign("/admin"); } return { ok: false, message: result.message }; }
    return { ok: true, image: { ...result.data.image, source: "upload" } };
  };
  const pickImage = (current: string, done: (image: { src: string }) => void, label?: string) => openImagePicker({
    doc, api, media, prepare, current, onPick: done, adjust, measure, label, upload: uploadImage,
  });

  // ---------------------------------------------------------------- shell

  const link = (href: string, text: string, extra: Record<string, string> = {}) => h(doc, "a", { href, ...extra }, text);
  // U2 / M1: the rail (64 px, the Mr Spa CMS's): the site's mark, Pages, one place per collection (a collection
  // `under` another is a tab there), Media, Drafts with a count; at the bottom Users (owners) and the account menu.
  const railItem = (key: string, href: string, label: string, iconName: string, ...extra: Node[]) => h(doc, "a", { href, "data-rail": key, class: "vc-rail-item", "data-tooltip": label }, icon(doc, iconName), h(doc, "span", { class: "vc-rail-label" }, label), ...extra);
  // P8: my drafts waiting to be published, with a count.
  const draftBadge = h(doc, "span", { class: "vc-badge", "aria-hidden": "true", hidden: true });
  const draftsItem = railItem("drafts", adminHref.drafts(), "Drafts", "inbox", draftBadge);
  const navItems = [
    railItem("pages", adminHref.pages(), "Pages", "file-text"),
    ...boot.collections.filter((collection) => !collection.under).map((collection) => railItem(`list:${collection.key}`, adminHref.list(collection.key), collection.label, collection.icon ?? "list")),
    railItem("media", adminHref.media(), "Media", "image"),
    draftsItem,
  ];
  // P8b: People and Activity (U4: one place, two tabs, like the Mr Spa CMS), for owners only — the server refuses editors anyway.
  const usersItem = user.role === "owner" ? railItem("users", adminHref.users(), "Users", "user") : undefined;
  const refreshDrafts = async () => {
    const result = await api.get<{ drafts: DraftRow[] }>("/api/cms/drafts");
    const count = result.ok ? result.data.drafts.length : 0;
    draftBadge.textContent = String(count);
    draftBadge.hidden = count === 0;
    if (count) draftsItem.setAttribute("aria-label", `Drafts, ${count} saved`); else draftsItem.removeAttribute("aria-label");
    return result;
  };
  const signOut = h(doc, "button", { type: "button", class: "vc-menu-item", role: "menuitem", onclick: async () => {
    closeMenu();
    if (!(await mayLeave())) return;
    dirtyGuard = false;
    await api.post("/api/auth/logout", {});
    win.location.assign(ADMIN_BASE);
  } }, "Sign out");
  // Mr Spa: the first two letters of the username.
  const initials = user.username.slice(0, 2).toUpperCase() || "?";
  const menu = h(doc, "div", { class: "vc-menu", role: "menu", hidden: true, "aria-label": "Account" },
    h(doc, "div", { class: "vc-menu-head" }, h(doc, "strong", { class: "vc-user-name-text" }, user.displayName), h(doc, "span", { class: "vc-user-role" }, user.role === "owner" ? "Admin" : "Editor")),
    // M2 (Mr Spa): Change password opens its dialog here (no My account screen).
    h(doc, "button", { type: "button", class: "vc-menu-item vc-user-name", role: "menuitem", onclick: () => { closeMenu(); openChangePassword(kit); } }, "Change password"),
    signOut);
  const avatar = h(doc, "button", { type: "button", class: "vc-avatar", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Account menu", "data-tooltip": "Account" }, initials);
  const closeMenu = () => { menu.hidden = true; avatar.setAttribute("aria-expanded", "false"); };
  avatar.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    avatar.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector<HTMLElement>(".vc-menu-item")?.focus();
  });
  menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); avatar.focus(); } });
  doc.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node) && event.target !== avatar) closeMenu();
    for (const open of doc.querySelectorAll<HTMLElement>(".vc-more > .vc-menu:not([hidden])")) if (!open.parentElement!.contains(event.target as Node)) { open.hidden = true; open.parentElement!.querySelector(".vc-more-button")?.setAttribute("aria-expanded", "false"); }
    if (topMore.classList.contains("vc-open") && !topMore.contains(event.target as Node)) setMoreOpen(false);
  });
  const mark = h(doc, "span", { class: "vc-mark", role: "img", "aria-label": `${boot.site.name} CMS` }, (boot.site.name.trim()[0] ?? "V").toUpperCase());
  const nav = h(doc, "nav", { class: "vc-rail", "aria-label": "CMS sections" },
    mark,
    h(doc, "ul", { class: "vc-nav-list" }, navItems.map((item) => h(doc, "li", {}, item))),
    h(doc, "div", { class: "vc-rail-bottom" }, usersItem ?? null, h(doc, "div", { class: "vc-user" }, avatar, menu)));

  // M1: the top bar (56 px) — breadcrumb · device switch · the one save state, the secondary icons, the screen's buttons.
  const crumbs = h(doc, "nav", { class: "vc-crumbs", "aria-label": "Breadcrumb" });
  const stateLong = h(doc, "span", { class: "vc-state-long" });
  const stateShort = h(doc, "span", { class: "vc-state-short", "aria-hidden": "true" });
  const saveState = h(doc, "span", { class: "vc-save-state", "data-kind": "none", hidden: true },
    h(doc, "span", { class: "vc-state-dot", "aria-hidden": "true" }),
    h(doc, "span", { class: "vc-state-text", role: "status", "aria-live": "polite" }, stateLong, stateShort));
  /** null hides it (list screens: Mr Spa shows the save state only while a record is open). */
  const showState = (state: Pick<SaveState, "kind" | "label" | "shortLabel"> | null) => {
    saveState.hidden = !state;
    if (!state) return;
    saveState.dataset.kind = state.kind;
    stateLong.textContent = state.label;
    stateShort.textContent = state.shortLabel;
  };
  // The secondary icons: inline on a wide top bar, folded into ⋯ on a narrow one (CSS container query).
  const morePanel = h(doc, "div", { class: "vc-top-more-panel" });
  const moreToggle = h(doc, "button", { type: "button", class: "vc-icon-button vc-top-icon vc-top-more-toggle", "aria-label": "More actions", "aria-haspopup": "true", "aria-expanded": "false", "data-tooltip": "More actions", hidden: true }, icon(doc, "more"));
  const topMore = h(doc, "div", { class: "vc-top-more" }, moreToggle, morePanel);
  const setMoreOpen = (open: boolean) => { topMore.classList.toggle("vc-open", open); moreToggle.setAttribute("aria-expanded", String(open)); };
  moreToggle.addEventListener("click", () => setMoreOpen(!topMore.classList.contains("vc-open")));
  morePanel.addEventListener("click", (event) => { if ((event.target as Element).closest?.("a, button")) setMoreOpen(false); });
  topMore.addEventListener("keydown", (event) => { if (event.key === "Escape" && topMore.classList.contains("vc-open")) { setMoreOpen(false); moreToggle.focus(); } });
  const setTopIcons = (items: Array<HTMLElement | null | undefined>) => {
    clear(morePanel);
    for (const item of items) if (item) morePanel.append(item);
    syncMore();
  };
  const syncMore = () => {
    const any = [...morePanel.children].some((child) => !(child as HTMLElement).hidden);
    moreToggle.hidden = !any;
    if (!any) setMoreOpen(false);
  };
  /** A secondary icon of the top bar (its tooltip is its name; folded, the name is its text). */
  const topIcon = (name: string, label: string, iconName: string, run: () => void, tooltip = label) => h(doc, "button", { type: "button", class: "vc-icon-button vc-top-icon", "data-action": name, "aria-label": label, "data-tooltip": tooltip, onclick: run }, icon(doc, iconName));
  // U2: the preview's device switch sits in the middle of the top bar (editor with a page).
  const topCenter = h(doc, "div", { class: "vc-top-center" });
  const actions = h(doc, "div", { class: "vc-actions" });
  const body = h(doc, "div", { class: "vc-body" });
  const toasts = createToast(doc);
  const toast = toasts.element;
  const main = h(doc, "main", { class: "vc-main", id: "vc-main" }, h(doc, "header", { class: "vc-top" }, crumbs, topCenter, h(doc, "div", { class: "vc-top-right" }, saveState, topMore, actions)), body);
  clear(root);
  root.append(h(doc, "div", { class: "vc-app" }, nav, main), toast);
  installTooltips(doc);

  const say = toasts.say;
  const leaveMessage = (count: number) => `Leave without saving?\n\nYou have ${count ? plural(count, "unsaved change") : "unsaved changes"}${current?.title ? ` on ${current.title}` : ""}. If you leave, they are lost.`;

  // ---------------------------------------------------------------- routing

  let current: Screen | undefined;
  let currentPath = "";
  let dirtyGuard = true;
  let asking = false;
  let generation = 0;
  const here = () => `${win.location.pathname}${win.location.search}`;

  /** Ask before leaving unsaved changes (true = go on). */
  const mayLeave = async () => {
    if (!dirtyGuard || !current?.dirty?.()) return true;
    if (asking) return false;
    asking = true;
    const leave = await askLeave(current.dirty());
    asking = false;
    return leave;
  };
  /** Open another screen of the admin (pushes its address; `replace` keeps one history entry; `force` skips the question). */
  const go = async (path: string, how: { replace?: boolean; force?: boolean } = {}) => {
    if (!how.force && path !== currentPath && !(await mayLeave())) return;
    if (how.replace) win.history.replaceState(null, "", path); else if (path !== here()) win.history.pushState(null, "", path);
    pending = route({ force: true });
    await pending;
  };
  // Links inside the admin open their screen without reloading the page (new tab / modifier keys: the browser's way).
  root.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    let url: URL;
    try { url = new URL(anchor.getAttribute("href") ?? "", win.location.href); } catch { return; }
    if (url.origin !== win.location.origin || !(url.pathname === ADMIN_BASE || url.pathname.startsWith(`${ADMIN_BASE}/`))) return;
    event.preventDefault();
    void go(`${url.pathname}${url.search}`);
  });

  /** The rail item of a screen (Mr Spa: a record opens under its collection; People and Activity under Users). */
  const railKeyOf = (target: AdminRoute) => {
    if (target.kind === "pages" || target.kind === "file") return "pages";
    if (target.kind === "list" || target.kind === "new" || target.kind === "item") return `list:${collectionOf(target.key)?.under ?? target.key}`;
    if (target.kind === "drafts" || target.kind === "review") return "drafts";
    if (target.kind === "users" || target.kind === "audit") return "users";
    if (target.kind === "media") return "media";
    if (target.kind === "history") { const [kind, key] = target.resource.split(":"); return kind === "file" ? "pages" : kind === "item" ? `list:${collectionOf(key)?.under ?? key}` : ""; }
    return "";
  };

  const show = (screen: Screen, content: Node[]) => {
    current = screen;
    clear(crumbs);
    screen.crumbs.forEach(([text, href], index) => {
      if (index) crumbs.append(h(doc, "span", { class: "vc-crumb-sep", "aria-hidden": "true" }, "/"));
      // Mr Spa: the parent is a button back to its screen (it asks first when there are unsaved changes).
      crumbs.append(href && index < screen.crumbs.length - 1
        ? h(doc, "button", { type: "button", class: "vc-crumb-parent", "aria-label": `Back to ${text}`, onclick: () => { void go(href); } }, text)
        : h(doc, "span", { class: "vc-crumb-title", "aria-current": "page" }, text));
    });
    clear(body);
    body.append(h(doc, "div", { class: "vc-page-inner" }, ...content));
    doc.title = `${boot.site.name} CMS`;
    const railKey = railKeyOf(parseAdminPath(win.location.pathname));
    for (const item of [...navItems, ...(usersItem ? [usersItem] : [])]) { if (item.dataset.rail === railKey) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); }
  };
  const heading = (text: string) => h(doc, "h1", { class: "vc-title", tabindex: "-1" }, text);
  const message = (title: string, text: string, ...extra: Node[]) => [heading(title), h(doc, "p", { class: "vc-lead" }, text), ...extra];
  /** U4: list screens name themselves in the top bar (Mr Spa); the heading stays for screen readers and focus. */
  const quietHeading = (text: string) => { const element = heading(text); element.classList.add("vc-sr-only"); return element; };
  const siteHost = () => { try { return new URL(boot.site.url).host; } catch { return boot.site.url; } };
  /** U4: a ⋯ button with a small menu (the destructive entry is red). */
  const moreMenu = (label: string, entries: Array<{ text: string; danger?: boolean; run: () => void }>) => {
    const list = h(doc, "div", { class: "vc-menu", role: "menu", hidden: true });
    const button = h(doc, "button", { type: "button", class: "vc-icon-button vc-more-button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": label, "data-tooltip": "More" }, h(doc, "span", { "aria-hidden": "true" }, "⋯"));
    button.addEventListener("click", (event) => { event.stopPropagation(); list.hidden = !list.hidden; button.setAttribute("aria-expanded", String(!list.hidden)); if (!list.hidden) list.querySelector<HTMLElement>("button")?.focus(); });
    list.addEventListener("keydown", (event) => { if (event.key === "Escape") { list.hidden = true; button.setAttribute("aria-expanded", "false"); button.focus(); } });
    for (const entry of entries) list.append(h(doc, "button", { type: "button", class: `vc-menu-item${entry.danger ? " vc-danger" : ""}`, role: "menuitem", onclick: () => { list.hidden = true; button.setAttribute("aria-expanded", "false"); entry.run(); } }, entry.text));
    return h(doc, "span", { class: "vc-more" }, button, list);
  };
  const searchBox = (placeholder: string) => h(doc, "input", { type: "search", class: "vc-input vc-search", placeholder, "aria-label": placeholder });

  const route = async (how: { force?: boolean } = {}) => {
    // Hash addresses of before (#/files/site) open the same screen at its new address.
    const legacy = legacyHashPath(win.location.hash);
    if (legacy) win.history.replaceState(null, "", legacy);
    let target = parseAdminPath(win.location.pathname);
    // M2: /admin/account (My account of before) is the Change password dialog, over the first page.
    const openPassword = target.kind === "account";
    // Mr Spa: /admin opens the first page's editor.
    if (target.kind === "home" || target.kind === "account") {
      win.history.replaceState(null, "", boot.files[0] ? adminHref.file(boot.files[0].key) : adminHref.pages());
      target = parseAdminPath(win.location.pathname);
    }
    const path = here();
    if (asking) return;
    if (!how.force && path !== currentPath && !(await mayLeave())) {
      // Back / forward with unsaved changes, and the person stays: the address goes back to this screen.
      win.history.pushState(null, "", currentPath);
      return;
    }
    current?.leave?.();
    const leaving = currentPath;
    currentPath = path;
    if (leaving !== path && liveState?.state === "live") liveState = undefined;
    const mine = (generation += 1);
    clear(actions);
    clear(topCenter);
    setTopIcons([]);
    showState(null);
    closeMenu();
    clear(body);
    body.append(h(doc, "p", { class: "vc-loading" }, "Loading…"));
    const stillHere = () => mine === generation;
    try {
      if (target.kind === "pages") await overview(stillHere);
      else if (target.kind === "file") await editFile(target.key, stillHere);
      else if (target.kind === "list") await listCollection(target.key, stillHere);
      else if (target.kind === "new") await editItem(target.key, undefined, stillHere);
      else if (target.kind === "item") await editItem(target.key, target.id, stillHere);
      else if (target.kind === "review") await review(target.resource, stillHere);
      else if (target.kind === "drafts") await draftsScreen(stillHere);
      else if (target.kind === "media") await mediaScreen(stillHere);
      else if (target.kind === "users") await peopleScreen(kit, stillHere);
      else if (target.kind === "audit") await activityScreen(kit, stillHere, target.filter);
      else if (target.kind === "history") await historyScreen(kit, stillHere, target.resource, historyTarget(target.resource), (next) => { void go(next, { force: true }); });
      else show({ title: "Not found", crumbs: [["Pages", adminHref.pages()], ["Not found"]] }, message("Not found", "There is nothing at this address in the CMS.", link(adminHref.pages(), "Go to Pages")));
    } catch {
      if (stillHere()) show({ title: "Error", crumbs: [["Pages", adminHref.pages()], ["Error"]] }, message("Something went wrong", "The page could not be shown. Reload to try again."));
    }
    // The screen's heading gets focus (screen readers announce the page), unless the screen asked for a field (P9).
    const after = focusAfterShow;
    focusAfterShow = undefined;
    if (stillHere() && !after?.()) main.querySelector<HTMLElement>("h1")?.focus();
    if (stillHere() && openPassword) openChangePassword(kit);
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
    if (!result.ok) return failed(result, [["Pages"]]);
    const pill = (draft: boolean) => h(doc, "span", { class: `vc-pill ${draft ? "vc-pill-draft" : "vc-pill-live"}` }, draft ? "Draft saved" : "Live");
    const host = siteHost();
    const pages = result.data.files.map((file) => {
      const path = boot.files.find((entry) => entry.key === file.key)?.preview;
      const where = path && !path.includes("{") ? `${host}${path}` : "Shown across the website";
      return { file, where, row: h(doc, "li", {}, h(doc, "a", { class: "vc-row", href: adminHref.file(file.key) },
        h(doc, "span", { class: "vc-row-icon", "aria-hidden": "true" }, icon(doc, "file")),
        h(doc, "span", { class: "vc-row-text" }, h(doc, "span", { class: "vc-row-title" }, file.label), h(doc, "span", { class: "vc-row-sub" }, where)),
        pill(file.hasDraft), h(doc, "span", { class: "vc-row-chevron", "aria-hidden": "true" }, icon(doc, "chevron")))) };
    });
    const list = h(doc, "ul", { class: "vc-rows" });
    const count = h(doc, "p", { class: "vc-count", "aria-live": "polite" });
    const search = searchBox("Find a page");
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const shown = pages.filter((page) => !query || page.file.label.toLowerCase().includes(query) || page.where.toLowerCase().includes(query));
      clear(list);
      list.append(...shown.map((page) => page.row));
      if (!shown.length) list.append(h(doc, "li", { class: "vc-rows-empty" }, `No page matches “${search.value.trim()}”.`));
      count.textContent = query ? `${shown.length} of ${plural(pages.length, "page")}` : plural(pages.length, "page");
    };
    search.addEventListener("input", render);
    render();
    show({ title: "Pages", crumbs: [["Pages"]] }, [quietHeading("Pages"), h(doc, "div", { class: "vc-toolbar" }, search, count), list,
      h(doc, "p", { class: "vc-help vc-rows-note" }, "Saving makes a draft; the website changes only when a draft is published.")]);
  };

  // ---------------------------------------------------------------- collection list

  const collectionOf = (key: string) => boot.collections.find((collection) => collection.key === key);

  /** M1: a collection with others `under` it shows them as tabs (Mr Spa: Products · Categories · Collections). */
  const tabsOf = (collection: BootCollection) => {
    const head = collection.under ? collectionOf(collection.under) : collection;
    if (!head) return null;
    const group = [head, ...boot.collections.filter((other) => other.under === head.key)];
    if (group.length < 2) return null;
    return h(doc, "nav", { class: "vc-tabs", "aria-label": head.label }, group.map((entry) => h(doc, "a", { href: adminHref.list(entry.key), class: "vc-tab", ...(entry.key === collection.key ? { "aria-current": "page" } : {}) }, entry.label)));
  };
  /** The breadcrumb of a collection: a tab names its head first ("Products / Categories"). */
  const crumbsOfCollection = (collection: BootCollection): Array<[string, string?]> => {
    const head = collection.under ? collectionOf(collection.under) : undefined;
    return head ? [[head.label, adminHref.list(head.key)], [collection.label, adminHref.list(collection.key)]] : [[collection.label, adminHref.list(collection.key)]];
  };

  const listCollection = async (key: string, stillHere: () => boolean) => {
    const collection = collectionOf(key);
    const crumbsFor: Array<[string, string?]> = collection ? crumbsOfCollection(collection) : [[key]];
    if (!collection) return show({ title: "Not found", crumbs: crumbsFor }, message("Not found", `There is no "${key}" in this site's CMS.`));
    const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
    if (!stillHere()) return;
    if (!result.ok) return failed(result, crumbsFor);
    const items = result.data.items;
    const noun = collection.itemLabel.toLowerCase();
    const count = h(doc, "p", { class: "vc-count", "aria-live": "polite" });
    const tbody = h(doc, "tbody");
    const search = searchBox(`Search ${collection.label.toLowerCase()}`);
    const hasImage = Object.values(collection.fields).some((field) => field.type === "image");
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const shown = items.filter((item) => !query || item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
      clear(tbody);
      for (const item of shown) {
        const status = item.isNew ? h(doc, "span", { class: "vc-pill vc-pill-draft" }, "New · not published")
          : h(doc, "span", { class: "vc-status" }, h(doc, "span", { class: "vc-pill vc-pill-live" }, "Live"), item.hasDraft ? h(doc, "span", { class: "vc-unpublished" }, "Draft saved") : null);
        const thumb = hasImage ? h(doc, "span", { class: "vc-list-thumb", "aria-hidden": "true" }, item.image ? h(doc, "img", { src: item.image, alt: "", loading: "lazy", decoding: "async" }) : icon(doc, "image")) : null;
        tbody.append(h(doc, "tr", { "data-id": item.id }, h(doc, "td", {}, h(doc, "a", { href: adminHref.item(key, item.id), class: "vc-list-name" }, thumb, h(doc, "span", {}, item.label || item.id))), h(doc, "td", { class: "vc-mono" }, item.id), h(doc, "td", {}, status)));
      }
      if (!shown.length) tbody.append(h(doc, "tr", {}, h(doc, "td", { colspan: "3", class: "vc-empty" }, items.length ? `No ${noun} matches “${search.value.trim()}”.` : `No ${noun} yet.`)));
      count.textContent = query ? `${shown.length} of ${plural(items.length, noun)}` : plural(items.length, noun);
    };
    search.addEventListener("input", render);
    render();
    if (!collection.fixed) actions.append(h(doc, "a", { href: adminHref.newItem(key), class: "vc-button vc-primary" }, icon(doc, "plus"), `New ${noun}`));
    show({ title: collection.label, crumbs: crumbsFor }, [
      quietHeading(collection.label),
      tabsOf(collection) ?? h(doc, "span", { hidden: true }),
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
      else if (field.type === "tuple") field.items.forEach(walk);
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
    if (!file) return show({ title: "Not found", crumbs: [["Pages", adminHref.pages()], ["Not found"]] }, message("Not found", `There is no "${key}" in this site's CMS.`));
    await editor({ kind: "file", file, url: `/api/cms/files/${encodeURIComponent(key)}`, crumbs: [["Pages", adminHref.pages()]], stillHere });
  };

  const editItem = async (key: string, id: string | undefined, stillHere: () => boolean) => {
    const collection = collectionOf(key);
    if (!collection) return show({ title: "Not found", crumbs: [["Pages", adminHref.pages()], ["Not found"]] }, message("Not found", `There is no "${key}" in this site's CMS.`));
    if (id === undefined && collection.fixed) return show({ title: collection.label, crumbs: crumbsOfCollection(collection) }, message(`${collection.label} is a fixed set`, `A new ${collection.itemLabel.toLowerCase()} cannot be added here — which ones exist is decided in the website's code. Open one to change it.`, link(adminHref.list(key), `Back to ${collection.label}`)));
    await editor({ kind: "item", collection, id, url: id === undefined ? undefined : `/api/cms/collections/${encodeURIComponent(key)}/items/${encodeURIComponent(id)}`, crumbs: crumbsOfCollection(collection), stillHere });
  };

  // ---------------------------------------------------------------- P9: preview helpers

  /** "Homepage · Banner › Heading", "Service · Price", "Footer links › Group 2 › Group title". */
  const describeField = (fields: Record<string, Field>, path: Path, prefix: string) => {
    const labels: string[] = [];
    for (let length = 1; length <= path.length; length += 1) {
      const step = path[length - 1];
      const found = fieldAt(fields, path.slice(0, length));
      if (typeof step === "number" && fieldAt(fields, path.slice(0, length - 1))?.field.type === "tuple") { const place = (fieldAt(fields, path.slice(0, length - 1))!.field as Extract<Field, { type: "tuple" }>).items[step]; if (place) labels.push(place.label); continue; }
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
  const pathOfOwner = (owner: PreviewOwner) => {
    const [kind, key, ...rest] = owner.split(":");
    return kind === "file" ? adminHref.file(key) : adminHref.item(key, rest.join(":"));
  };
  /** After a click in the preview on another record's content: the field to open when its editor shows. */
  let pendingFocus: string | undefined;
  /** Set by a screen that wants focus somewhere other than its heading once it is shown. */
  let focusAfterShow: (() => boolean) | undefined;
  /** M1: "Reload and keep my changes" — my changes, put back on the version the editor loads next. */
  let carry: { path: string; changes: LeafChange[] } | undefined;

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
    // My changes kept from before a reload go back on top of what was just loaded (they show as unsaved changes).
    const kept = carry && carry.path === currentPath ? carry.changes : undefined;
    carry = undefined;
    const start = kept ? applyLeafChanges(saved, kept) : saved;
    let saving = false;
    let discarding = false;
    let conflict = false;
    let problem = "";
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
    // U2: one primary button per screen, like the Mr Spa CMS — Publish; Save draft is the plain button next to it.
    const save = h(doc, "button", { type: "button", class: "vc-button", "data-action": "save" }, "Save draft");
    const resourceOf = () => (input.kind === "file" ? `file:${input.file.key}` : `item:${input.collection.key}:${input.id ?? String(form.value()[input.collection.idField] ?? "")}`);
    // U3: Publish opens the review of this draft — what changes, then publish.
    const publish = h(doc, "button", { type: "button", class: "vc-button vc-primary", "data-action": "publish", onclick: () => publishHere() }, "Publish");
    const live = view?.content ?? undefined;
    /** The record is on the website (a saved draft then says only its changes are not live yet). */
    const recordLive = Boolean(collection && !isNew && live !== undefined && live !== null);
    // M1: the secondary icons of the top bar.
    const liveUrl = (() => {
      if (isNew || live === undefined || live === null) return undefined;
      const pattern = input.kind === "file" ? input.file.preview : input.collection.preview;
      if (input.kind === "item" && input.collection.status && (live as Record<string, unknown>)[input.collection.status.field] !== input.collection.status.live) return undefined;
      return previewUrl(pattern, live as Record<string, unknown>);
    })();
    const viewLive = liveUrl ? h(doc, "a", { href: liveUrl, target: "_blank", rel: "noopener", class: "vc-icon-button vc-top-icon", "data-action": "view-live", "aria-label": "View live", "data-tooltip": "View live" }, icon(doc, "external")) : null;
    // P12c: History, for owners, once the resource exists on the website.
    const historyLink = user.role === "owner" && !isNew && view?.content ? h(doc, "a", { href: adminHref.history(resourceOf()), class: "vc-icon-button vc-top-icon", "data-action": "history", "aria-label": "View version history", "data-tooltip": "Version history" }, icon(doc, "history")) : null;
    const discard = topIcon("discard", "Discard draft", "undo", () => { void discardHere(); });
    const reloadKeep = topIcon("reload-keep", "Reload and keep my changes", "rotate-ccw", () => { void reloadKeepingChanges(); });
    const checkAgain = topIcon("check-again", "Check again whether the publish is live", "refresh", () => { void checkLive(); }, "Check again");

    const dirty = () => countChanges(saved, form.value());
    const changesToPublish = () => {
      const labels: ReferenceLabels = Object.fromEntries(Object.entries(references).map(([key, target]) => [key, Object.fromEntries(target.items.map((item) => [item.id, item.label]))]));
      return summarizeChanges({ fields, before: live, after: saved, references: labels, choiceLabels: choiceLabelsOf(view?.choices), ...(collection && !live ? { newRecord: { itemLabel: collection.itemLabel, title: titleText() } } : {}) });
    };
    const stale = Boolean(view?.draft?.stale);
    const refresh = () => {
      const count = dirty();
      title.textContent = titleText();
      inspector?.setTitle(titleText());
      const published = hasDraft ? undefined : publishedStateOf(resourceOf());
      const reason = stale ? "The website changed after this draft was started. Discard it and make your change again."
        : publishBlockReason({ conflict, dirty: count > 0, hasDraft, invalid: Boolean(problem), changes: hasDraft && !count ? changesToPublish().length : 0 });
      const state = deriveSaveState({
        unsaved: count, hasDraft, canSave: !conflict && !saving && !discarding, publishBlockReason: reason, recordLive, host: siteHost(),
        busy: saving ? "Saving draft…" : discarding ? "Discarding draft…" : undefined,
        problem: problem || undefined, published,
      });
      showState(state);
      save.disabled = !state.saveEnabled;
      save.textContent = saving ? "Saving…" : "Save draft";
      save.dataset.tooltip = count && conflict ? "Resolve conflicts or loading errors before saving." : "Save your changes as a draft.";
      publish.disabled = !state.publishEnabled;
      publish.textContent = discarding ? "Discarding…" : "Publish";
      publish.dataset.tooltip = state.publishTooltip;
      discard.hidden = !(hasDraft || count > 0) || saving || discarding;
      reloadKeep.hidden = !conflict;
      checkAgain.hidden = published !== "waiting";
      syncMore();
    };

    const form: Form = createForm({
      doc, fields, sections: input.kind === "file" ? input.file.sections : undefined, value: start, role: user.role, references, readOnly, pickImage, choices: view?.choices, notify: (text, action) => say(text, "info", action),
      markdown: collection?.markdown && !("body" in collection.fields) ? ["body"] : [],
      // M3 (Mr Spa): deleting a list item asks first; a click on an item's card shows it on the page; the validation
      // summary's buttons go to their field (opening its section).
      confirm: (text, choice) => ask(text, choice),
      onItem: (path) => { preview?.scrollTo(path); },
      reveal: (text) => { reveal(text); },
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

    // P9: the page in the canvas, showing this draft as it is typed.
    const owner = (): PreviewOwner => (input.kind === "file" ? `file:${input.file.key}` : `item:${input.collection.key}:${input.id ?? (String(form.value()[input.collection.idField] ?? "") || "new")}`);
    const pattern = input.kind === "file" ? input.file.preview : input.collection.preview;
    let preview: Preview | undefined;
    let suppressScroll = false;
    let lastFocused = "";
    if (pattern && options.preview !== false) {
      const placeholders = /\{[^}]+\}/.test(pattern);
      const url = isNew && placeholders ? undefined : previewUrl(pattern, saved) ?? (placeholders ? undefined : pattern);
      preview = createPreview({
        doc, win, url, title: input.kind === "file" ? input.file.label : `${input.collection.itemLabel}`, storage: storage ?? null,
        unavailable: isNew ? `A new ${collection!.itemLabel.toLowerCase()} gets its own page once it is published.` : "This record's page could not be found from its fields.",
        owner: owner(), value: () => form.value(), fields, markdown: collection?.markdown && !("body" in collection.fields) ? ["body"] : [],
        newItem: isNew && collection && !placeholders ? { collection: collection.key } : undefined,
        binds: input.kind === "file" ? configBinds(input.file.key, input.file.fields) : undefined,
        describe: describeOwner, sectionOf: sectionKeyOf,
        referenceLabel: (to, id) => references[to]?.items.find((item) => item.id === id)?.label ?? id,
        onSelect: ({ owner: selectedOwner, path }) => {
          const text = pathText(path);
          if (selectedOwner !== owner()) { pendingFocus = text; void go(pathOfOwner(selectedOwner)); return; }
          suppressScroll = true;
          reveal(text);
          suppressScroll = false;
        },
        // M3: the rows of the inspector follow the order of the page.
        onReady: (bridge) => inspector?.setOrder(bridge.order()),
      });
    }
    // M3: with the page on the canvas, the form sits in the Mr Spa inspector — sections at level 1, one at level 2.
    const sectionList = inspectorSections(fields, input.kind === "file" ? input.file.sections : undefined, titleText() || input.crumbs.at(-1)?.[0] || "");
    const sessionStore = (() => { try { return win.sessionStorage; } catch { return null; } })();
    const inspector: Inspector | undefined = preview ? createInspector({
      doc, form, fields, sections: sectionList, crumb: input.crumbs.at(-1)?.[0] ?? "Pages", title: titleText(), before: [banner],
      value: () => form.value(), saved: () => saved, session: sessionStore, local: storage ?? null, resource: resourceOf(),
      onEnter: (section) => { preview?.bridge()?.showSection(section.fields.map((key) => parsePathText(key)), section.label, section.key.startsWith("_") ? undefined : section.key); },
      onLeave: () => { preview?.bridge()?.clearSelection(); lastFocused = ""; },
    }) : undefined;
    /** Focus a field (or the closest one that has its own control), opening its section first (M3). */
    const reveal = (text: string) => {
      inspector?.openFor(text);
      let key = text;
      while (key) { if (form.focus(key)) { lastFocused = key; return true; } key = /^(.*?)(\.[^.[\]]+|\[[^\]]*\])$/.exec(key)?.[1] ?? ""; }
      return false;
    };
    form.element.addEventListener("focusin", (event) => {
      const target = event.target as Element | null;
      // M3 (Mr Spa): the field being edited is marked in the inspector.
      const top = target?.closest?.(".vc-section > .vc-field, .vc-form > .vc-field");
      for (const other of form.element.querySelectorAll(".vc-field-active")) if (other !== top) other.classList.remove("vc-field-active");
      top?.classList.add("vc-field-active");
      const at = target?.closest?.("[data-path]")?.getAttribute("data-path");
      if (!at || at === lastFocused) { suppressScroll = false; return; }
      lastFocused = at;
      if (!suppressScroll) preview?.scrollTo(parsePathText(at));
      suppressScroll = false;
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
    /** Mr Spa: "1 validation error" / "N validation errors". */
    const validationProblem = (count: number) => (count === 1 ? "1 validation error" : `${count} validation errors`);

    const doSave = async () => {
      if (saving || conflict || !dirty()) return;
      banner.hidden = true;
      const problems = validate();
      if (problems.length) {
        form.showErrors(problems);
        problem = validationProblem(problems.length);
        refresh();
        form.focus(problems[0].path.replace(/\[\d+\].*$/, "")) || form.focus(problems[0].path);
        return;
      }
      form.clearErrors();
      problem = "";
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
        }
        void refreshDrafts();
        if (isNew && collection) await go(adminHref.item(collection.key, id!), { replace: true, force: true });
        return;
      }
      if (result.status === 401 || result.error === "password_change_required") { problem = result.message; showBanner(result.message, h(doc, "a", { href: ADMIN_BASE, class: "vc-button", target: "_self" }, "Sign in again")); }
      else if (result.error === "locked_field" && Array.isArray(result.data.fields)) { form.showErrors((result.data.fields as Array<{ path: string; message: string }>).map((entry) => ({ path: entry.path, message: entry.message }))); problem = result.message; }
      else if (result.error === "invalid_content" && Array.isArray(result.data.errors)) { const errors = result.data.errors as Array<{ path: string; message: string }>; form.showErrors(errors); problem = validationProblem(errors.length); }
      // Mr Spa: a save met a newer version — reload it inside the CMS and put the unsaved edits back.
      else if (result.error === "draft_conflict") { conflict = true; problem = "This page was updated elsewhere. Reload to get the latest version — your unsaved changes will be kept to re-apply."; }
      else problem = result.message;
      refresh();
    };

    /** M1: reload this record and put my unsaved edits back on it (they show as unsaved changes again). */
    const reloadKeepingChanges = async () => {
      carry = { path: currentPath, changes: unsavedLeafChanges(saved, form.value()) };
      dirtyGuard = false;
      await go(currentPath, { replace: true, force: true });
      dirtyGuard = true;
    };

    const publishHere = () => {
      if (publish.disabled || dirty()) return;
      openPublishDialog({ resource: resourceOf(), title: titleText(), changes: changesToPublish(), onFailed: refresh, onDone: () => { void go(currentPath, { replace: true, force: true }); } });
    };

    // Mr Spa: the one Discard icon — a saved draft is deleted (the website keeps what it shows); unsaved edits only
    // are dropped (the last saved version shows again).
    const discardHere = async () => {
      if (hasDraft && input.url) {
        const text = isNew || live === undefined || live === null
          ? `Discard this new ${collection?.itemLabel.toLowerCase() ?? "page"}? It is not on the website yet, so nothing there changes — but everything you typed is lost.`
          : `The website stays as it is. The changes saved in your draft of ${input.kind === "file" ? `the ${input.file.label}` : `this ${input.collection.itemLabel.toLowerCase()}`} are deleted.`;
        if (!(await ask(`Discard your draft?\n\n${text}`, { confirm: "Discard draft", danger: true }))) return;
        discarding = true;
        refresh();
        const result = await api.delete(input.url);
        discarding = false;
        if (!result.ok) { problem = result.message; refresh(); return; }
        void refreshDrafts();
        if (live === undefined || live === null) await go(adminHref.list(collection!.key), { force: true });
        else await go(currentPath, { replace: true, force: true });
        return;
      }
      if (!dirty()) return;
      if (!(await ask("Discard unsaved changes?\n\nYour changes on this screen have not been saved. Discarding them shows the last saved version again.", { confirm: "Discard changes", danger: true }))) return;
      if (isNew && collection) await go(adminHref.list(collection.key), { force: true });
      else await go(currentPath, { replace: true, force: true });
    };
    const checkLive = async () => { await liveTick(); refresh(); };

    save.addEventListener("click", () => { void doSave(); });
    setTopIcons([viewLive, historyLink, discard, reloadKeep, checkAgain]);
    actions.append(save, publish);
    if (stale) showBanner("The website changed after this draft was started (someone published). Publishing this draft is refused until you discard it and make your change again on the current content.");
    const crumbsFor: Array<[string, string?]> = [...input.crumbs, [titleText() || "…"]];
    const content = inspector ? [inspector.element] : [title, fieldsRequiredNote(fields), banner, form.element];
    const split = preview ? h(doc, "div", { class: "vc-editor-split vc-preview-on" }, h(doc, "div", { class: "vc-editor-main" }, ...content), preview.element) : undefined;
    if (preview) {
      body.classList.add("vc-body-wide");
      // U2: the device switch in the middle of the top bar.
      topCenter.append(preview.devices);
    }
    show({ title: titleText(), crumbs: crumbsFor, dirty, save: doSave, refreshState: refresh, resource: resourceOf(), leave: () => { preview?.destroy(); inspector?.destroy(); body.classList.remove("vc-body-wide"); } }, split ? [split] : content);
    preview?.start();
    refresh();
    if (pendingFocus) { const target = pendingFocus; pendingFocus = undefined; focusAfterShow = () => reveal(target); }
  };

  // ---------------------------------------------------------------- P8: review + publish

  const timeOf = (iso: string | number) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }); };

  const changeItem = (change: Change) => {
    const parts: Node[] = [h(doc, "span", { class: "vc-change-label" }, change.label), change.locked ? h(doc, "span", { class: "vc-change-locked" }, " (admin only)") : h(doc, "span"), doc.createTextNode(": ")];
    const text = (cls: string, value: string) => h(doc, cls === "del" ? "del" : "ins", { class: `vc-change-${cls}` }, value || "(empty)");
    if (change.kind === "changed") parts.push(h(doc, "span", { class: "vc-change-what" }, text("del", change.before ?? ""), " → ", text("ins", change.after ?? "")));
    else if (change.kind === "added") parts.push(h(doc, "span", { class: "vc-change-what" }, "added ", text("ins", change.after ?? "")));
    else if (change.kind === "removed") parts.push(h(doc, "span", { class: "vc-change-what" }, "removed ", text("del", change.before ?? "")));
    else if (change.kind === "moved") parts.push(h(doc, "span", { class: "vc-change-what" }, change.after ? `new order: ${change.after}` : "new order"));
    else parts.push(h(doc, "span", { class: "vc-change-what" }, text("ins", change.after ?? "")));
    return h(doc, "li", { class: `vc-change vc-change-${change.kind}`, "data-path": change.path }, ...parts);
  };

  /** U3: why the editor's Publish dialog could not publish, in plain words. */
  const publishProblem = (result: ApiFail) => {
    if (result.status === 401) return "You are signed out. Sign in again, then publish.";
    if (result.error === "source_changed") return "Not published: the website changed after you started editing. Discard the draft and make your change again on the current content.";
    if (result.error === "locked_field") return "Not published: only an admin can change some of these fields.";
    if (result.error === "invalid_content") return `Not published: some fields need attention — ${(Array.isArray(result.data.errors) ? (result.data.errors as Array<{ message: string }>) : []).map((entry) => entry.message).join(" ") || result.message}`;
    return `Not published. ${result.message}`;
  };
  const urlOfDraft = (row: DraftRow) => (row.kind === "file" ? `/api/cms/files/${encodeURIComponent(row.key)}` : `/api/cms/collections/${encodeURIComponent(row.key)}/items/${encodeURIComponent(row.id ?? "")}`);
  const hrefOfDraft = (row: DraftRow) => (row.kind === "file" ? adminHref.file(row.key) : adminHref.item(row.key, row.id ?? ""));
  /** P12c: what the History screen needs for a resource id ("file:site", "item:services:<id>"). */
  const historyTarget = (resource: string): HistoryTarget | undefined => {
    const [kind, key, ...rest] = resource.split(":");
    if (kind === "file") { const file = boot.files.find((entry) => entry.key === key); return file ? { label: file.label, fields: editorFields({ kind: "file", file }), href: adminHref.file(key) } : undefined; }
    const collection = kind === "item" ? collectionOf(key) : undefined;
    const id = rest.join(":");
    return collection && id ? { label: `${collection.itemLabel} · ${id}`, fields: editorFields({ kind: "item", collection, isNew: false }), href: adminHref.item(key, id) } : undefined;
  };
  const fieldsOfDraft = (row: DraftRow) => {
    if (row.kind === "file") { const file = boot.files.find((entry) => entry.key === row.key); return file ? editorFields({ kind: "file", file }) : undefined; }
    const collection = collectionOf(row.key);
    return collection ? editorFields({ kind: "item", collection, isNew: row.isNew }) : undefined;
  };

  /** Each draft against the live content, compared through the editor's fields, with record names for references. */
  const reviewsOf = async (rows: DraftRow[]) => {
    const views = await Promise.all(rows.map((row) => api.get<FileView>(urlOfDraft(row))));
    const referenced = new Set<string>();
    for (const row of rows) for (const key of referencesIn(fieldsOfDraft(row) ?? {})) referenced.add(key);
    const labels: ReferenceLabels = {};
    await Promise.all([...referenced].map(async (key) => {
      const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
      labels[key] = Object.fromEntries(result.ok ? result.data.items.map((item) => [item.id, item.label || item.id]) : []);
    }));
    return rows.map((row, index) => {
      const view = views[index];
      const fields = fieldsOfDraft(row);
      const collection = row.kind === "item" ? collectionOf(row.key) : undefined;
      const changes = view.ok && fields && view.data.draft
        ? summarizeChanges({ fields, before: view.data.content ?? undefined, after: view.data.draft.content, references: labels, choiceLabels: choiceLabelsOf(view.data.choices), ...(collection && row.isNew ? { newRecord: { itemLabel: collection.itemLabel, title: row.label } } : {}) })
        : [];
      return { row, view, changes };
    });
  };

  /** U3 / U4: the review dialog of one draft (Mr Spa 03) — what changes, then "Publish to website". */
  const openPublishDialog = (input: { resource: string; title: string; changes: Change[]; onFailed?: () => void; onDone: () => void }) => {
    const host = siteHost();
    const problem = h(doc, "div", { class: "vc-dialog-problem", role: "alert", hidden: true });
    openDialog(doc, {
      title: `Publish ${input.title}?`,
      text: `These changes go live on ${host} in a few minutes. Other pages are not affected.`,
      body: [input.changes.length ? h(doc, "ul", { class: "vc-changes vc-dialog-changes" }, input.changes.map(changeItem)) : h(doc, "p", { class: "vc-note" }, "No differences from the website. Publishing it only clears the draft."), problem],
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Publish to website", kind: "primary", value: "publish" }],
      onButton: async (value, dialog) => {
        if (value !== "publish") return true;
        dialog.busy(true);
        problem.hidden = true;
        const result = await api.post<PublishResult>("/api/cms/publish", { resources: [input.resource] });
        dialog.busy(false);
        if (!result.ok) {
          input.onFailed?.();
          clear(problem);
          problem.append(h(doc, "p", {}, publishProblem(result)), h(doc, "a", { href: adminHref.review(input.resource), onclick: () => dialog.close("cancel") }, "Open in Review & publish"));
          problem.hidden = false;
          return false;
        }
        if (result.data.commitSha) watchLive({ expected: result.data.expectedLiveVersion, at: now(), userId: user.id, labels: [input.title], resources: result.data.resources });
        void refreshDrafts();
        input.onDone();
        return true;
      },
    });
  };

  // ---------------------------------------------------------------- U4: Drafts (Mr Spa 18)

  type PublishEntry = { id: number; at: string; who: string | null; action: string; resource: string; what: string };
  const draftsScreen = async (stillHere: () => boolean) => {
    const crumbsFor: Array<[string, string?]> = [["Drafts"]];
    const listed = await refreshDrafts();
    if (!stillHere()) return;
    if (!listed.ok) return failed(listed, crumbsFor);
    const rows = listed.data.drafts;
    const [reviews, recent] = await Promise.all([reviewsOf(rows), user.role === "owner" ? api.get<{ entries: PublishEntry[] }>("/api/cms/activity?kind=publish") : Promise.resolve(undefined)]);
    if (!stillHere()) return;
    const summary = (changes: Change[], ok: boolean) => {
      if (!ok) return "Could not be compared with the website";
      if (!changes.length) return "No differences from the website";
      const places = [...new Set(changes.map((change) => change.label.split(" › ")[0]))];
      return `${plural(changes.length, "change")}: ${places.slice(0, 3).join(", ")}${places.length > 3 ? ` and ${places.length - 3} more` : ""}`;
    };
    const waiting = reviews.map(({ row, view, changes }) => {
      const publishButton = h(doc, "button", { type: "button", class: "vc-button", "data-action": "publish-draft", disabled: row.stale || !view.ok, onclick: () => openPublishDialog({ resource: row.resource, title: row.label, changes, onDone: () => { pending = route(); } }) }, "Publish");
      const discard = async () => {
        if (!(await ask(`Discard your draft?\n\nThe website stays as it is. The changes saved in this ${row.label} draft are deleted.`, { confirm: "Discard draft", danger: true }))) return;
        const result = await api.delete(urlOfDraft(row));
        if (!result.ok) { say(result.message, "error"); return; }
        say("Draft discarded.");
        pending = route();
      };
      return h(doc, "li", { class: "vc-row vc-draft-row", "data-resource": row.resource },
        h(doc, "span", { class: "vc-row-text" },
          h(doc, "span", { class: "vc-row-title" }, row.label, h(doc, "span", { class: "vc-row-group" }, ` · ${row.group}`)),
          h(doc, "span", { class: "vc-row-sub vc-row-what" }, summary(changes, view.ok)),
          h(doc, "span", { class: "vc-row-meta" }, `Saved by you · ${timeOf(row.updatedAt)}`),
          row.stale ? h(doc, "span", { class: "vc-row-warn" }, "The website changed after this draft was started. Open it, discard the draft and make your change again.") : null),
        h(doc, "span", { class: "vc-row-actions" }, link(hrefOfDraft(row), "Open", { class: "vc-button" }), publishButton,
          moreMenu(`More for ${row.label}`, [{ text: "Discard draft", danger: true, run: () => { void discard(); } }])));
    });
    const published = recent?.ok ? recent.data.entries.filter((entry) => entry.action === "succeeded").slice(0, 5) : [];
    const recentRows = published.map((entry) => {
      const target = historyTarget(entry.resource);
      return h(doc, "li", { class: "vc-row" },
        h(doc, "span", { class: "vc-row-text" }, h(doc, "span", { class: "vc-row-title" }, entry.what), h(doc, "span", { class: "vc-row-meta" }, `Published by ${entry.who ?? "someone"} · ${timeOf(entry.at)}`)),
        target ? link(adminHref.history(entry.resource), "View history", { class: "vc-link" }) : null);
    });
    if (rows.length) actions.append(link(adminHref.review(), `Review & publish ${rows.length === 1 ? "it" : "all"}`, { class: "vc-button vc-primary", "data-action": "review-all" }));
    const empty = h(doc, "div", { class: "vc-empty-state" }, icon(doc, "inbox"), h(doc, "h2", {}, "No drafts"), h(doc, "p", {}, "When you save a draft, it waits here until you publish or discard it."));
    show({ title: "Drafts", crumbs: crumbsFor }, [
      quietHeading("Drafts"),
      h(doc, "h2", { class: "vc-group-title" }, "Waiting to publish"),
      rows.length ? h(doc, "ul", { class: "vc-rows" }, waiting) : empty,
      h(doc, "p", { class: "vc-help vc-rows-note" }, "Each person keeps their own drafts. Nothing here is on the website until it is published."),
      recentRows.length ? h(doc, "h2", { class: "vc-group-title" }, "Recently published") : h(doc, "span", { hidden: true }),
      recentRows.length ? h(doc, "ul", { class: "vc-rows" }, recentRows) : h(doc, "span", { hidden: true }),
    ]);
  };

  // ---------------------------------------------------------------- U4: Media (Mr Spa 17)

  const sizeOf = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const mediaScreen = async (stillHere: () => boolean) => {
    const crumbsFor: Array<[string, string?]> = [["Media"]];
    const result = await api.get<{ uploads: LibraryImage[]; site: LibraryImage[] }>("/api/cms/media");
    if (!stillHere()) return;
    if (!result.ok) return failed(result, crumbsFor);
    const uploadedSet = new Set(result.data.uploads.map((image) => image.src));
    let images: LibraryImage[] = [...result.data.uploads.map((image) => ({ ...image, source: "upload" as const })), ...result.data.site.filter((image) => !uploadedSet.has(image.src)).map((image) => ({ ...image, source: "site" as const }))];
    let kind: "all" | "upload" | "site" = "all";
    let selected: LibraryImage | undefined;
    const nameOf = (image: LibraryImage) => image.name || decodeURIComponent(image.src.split("/").pop() || image.src);
    const search = searchBox("Search by file name");
    const count = h(doc, "p", { class: "vc-count", "aria-live": "polite" });
    const grid = h(doc, "div", { class: "vc-picker-grid vc-media-grid", role: "list" });
    const status = h(doc, "p", { class: "vc-picker-status", role: "status", "aria-live": "polite" });
    const detail = h(doc, "aside", { class: "vc-media-detail", "aria-label": "Image details" });
    const chips = h(doc, "div", { class: "vc-filters", role: "group", "aria-label": "Show" });
    for (const [key, text] of [["all", "All"], ["upload", "Uploaded"], ["site", "Website"]] as const) chips.append(h(doc, "button", { type: "button", class: "vc-filter", "data-kind": key, "aria-pressed": String(key === kind), onclick: () => { kind = key; for (const chip of chips.querySelectorAll("button")) chip.setAttribute("aria-pressed", String(chip.dataset.kind === key)); render(); } }, text));
    const showDetail = () => {
      clear(detail);
      if (!selected) { detail.append(h(doc, "p", { class: "vc-help" }, "Choose an image to see its details.")); return; }
      const image = selected;
      const dims = h(doc, "dd", {}, image.width && image.height ? `${image.width} × ${image.height}` : "—");
      const picture = h(doc, "img", { src: image.src, alt: "", class: "vc-media-picture" });
      picture.addEventListener("load", () => { if (!image.width && picture.naturalWidth) dims.textContent = `${picture.naturalWidth} × ${picture.naturalHeight}`; });
      const address = /^https:\/\//.test(image.src) ? image.src : `${win.location.origin}${image.src}`;
      detail.append(picture,
        h(doc, "h2", { class: "vc-media-name" }, nameOf(image)),
        h(doc, "p", { class: "vc-help" }, image.source === "upload" ? "Uploaded image" : "Website image"),
        h(doc, "div", { class: "vc-media-actions" }, h(doc, "button", { type: "button", class: "vc-button", onclick: async () => { say((await kit.copy?.(address)) ? "Image link copied" : `Image link: ${address}`); } }, "Copy link")),
        h(doc, "dl", { class: "vc-media-facts" },
          h(doc, "dt", {}, "Dimensions"), dims,
          h(doc, "dt", {}, "Format"), h(doc, "dd", {}, (image.src.split(/[?#]/)[0].split(".").pop() ?? "").toUpperCase() || "—"),
          h(doc, "dt", {}, "File size"), h(doc, "dd", {}, image.bytes ? sizeOf(image.bytes) : "—")));
    };
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const shown = images.filter((image) => (kind === "all" || image.source === kind) && (!query || nameOf(image).toLowerCase().includes(query) || image.src.toLowerCase().includes(query)));
      clear(grid);
      for (const image of shown) {
        const on = selected?.src === image.src;
        grid.append(h(doc, "div", { role: "listitem" }, h(doc, "button", { type: "button", class: `vc-tile${on ? " vc-tile-selected" : ""}`, "data-src": image.src, "aria-pressed": String(on), "aria-label": nameOf(image), onclick: () => { selected = image; render(); showDetail(); } },
          h(doc, "span", { class: "vc-tile-picture" }, h(doc, "img", { src: image.src, alt: "", loading: "lazy", decoding: "async" }), h(doc, "span", { class: "vc-tile-check", "aria-hidden": "true" }, "✓")),
          h(doc, "span", { class: "vc-tile-name" }, nameOf(image)),
          h(doc, "span", { class: "vc-tile-meta" }, [image.width && image.height ? `${image.width} × ${image.height}` : "", image.bytes ? sizeOf(image.bytes) : ""].filter(Boolean).join(" · ")))));
      }
      if (!shown.length) grid.append(h(doc, "p", { class: "vc-note" }, images.length ? "No image matches." : "No images yet."));
      count.textContent = plural(shown.length, "image");
    };
    search.addEventListener("input", render);
    // Upload: each file is made smaller and WebP in the browser first, like in the image sheet.
    if (media.uploads) {
      const fileInput = h(doc, "input", { type: "file", accept: ACCEPTED_TYPES.join(","), multiple: true, class: "vc-sr-only", id: "vc-media-file", "aria-label": "Images to upload" });
      fileInput.addEventListener("change", async () => {
        const files = [...(fileInput.files ?? [])];
        let added = 0;
        for (const file of files) {
          status.textContent = `Uploading ${file.name}…`;
          let prepared: PreparedImage;
          try { prepared = await prepare(file); } catch (error) { status.textContent = `${file.name}: ${(error as Error).message}`; continue; }
          if (prepared.blob.size > media.maxBytes) { status.textContent = `${file.name} is still larger than ${sizeOf(media.maxBytes)} after preparing it.`; continue; }
          const done = await uploadImage(prepared);
          if (!done.ok) { status.textContent = `${file.name}: ${done.message}`; continue; }
          images = [done.image, ...images.filter((image) => image.src !== done.image.src)];
          selected = done.image;
          added += 1;
        }
        fileInput.value = "";
        if (added) { status.textContent = ""; render(); showDetail(); say(added === 1 ? "Image uploaded." : `${added} images uploaded.`, "success"); }
      });
      actions.append(fileInput, h(doc, "label", { for: "vc-media-file", class: "vc-button vc-primary", role: "button", tabindex: "0", onkeydown: (event: Event) => { const key = (event as KeyboardEvent).key; if (key === "Enter" || key === " ") { event.preventDefault(); fileInput.click(); } } }, icon(doc, "upload"), "Upload images"));
    }
    render();
    showDetail();
    show({ title: "Media", crumbs: crumbsFor, leave: () => body.classList.remove("vc-body-wide") }, [
      quietHeading("Media"),
      h(doc, "div", { class: "vc-media" },
        h(doc, "div", { class: "vc-media-main" }, h(doc, "div", { class: "vc-toolbar" }, search, chips, count), media.uploads ? status : h(doc, "p", { class: "vc-note" }, "Uploading is not set up on this site (its image storage is missing)."), grid),
        detail),
    ]);
    body.classList.add("vc-body-wide");
  };

  const review = async (preselect: string | undefined, stillHere: () => boolean) => {
    const crumbsFor: Array<[string, string?]> = [["My drafts", adminHref.drafts()], ["Review & publish"]];
    const listed = await refreshDrafts();
    if (!stillHere()) return;
    if (!listed.ok) return failed(listed, crumbsFor);
    const rows = listed.data.drafts;
    if (!rows.length) return show({ title: "Review & publish", crumbs: crumbsFor }, message("Nothing to publish", "You have no saved drafts. Edit something and save a draft; it shows up here for review before it goes on the website.", link(adminHref.pages(), "Go to Pages")));

    const reviews = await reviewsOf(rows);
    if (!stillHere()) return;

    const banner = h(doc, "div", { class: "vc-banner", role: "alert", hidden: true });
    const showBanner = (...content: Array<Node | string>) => { clear(banner); banner.append(...content.map((entry) => (typeof entry === "string" ? h(doc, "p", {}, entry) : entry))); banner.hidden = false; };
    const boxes: Array<{ row: DraftRow; box: HTMLInputElement; card: HTMLElement }> = [];
    const cards = rows.map((row, index) => {
      const { view, changes } = reviews[index];
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
      const result = await api.post<PublishResult>("/api/cms/publish", { resources: picked.map((entry) => entry.row.resource) });
      busy = false;
      if (!result.ok) {
        update();
        if (result.status === 401) { showBanner(result.message, h(doc, "a", { href: "/admin", class: "vc-button" }, "Sign in again")); return; }
        if (result.error === "source_changed") {
          const changed = Array.isArray(result.data.resources) ? (result.data.resources as string[]) : [];
          for (const entry of boxes) if (changed.includes(entry.row.resource)) entry.card.classList.add("vc-review-conflict");
          showBanner(`Not published: ${changed.map(labelOf).join(", ") || "some content"} changed on the website after you started editing. Open ${changed.length === 1 ? "it" : "each one"}, discard the draft and make your change again — or untick ${changed.length === 1 ? "it" : "them"} and publish the rest.`);
          return;
        }
        if (result.error === "locked_field" && Array.isArray(result.data.fields)) { showBanner("Not published: only an admin can change some of these fields.", h(doc, "ul", {}, (result.data.fields as Array<{ message: string }>).map((entry) => h(doc, "li", {}, entry.message)))); return; }
        if (result.error === "invalid_content") { showBanner(`Not published: ${labelOf(String(result.data.resource ?? ""))} has fields that need attention. Open it, fix them and save again.`, h(doc, "ul", {}, (Array.isArray(result.data.errors) ? (result.data.errors as Array<{ path: string; message: string }>) : []).map((entry) => h(doc, "li", {}, `${entry.path}: ${entry.message}`)))); return; }
        showBanner(`Not published. ${result.message}`);
        return;
      }
      const published = result.data;
      void refreshDrafts();
      const names = published.resources.map(labelOf);
      if (published.commitSha) watchLive({ expected: published.expectedLiveVersion, at: now(), userId: user.id, labels: names, resources: published.resources });
      clear(actions);
      const warnings = published.warnings.filter((warning) => warning.code === "rewrote_whole_file");
      const sanitizedNotes = published.warnings.filter((warning) => warning.code === "sanitized");
      show({ title: "Published", crumbs: crumbsFor }, [
        heading(published.commitSha ? "Published" : "Nothing changed on the website"),
        h(doc, "p", { class: "vc-lead" }, published.commitSha
          ? `${names.join(", ")} ${names.length === 1 ? "was" : "were"} sent to the website. It updates in a few minutes.`
          : "These drafts were the same as the website, so nothing was sent. The drafts are cleared."),
        published.commitSha ? h(doc, "p", { class: "vc-note" }, `Change ${published.commitSha.slice(0, 7)} on ${boot.site.name}'s ${published.files.length === 1 ? "file" : "files"}: ${published.files.join(", ")}.`) : h(doc, "span", { hidden: true }),
        warnings.length ? h(doc, "div", { class: "vc-banner" }, h(doc, "p", {}, `Formatting note: ${warnings.map((warning) => labelOf(warning.resource)).join(", ")} — the whole file was rewritten because its original formatting could not be kept. The content is right; the change on GitHub just looks bigger.`)) : h(doc, "span", { hidden: true }),
        sanitizedNotes.length ? h(doc, "div", { class: "vc-banner" }, h(doc, "p", {}, `Safety note: unsafe HTML was removed before publishing — ${sanitizedNotes.map((warning) => `${labelOf(warning.resource)}: ${(warning.fields ?? []).join("; ")}`).join(" · ")}.`)) : h(doc, "span", { hidden: true }),
        link(adminHref.drafts(), "Back to My drafts", { class: "vc-button" }),
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

  // ---------------------------------------------------------------- P8 / M1: is it live yet?
  // Mr Spa: the progress is the open record's save state ("Publishing… this usually takes a few minutes" → "Live on
  // <host>", or "Still publishing — check again in a few minutes" with the Check again icon); it goes on while other
  // screens are open, and after a reload. Once live, the open record reloads quietly.

  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let liveState: { state: PublishedState; resources: string[]; pending: PendingPublish } | undefined;
  const publishedStateOf = (resource: string) => (liveState && liveState.resources.includes(resource) ? liveState.state : undefined);
  const remember = (pending: PendingPublish | null) => { try { if (pending) storage?.setItem(PENDING_KEY, JSON.stringify(pending)); else storage?.removeItem(PENDING_KEY); } catch { /* private mode: just not remembered */ } };
  const liveChanged = () => {
    const screen = current;
    if (liveState?.state === "live" && screen?.resource && liveState.resources.includes(screen.resource) && !screen.dirty?.()) { void go(currentPath, { replace: true, force: true }); return; }
    screen?.refreshState?.();
  };
  const liveTick = async () => {
    if (!liveState) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = undefined;
    const { pending } = liveState;
    const result = await api.get<{ liveVersion: string }>("/api/cms/live-version");
    if (!liveState || liveState.pending !== pending) return;
    if (result.ok && result.data.liveVersion === pending.expected) {
      remember(null);
      liveState = { ...liveState, state: "live" };
      liveChanged();
      return;
    }
    if (now() - pending.at >= maxWaitMs) {
      liveState = { ...liveState, state: "waiting" };
      liveChanged();
      return;
    }
    liveTimer = setTimeout(() => { void liveTick(); }, pollMs);
  };
  const watchLive = (pending: PendingPublish) => {
    if (liveTimer) clearTimeout(liveTimer);
    remember(pending);
    liveState = { state: "publishing", resources: pending.resources ?? [], pending };
    liveTimer = setTimeout(() => { void liveTick(); }, pollMs);
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
  // Back / forward, and a hash address of before typed by hand.
  win.addEventListener("popstate", () => { pending = route(); });
  win.addEventListener("hashchange", () => { if (legacyHashPath(win.location.hash)) pending = route(); });
  /** Resolves once the screen for the current address is shown (tests; the page never needs it). */
  const idle = async () => { let seen: Promise<void> | undefined; while (seen !== pending) { seen = pending; await seen; } };
  return { ready: pending, idle, route, go, isDirty: () => current?.dirty?.() ?? 0 };
};
