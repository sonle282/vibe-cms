/**
 * P7: the admin shell — navigation, the overview, collection lists, and the editor for a file or a record, saving
 * drafts through the CMS API (P5). M1: addresses by path like the Mr Spa CMS (src/admin/routes.ts) — /admin opens the
 * first page's editor; the hash addresses of before still work. Preview (P9) and images (P10) build on this. Nothing
 * is saved without "Save draft"; leaving with unsaved changes asks first; nothing is published without a review.
 * M1: the frame of the Mr Spa CMS — the rail (Pages, the collections, Media, Drafts; Users and the account at the
 * bottom), the top bar (breadcrumb, Laptop / Tablet / Mobile, the one save state, View live / Version history /
 * Discard draft / Reload and keep my changes / Check again — folded into ⋯ on a narrow bar —, Save draft, Publish).
 */
import type { DocumentLayout, Field } from "../config/index.js";
import type { PickChoices } from "../check/picks.js";
import { checkRecordValues } from "../check/values.js";
import { createClient, humanMessage, xhrUpload, type ApiFail, type Client, type Fetch } from "./api.js";
import type { AdminBoot, BootCollection, BootFile } from "./boot.js";
import { clear, h, icon, uid } from "./dom.js";
import { confirmDialog, openDialog, type ConfirmOptions } from "./dialog.js";
import { createToast } from "./toast.js";
import { installTooltips } from "./tooltip.js";
import { summarizeChanges, type Change, type ReferenceLabels } from "./changes.js";
import { createForm, type Form, type ReferenceTarget } from "./form.js";
import { INVALID_LINK_REASON, LINK_VALIDITY } from "./link.js";
import { ACCEPTED_TYPES, adjustImage, imageFileProblem, measureImage, openAdjust, openImagePicker, prepareImage, type Adjust, type LibraryImage, type Measure, type Prepare, type PreparedImage, type Upload } from "./media.js";
import { configBinds, fieldAt, type PreviewOwner } from "./bridge.js";
import { createPreview, previewUrl, type Preview } from "./preview.js";
import { openMediaScreen } from "./media-screen.js";
import { createInspector, inspectorSections, sectionOfPath, type Inspector, type InspectorSection } from "./inspector.js";
import { openChangePassword, peopleScreen, rowMenu, type ScreenKit } from "./people.js";
import { activityScreen } from "./activity.js";
import { openHistory, type HistoryTarget } from "./history.js";
import { createRecordSide, createRecordToc } from "./record.js";
import { pluginControls, pluginPanels, type AdminPlugin } from "./plugins.js";
import { createDetailsCard, createDocBar, createGoogleCard, excerptOf, googlePath, plainTextOf, stringsIn, wordCount } from "./document.js";
import { ADMIN_BASE, adminHref, legacyHashPath, parseAdminPath, type AdminRoute } from "./routes.js";
import { applyLeafChanges, buildFailedText, deriveSaveState, elapsedText, publishBlockReason, unsavedLeafChanges, type LeafChange, type PublishedState, type SaveState } from "./save-state.js";
import { createRecovery, forgetAllRecovery, forgetRecovery, readRecovery, recoveryQuestion, type Recovery } from "./recovery.js";
import { reviewSummary, type ReviewGroup } from "./review.js";
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
  /** M14: the site's admin plugins (cms.config.ts `admin.plugins`, bundled into /admin). */
  plugins?: readonly AdminPlugin[];
};

/**
 * The fields the editor shows for a file or record: the config's, plus for records the ID (when not declared), the
 * status (when not declared) and the Markdown body. The review screen compares through the same fields.
 */
/** M9: a collection's records are edited in the record editor ("record") or the page editor ("page"). */
export const recordLayoutOf = (collection: BootCollection) => (collection.layout ?? (collection.preview ? "page" : "record")) === "record";

/** M10: the document layout of a file or collection (`layout: "document"` with its `document`), if it has one. */
export const documentOf = (target: { kind: "file"; file: BootFile } | { kind: "item"; collection: BootCollection }) => {
  const owner = target.kind === "file" ? target.file : target.collection;
  return owner.layout === "document" ? owner.document : undefined;
};
/** M10: the paper's title wraps over lines (Mr Spa: a text box that grows), so it is a multi-line text box. */
const withDocumentTitle = (fields: Record<string, Field>, spec: DocumentLayout | undefined) => {
  const field = spec ? fields[spec.title] : undefined;
  return field?.type === "text" ? { ...fields, [spec!.title]: { ...field, multiline: true } } : fields;
};

export const editorFields = (target: { kind: "file"; file: BootFile } | { kind: "item"; collection: BootCollection; isNew: boolean }) => {
  if (target.kind === "file") return withDocumentTitle(target.file.fields, documentOf(target));
  const { collection, isNew } = target;
  const fields: Record<string, Field> = {};
  // M9 (Mr Spa): the record editor has no ID or Status box of its own: the id comes from the name, the status from
  // Publish and Hide from website / Show on website again. M10: the document layout neither.
  const record = recordLayoutOf(collection) || collection.layout === "document";
  if (record) {
    Object.assign(fields, collection.fields);
    if (collection.status) delete fields[collection.status.field];
    if (collection.markdown && !("body" in fields)) fields.body = { type: "richText", label: "Text" };
    return withDocumentTitle(fields, documentOf({ kind: "item", collection }));
  }
  if (!(collection.idField in collection.fields)) fields[collection.idField] = { type: "text", label: "ID", required: true, help: isNew ? "Used in the page address: lowercase letters, numbers and dashes. It can't be changed later." : undefined };
  if (collection.status && !(collection.status.field in collection.fields)) fields[collection.status.field] = { type: "select", label: "Status", options: [collection.status.live, collection.status.draft, ...(collection.status.archived ? [collection.status.archived] : [])] };
  Object.assign(fields, collection.fields);
  if (collection.markdown && !("body" in fields)) fields.body = { type: "richText", label: "Text" };
  return fields;
};

/** M9 / M10: what the change lists name — the editor's fields, plus the status that Publish and Hide set. */
export const changeFields = (target: { kind: "file"; file: BootFile } | { kind: "item"; collection: BootCollection; isNew: boolean }) => {
  const fields = editorFields(target);
  if (target.kind === "file" || !target.collection.status || target.collection.status.field in fields) return fields;
  const { status } = target.collection;
  return { [status.field]: { type: "select", label: "Status", options: [status.live, status.draft, ...(status.archived ? [status.archived] : [])] } as Field, ...fields };
};

type DraftRow = { resource: string; kind: "file" | "item"; key: string; id: string | null; label: string; group: string; updatedAt: string; revision: number; isNew: boolean; stale: boolean };
type PublishResult = { commitSha: string | null; resources: string[]; files: string[]; expectedLiveVersion: string; warnings: Array<{ resource: string; code: string; fields?: string[] }>; attempts: number };
/** M6: the publish receipt (localStorage, until the change is live): `commit` = the commit, for the build check. */
type PendingPublish = { expected: string; at: number; userId: string; labels: string[]; resources?: string[]; commit?: string };
/** M6 (the Mr Spa CMS's publish-wait.ts): the waits between live checks — 10, 20, 30, 45 s, then every 60 s. */
export const LIVE_CHECK_STEPS = [10_000, 20_000, 30_000, 45_000, 60_000];
const PENDING_KEY = "vibe-cms:publishing";

type Screen = { title: string; crumbs: Array<[string, string?]>; dirty?: () => number; save?: () => Promise<void>; leave?: () => void; refreshState?: () => void; resource?: string };

type FileView = { resource: string; label: string; content: unknown; version: string; draft: null | { content: unknown; revision: number; sourceVersion: string; stale: boolean; updatedAt: string }; choices?: PickChoices };
/** P12g: pick values in plain words in the review ("packages/the-essential-reset" → "The Essential Reset"). */
const choiceLabelsOf = (choices: PickChoices | undefined) => Object.fromEntries(Object.values(choices ?? {}).flat().map((choice) => [choice.value, choice.label]));
type ListView = { key: string; label: string; itemLabel: string; items: Array<{ id: string; resource: string; label: string; version: string | null; hasDraft: boolean; isNew?: boolean; image?: string;
  /** M8: the record's status on the website, the values its list shows, when my draft was saved. */
  status?: "live" | "draft" | "archived"; values?: Record<string, unknown>; draftSavedAt?: string }> };
type ContentView = { files: Array<{ key: string; label: string; hasDraft: boolean; off?: boolean }>; collections: Array<{ key: string; label: string; itemLabel: string; count: number; drafts: number }> };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const startAdmin = (options: AdminOptions) => {
  const { root, boot } = options;
  const win = options.window ?? (root.ownerDocument.defaultView as Window);
  const doc = root.ownerDocument;
  // M5: uploads report their progress (XMLHttpRequest) unless a fetch is passed in (tests).
  const api: Client = createClient(options.fetch ?? ((input, init) => win.fetch(input, init)), options.fetch ? undefined : xhrUpload(win));
  // M14: the site's own controls and panels.
  const plugins = options.plugins ?? [];
  const controls = pluginControls(plugins);
  const ask = (message: string, choice?: ConfirmOptions) => Promise.resolve(options.confirm ? options.confirm(message, choice) : confirmDialog(doc, message, choice));
  /** U3: leaving with unsaved changes — "Keep editing" is the safe choice, "Discard changes" is red. */
  const askLeave = (count: number) => ask(leaveMessage(count), { cancel: "Keep editing", confirm: "Discard changes", danger: true });
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 20 * 60_000;
  const storage = options.storage === undefined ? (() => { try { return win.localStorage; } catch { return null; } })() : options.storage;
  const { user } = boot;
  const media = boot.media ?? { uploads: false, base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 };
  const prepare = options.prepareImage ?? prepareImage(win);
  /** P10: the image sheet for an image field. */
  // P12f: crop / resize in the browser (canvas); tests pass their own.
  const adjust = options.adjustImage ?? adjustImage(win);
  const measure = options.measureImage ?? measureImage(win);
  // M5: what the library knows about each image (file size, size, name), for the image cards.
  const imageCache = new Map<string, LibraryImage>();
  const rememberImages = (images: LibraryImage[]) => { for (const image of images) imageCache.set(image.src, image); };
  const uploadImage: Upload = async (prepared, onProgress) => {
    const headers: Record<string, string> = { "x-file-name": encodeURIComponent(prepared.name) };
    if (prepared.width && prepared.height) { headers["x-image-width"] = String(prepared.width); headers["x-image-height"] = String(prepared.height); }
    const result = await api.upload<{ image: LibraryImage & { reused?: boolean } }>("/api/cms/media", prepared.blob, headers, onProgress);
    if (!result.ok) { if (result.status === 401 || result.error === "password_change_required") { dirtyGuard = false; win.location.assign("/admin"); } return { ok: false, message: result.message }; }
    const { reused, ...image } = result.data.image;
    const uploaded: LibraryImage = { ...image, source: "upload" };
    rememberImages([uploaded]);
    return { ok: true, image: uploaded, ...(reused ? { reused: true } : {}) };
  };
  // M5 (Mr Spa): the sheet's area chips — Pages, then each collection on the rail.
  const imageGroups = [...(boot.files.length ? ["Pages"] : []), ...boot.collections.filter((collection) => !collection.under).map((collection) => collection.label)];
  const pickImage = (current: string, done: (image: { src: string }) => void, label?: string, more: { context?: string; select?: LibraryImage } = {}) => openImagePicker({
    doc, api, media, prepare, current, onPick: done, label, upload: uploadImage, groups: imageGroups, onLoad: rememberImages,
    ...(more.context ? { context: more.context } : {}), ...(more.select ? { select: more.select } : {}),
  });
  /** M5: a file dropped on an image card — prepared like an upload in the sheet, then uploaded with its progress. */
  const uploadFile = async (file: File, onProgress: (fraction: number) => void): Promise<{ ok: true; image: LibraryImage } | { ok: false; message: string }> => {
    let prepared: PreparedImage;
    try { prepared = await prepare(file); } catch (error) { return { ok: false, message: (error as Error).message }; }
    if (prepared.blob.size > media.maxBytes) return { ok: false, message: imageFileProblem({ type: "image/webp", size: prepared.blob.size }, media.maxBytes) ?? "" };
    return uploadImage(prepared, onProgress);
  };
  /** M5: Adjust (the Mr Spa CMS's dialog); the copy is then offered in the sheet. Needs uploads. */
  const adjustAt = (src: string, created: (image: LibraryImage) => void) => {
    openAdjust({ doc, image: imageCache.get(src) ?? { src, bytes: 0, source: "site" }, measure, adjust, upload: uploadImage, maxBytes: media.maxBytes, onCreated: created });
  };
  /** The site's own images and its uploads (same origin) can be adjusted in the browser. */
  const canAdjust = (src: string) => src.startsWith("/") && !src.startsWith("//");

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
    forgetAllRecovery(storage);
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
  const showState = (state: Pick<SaveState, "kind" | "label" | "shortLabel"> & { tooltip?: string } | null) => {
    saveState.hidden = !state;
    if (!state) return;
    saveState.dataset.kind = state.kind;
    // M6 (Mr Spa): the chip's tooltip carries the time since Publish ("· 1m 5s").
    if (state.tooltip && state.tooltip !== state.label) saveState.dataset.tooltip = state.tooltip; else delete saveState.dataset.tooltip;
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
    // M12: /admin/history/<resource> (the History screen of before) is the Version history dialog, over its editor.
    const historyFor = target.kind === "history" ? target.resource : undefined;
    const historyOver = historyFor ? historyTarget(historyFor) : undefined;
    if (historyOver) { win.history.replaceState(null, "", historyOver.href); target = parseAdminPath(win.location.pathname); }
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
      else if (target.kind === "users") await peopleScreen(peopleKit, stillHere);
      else if (target.kind === "audit") await activityScreen(peopleKit, stillHere, target.filter);
      else show({ title: "Not found", crumbs: [["Pages", adminHref.pages()], ["Not found"]] }, message("Not found", "There is nothing at this address in the CMS.", link(adminHref.pages(), "Go to Pages")));
    } catch {
      if (stillHere()) show({ title: "Error", crumbs: [["Pages", adminHref.pages()], ["Error"]] }, message("Something went wrong", "The page could not be shown. Reload to try again."));
    }
    // The screen's heading gets focus (screen readers announce the page), unless the screen asked for a field (P9).
    const after = focusAfterShow;
    focusAfterShow = undefined;
    if (stillHere() && !after?.()) main.querySelector<HTMLElement>("h1")?.focus();
    if (stillHere() && openPassword) openChangePassword(kit);
    if (stillHere() && historyFor && historyOver) openHistory(kit, historyFor, historyOver, () => { void go(historyOver.href, { force: true }); });
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

  // M12: People & activity use the whole width (the Add a person panel on the right).
  const peopleKit: ScreenKit = { ...kit, show: (screen, content) => { body.classList.add("vc-body-people"); show({ ...screen, leave: () => body.classList.remove("vc-body-people") }, content); } };

  // ---------------------------------------------------------------- overview

  /**
   * M7: Pages, as in the Mr Spa CMS — "Main pages" on the left; "Across the whole site" (the areas) and the other
   * groups on the right (one column at 1100 px and less). A row: its name, its address (an area: what it holds), Live /
   * Off (what the website shows), "Unpublished changes" while a draft is saved. "Find a page" hides what does not match.
   */
  const overview = async (stillHere: () => boolean) => {
    const result = await api.get<ContentView>("/api/cms/content");
    if (!stillHere()) return;
    if (!result.ok) return failed(result, [["Pages"]]);
    const MAIN = "Main pages";
    const AREAS = "Across the whole site";
    const rows = result.data.files.map((file) => {
      const config = boot.files.find((entry) => entry.key === file.key);
      const path = config?.preview && !config.preview.includes("{") ? config.preview.split(/[?#]/)[0] || "/" : "";
      const second = config?.area ? config.description ?? "" : path || config?.description || "";
      const group = config?.area ? AREAS : config?.group ?? MAIN;
      const li = h(doc, "li", {}, h(doc, "a", { class: "vc-pages-row", href: adminHref.file(file.key), "data-kind": config?.area ? "area" : "page" },
        h(doc, "span", { class: "vc-pages-row-icon", "aria-hidden": "true" }, icon(doc, "file")),
        h(doc, "span", { class: "vc-pages-row-text" }, h(doc, "strong", {}, file.label), h(doc, "span", {}, second)),
        h(doc, "span", { class: "vc-pages-row-status" },
          h(doc, "span", { class: `vc-content-status${file.off ? " is-off" : ""}` }, file.off ? "Off" : "Live"),
          file.hasDraft ? h(doc, "span", { class: "vc-list-status-note" }, "Unpublished changes") : null),
        h(doc, "span", { class: "vc-pages-row-chevron", "aria-hidden": "true" }, icon(doc, "chevron"))));
      return { group, text: `${file.label} ${second}`.toLowerCase(), li, area: Boolean(config?.area) };
    });
    // Groups in the order the config first names them; Main pages on the left, the areas first on the right.
    const names = [...new Set(rows.map((row) => row.group))];
    const groupBox = (name: string) => {
      const id = uid("pages");
      const list = h(doc, "ul", { class: "vc-pages-list" }, rows.filter((row) => row.group === name).map((row) => row.li));
      return h(doc, "section", { class: "vc-pages-group", "aria-labelledby": id, "data-group": name },
        h(doc, "h2", { class: "vc-pages-group-title", id }, name, name === AREAS ? h(doc, "small", {}, "Changes here show on every page") : null), list);
    };
    const side = [...(names.includes(AREAS) ? [AREAS] : []), ...names.filter((name) => name !== MAIN && name !== AREAS)];
    const groups = [...(names.includes(MAIN) ? [groupBox(MAIN)] : []), ...side.map(groupBox)];
    const columns = h(doc, "div", { class: `vc-pages-columns${names.includes(MAIN) && side.length ? "" : " is-single"}` },
      ...(names.includes(MAIN) ? [groups[0]] : []),
      side.length ? h(doc, "div", { class: "vc-pages-side" }, ...groups.slice(names.includes(MAIN) ? 1 : 0)) : null);
    const empty = h(doc, "p", { class: "vc-pages-empty", hidden: true }, "No page matches that name.");
    const pageCount = rows.filter((row) => !row.area).length;
    const areaCount = rows.length - pageCount;
    const count = h(doc, "span", { class: "vc-pages-count" }, areaCount ? `${plural(pageCount, "page")} · ${plural(areaCount, "site-wide area")}` : plural(pageCount, "page"));
    const search = h(doc, "input", { type: "search", placeholder: "Find a page", autocomplete: "off", "aria-label": "Find a page" });
    search.addEventListener("input", () => {
      const term = search.value.trim().toLowerCase();
      let shown = 0;
      for (const row of rows) { const match = !term || row.text.includes(term); row.li.hidden = !match; if (match) shown += 1; }
      for (const group of groups) group.hidden = ![...group.querySelectorAll("li")].some((li) => !li.hidden);
      empty.hidden = shown > 0;
    });
    body.classList.add("vc-body-pages");
    show({ title: "Pages", crumbs: [["Pages"]], leave: () => body.classList.remove("vc-body-pages") }, [quietHeading("Pages"),
      h(doc, "div", { class: "vc-pages-toolbar" }, h(doc, "label", { class: "vc-pages-search" }, icon(doc, "search"), h(doc, "span", { class: "vc-sr-only" }, "Find a page"), search), count),
      columns, empty]);
  };

  // ---------------------------------------------------------------- M7: Search & sharing (the Mr Spa CMS's screen)

  /** Its two cards as form sections: Search results (site name, title, description, the rest) · Sharing image. */
  const seoSectionsOf = (file: BootFile) => {
    const seo = file.seo!;
    const topOf = (name: string) => Object.keys(file.fields).find((key) => name === key || name.startsWith(`${key}.`)) ?? name;
    const image = seo.image ? [seo.image] : [];
    const first = [seo.siteName, seo.title, seo.description].filter((name): name is string => Boolean(name));
    const used = new Set([...first, ...image].map(topOf));
    const rest = Object.keys(file.fields).filter((key) => !used.has(key));
    return [{ key: "results", label: "Search results", fields: [...first, ...rest] }, ...(image.length ? [{ key: "sharing", label: "Sharing image", fields: image }] : [])];
  };
  /** The form in its cards, the description's "N / 160", and the Google + share previews, kept up to date. */
  const seoScreen = (file: BootFile, form: Form) => {
    const seo = file.seo!;
    const host = siteHost();
    const at = (name: string | undefined) => (name ? form.element.querySelector<HTMLElement>(`[data-path="${name}"]`) : null);
    const help = (key: string, text: string) => { const title = form.element.querySelector(`[data-section="${key}"] .vc-section-title`); title?.after(h(doc, "p", { class: "vc-seo-card-help" }, text)); };
    help("results", "Used on every page that does not set its own.");
    help("sharing", "Shown when someone shares a link on Facebook, Messenger or iMessage.");
    const counter = h(doc, "span", { class: "vc-seo-count", "aria-live": "polite" });
    at(seo.description)?.querySelector(".vc-label")?.append(counter);
    const googleTitle = h(doc, "span", { class: "vc-seo-google-title" });
    const googleText = h(doc, "span", { class: "vc-seo-google-description" });
    const shareImage = h(doc, "img", { class: "vc-seo-share-image", alt: "", hidden: true });
    const shareTitle = h(doc, "strong", {});
    const shareText = h(doc, "span", {});
    const render = () => {
      const value = form.value();
      const text = (name: string | undefined) => { const found = name ? getAt(value, keyPath(name)) : undefined; return typeof found === "string" ? found : ""; };
      const description = text(seo.description);
      const title = text(seo.title);
      counter.textContent = `${description.length} / 160`;
      if (description.length > 160) counter.dataset.state = "long"; else delete counter.dataset.state;
      googleTitle.textContent = title || "Page title";
      googleText.textContent = description || "Page description";
      shareTitle.textContent = title || "Page title";
      shareText.textContent = description;
      const image = seo.image ? getAt(value, keyPath(seo.image)) : undefined;
      const src = typeof image === "string" ? image : image && typeof image === "object" ? String((image as { src?: unknown }).src ?? "") : "";
      shareImage.hidden = !src;
      if (src && shareImage.getAttribute("src") !== src) shareImage.setAttribute("src", src);
    };
    form.element.addEventListener("input", render);
    form.element.addEventListener("change", render);
    // The image card changes without an input event: look again after a click in the form.
    form.element.addEventListener("click", () => setTimeout(render, 0));
    render();
    return h(doc, "div", { class: "vc-seo-columns" },
      h(doc, "div", { class: "vc-seo-form" }, form.element),
      h(doc, "aside", { class: "vc-seo-preview", "aria-labelledby": "vc-seo-preview-title" },
        h(doc, "h2", { id: "vc-seo-preview-title" }, "Preview"),
        h(doc, "div", { class: "vc-seo-google", "aria-label": "In Google" }, h(doc, "span", { class: "vc-seo-google-site" }, host), googleTitle, googleText),
        h(doc, "div", { class: "vc-seo-share", "aria-label": "When shared" }, shareImage, h(doc, "div", { class: "vc-seo-share-text" }, h(doc, "span", { class: "vc-seo-share-site" }, host.toUpperCase()), shareTitle, shareText)),
        h(doc, "p", { class: "vc-seo-card-help" }, "Social apps can take a few days to show a new image.")));
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

  // ---------------------------------------------------------------- M8: a collection's list (the Mr Spa CMS's Products)

  /** The field a list setting names: a key, a path into objects ("seo.title"), or the status field. */
  const listFieldOf = (collection: BootCollection, name: string): Field | undefined => {
    if (collection.fields[name]) return collection.fields[name];
    if (collection.status && name === collection.status.field) return { type: "select", label: "Status", options: [collection.status.live, collection.status.draft, ...(collection.status.archived ? [collection.status.archived] : [])] };
    const parts = name.split(".");
    for (let end = parts.length - 1; end > 0; end -= 1) {
      const field = collection.fields[parts.slice(0, end).join(".")];
      if (field?.type === "object") return listFieldOf({ ...collection, fields: field.fields, status: undefined }, parts.slice(end).join("."));
    }
    return undefined;
  };
  /** "Oct 25, 2024" (the Mr Spa CMS's list dates). */
  const listDate = (value: unknown) => {
    const date = typeof value === "string" ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  };
  /** "post" → "posts", "category" → "categories", "box" → "boxes". */
  const pluralWord = (word: string) => (/[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);
  const STATUS_WORDS = { live: "Live", draft: "Draft", archived: "Archived" } as const;

  const listCollection = async (key: string, stillHere: () => boolean) => {
    const collection = collectionOf(key);
    const crumbsFor: Array<[string, string?]> = collection ? crumbsOfCollection(collection) : [[key]];
    if (!collection) return show({ title: "Not found", crumbs: crumbsFor }, message("Not found", `There is no "${key}" in this site's CMS.`));
    const result = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(key)}`);
    if (!stillHere()) return;
    if (!result.ok) return failed(result, crumbsFor);
    // The Mr Spa CMS lists the records on the website; a new record's draft is on Drafts until it is published.
    const items = result.data.items.filter((item) => !item.isNew);
    const list = collection.list ?? {};
    const one = collection.itemLabel.toLowerCase();
    const many = collection.labels?.many ?? pluralWord(one);
    const columns = list.columns ?? [];
    const filters = list.filters ?? [];
    const referenceFields: Record<string, Field> = {};
    for (const entry of [...columns, ...filters]) { const field = listFieldOf(collection, entry.field); if (field?.type === "reference") referenceFields[entry.field] = field; }
    const references = Object.keys(referenceFields).length ? await loadReferences(referenceFields) : {};
    if (!stillHere()) return;
    const statusField = collection.status?.field;

    /** A stored value as the list shows it (labels of references, words of `values`, dates, Yes / No). */
    const shown = (spec: { field: string; values?: Readonly<Record<string, string>>; format?: "date" }, value: unknown): string => {
      const field = listFieldOf(collection, spec.field);
      const single = (entry: unknown): string => {
        if (entry === null || entry === undefined || entry === "") return "";
        if (spec.values && String(entry) in spec.values) return spec.values[String(entry)];
        if (field?.type === "reference") return references[field.to]?.items.find((item) => item.id === entry)?.label ?? String(entry);
        if (typeof entry === "boolean") return entry ? "Yes" : "No";
        if (spec.format === "date") return listDate(entry) || String(entry);
        return typeof entry === "object" ? "" : String(entry);
      };
      return Array.isArray(value) ? value.map(single).filter(Boolean).join(", ") : single(value);
    };
    const detailOf = (item: ListView["items"][number]) => {
      if (!list.detail) return "";
      let empty = false;
      const text = list.detail.replace(/\{([^}]+)\}/g, (_match, name: string) => { const words = shown({ field: name }, item.values?.[name]); if (!words || words === "—") empty = true; return words; });
      return empty || text === item.label ? "" : text;
    };

    // ---- the toolbar: search, the filters, the count
    const search = h(doc, "input", { type: "search", class: "vc-input vc-list-search-input", placeholder: collection.labels?.search ?? `Search ${many}`, autocomplete: "off" });
    const chosen = new Map<string, string>();
    const filterControls = filters.map((filter) => {
      const field = listFieldOf(collection, filter.field);
      const name = filter.label ?? field?.label ?? filter.field;
      const choices: Array<[string, string]> = filter.field === statusField
        ? [["", "All"], ["live", "Live"], ["draft", "Draft"], ...(collection.status?.archived ? [["archived", "Archived"] as [string, string]] : [])]
        : field?.type === "select" ? [["", filter.all ?? "All"], ...field.options.map((option): [string, string] => [option, filter.values?.[option] ?? option])]
        : field?.type === "toggle" ? [["", "All"], ["true", filter.values?.true ?? "Yes"], ["false", filter.values?.false ?? "No"]]
        : field?.type === "reference" ? [["", filter.all ?? "All"], ...(references[field.to]?.items ?? []).map((item): [string, string] => [item.id, item.label])]
        : [["", "All"]];
      chosen.set(filter.field, "");
      // A few choices are buttons (All · Live · Draft · Archived); more are a dropdown (Mr Spa: Category).
      if (choices.length <= 5) {
        const group = h(doc, "div", { class: "vc-list-segmented", role: "radiogroup", "aria-label": name });
        const buttons = choices.map(([value, words], index) => h(doc, "button", { type: "button", class: "vc-list-segment", role: "radio", "data-value": value, "aria-checked": String(index === 0), tabindex: index === 0 ? "0" : "-1" }, words));
        const pick = (button: HTMLElement) => {
          for (const other of buttons) { const on = other === button; other.setAttribute("aria-checked", String(on)); other.tabIndex = on ? 0 : -1; }
          chosen.set(filter.field, button.dataset.value ?? "");
          render();
        };
        buttons.forEach((button, index) => {
          button.addEventListener("click", () => pick(button));
          button.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const next = buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
            pick(next); next.focus();
          });
        });
        group.append(...buttons);
        return group;
      }
      const select = h(doc, "select", { class: "vc-input vc-list-select" }, ...choices.map(([value, words]) => h(doc, "option", { value }, words)));
      select.addEventListener("change", () => { chosen.set(filter.field, select.value); render(); });
      return h(doc, "label", { class: "vc-list-filter" }, h(doc, "span", { class: "vc-sr-only" }, name), select);
    });
    const count = h(doc, "span", { class: "vc-list-count", role: "status", "aria-live": "polite" });
    const tbody = h(doc, "tbody");
    const hasImage = Object.values(collection.fields).some((field) => field.type === "image");
    const headers = [collection.itemLabel, ...columns.map((column) => column.label ?? listFieldOf(collection, column.field)?.label ?? column.field), "Status"];

    const rowText = (item: ListView["items"][number]) => [item.label, item.id, detailOf(item), ...columns.map((column) => shown(column, item.values?.[column.field])), ...(list.search ?? []).map((name) => shown({ field: name }, item.values?.[name]))].join(" ").toLocaleLowerCase();
    const matches = (item: ListView["items"][number]) => [...chosen].every(([field, value]) => {
      if (!value) return true;
      if (field === statusField) return (item.status ?? "live") === value;
      const stored = item.values?.[field];
      return Array.isArray(stored) ? stored.map(String).includes(value) : String(stored ?? "") === value;
    });

    const render = () => {
      const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const visible = items.filter((item) => matches(item) && (!words.length || words.every((word) => rowText(item).includes(word))));
      clear(tbody);
      for (const item of visible) {
        const name = item.label || item.id;
        const detail = detailOf(item);
        const thumb = hasImage ? h(doc, "span", { class: `vc-list-thumb${item.image ? "" : " is-empty"}`, "aria-hidden": "true" }, item.image ? h(doc, "img", { src: item.image, alt: "", loading: "lazy", decoding: "async" }) : null) : null;
        const status = item.status ?? "live";
        const saved = item.draftSavedAt ? new Date(item.draftSavedAt) : undefined;
        const note = item.hasDraft ? h(doc, "span", { class: "vc-list-status-note", title: saved && !Number.isNaN(saved.getTime()) ? `Draft saved ${saved.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Draft saved" }, "Unpublished changes") : null;
        const live = status === "live" ? previewUrl(collection.preview, { ...(item.values ?? {}), [collection.idField]: item.id }) : undefined;
        const menu = rowMenu(doc, `More actions for ${name}`, [
          { text: "Edit", run: () => { void go(adminHref.item(key, item.id)); } },
          ...(list.duplicate && !collection.fixed ? [{ text: "Duplicate", run: () => { void duplicateRecord(collection, item); } }] : []),
          ...(live ? [{ text: "View on website", href: live }] : []),
        ], "More");
        tbody.append(h(doc, "tr", { class: "vc-list-row", "data-id": item.id },
          h(doc, "td", { class: "vc-list-name-cell" }, h(doc, "a", { href: adminHref.item(key, item.id), class: "vc-list-name" }, thumb,
            h(doc, "span", { class: "vc-list-name-words" }, h(doc, "strong", {}, name), detail ? h(doc, "span", { class: "vc-list-name-detail" }, detail) : null))),
          ...columns.map((column) => { const text = shown(column, item.values?.[column.field]); return h(doc, "td", { class: "vc-list-secondary" }, text || "—"); }),
          h(doc, "td", { class: "vc-list-status-cell" }, h(doc, "span", { class: `vc-content-status${status === "draft" ? " is-draft" : status === "archived" ? " is-archived" : ""}` }, STATUS_WORDS[status]), note),
          h(doc, "td", { class: "vc-list-menu-cell" }, menu)));
      }
      if (!visible.length) tbody.append(h(doc, "tr", {}, h(doc, "td", { colspan: String(headers.length + 1), class: "vc-list-empty" }, h(doc, "p", {}, items.length ? `No ${many} match these filters.` : `No ${many} yet.`))));
      count.textContent = visible.length === items.length ? plural(items.length, one, many) : `${visible.length} of ${plural(items.length, one, many)}`;
    };
    search.addEventListener("input", render);
    render();
    if (!collection.fixed) actions.append(h(doc, "a", { href: adminHref.newItem(key), class: "vc-button vc-primary" }, icon(doc, "plus"), collection.labels?.add ?? `Add ${one}`));
    // M14: the site's panels above the list, told the rows.
    const listPanels = pluginPanels(doc, plugins, "list", { collection: key });
    for (const panel of listPanels) panel.update({ rows: items.map((item) => ({ id: item.id, label: item.label, ...(item.status ? { status: item.status } : {}), ...(item.values ? { values: item.values } : {}) })) });
    // Mr Spa: the list uses the whole workspace (38 px / 48 px around it), not the editor's column.
    body.classList.add("vc-body-list");
    show({ title: collection.label, crumbs: crumbsFor, leave: () => body.classList.remove("vc-body-list") }, [
      quietHeading(collection.label),
      tabsOf(collection) ?? h(doc, "span", { hidden: true }),
      listPanels.length ? h(doc, "div", { class: "vc-list-panels" }, ...listPanels.map((panel) => panel.element)) : h(doc, "span", { hidden: true }),
      h(doc, "div", { class: "vc-list-toolbar" }, h(doc, "label", { class: "vc-list-search" }, h(doc, "span", { class: "vc-sr-only" }, search.placeholder), search), ...filterControls, count),
      h(doc, "div", { class: "vc-workspace-card" },
        h(doc, "table", { class: "vc-list-table" }, h(doc, "thead", {}, h(doc, "tr", {}, ...headers.map((text) => h(doc, "th", { scope: "col" }, text)), h(doc, "th", { scope: "col" }, h(doc, "span", { class: "vc-sr-only" }, "Actions")))), tbody)),
    ]);
  };

  /** M8 (Mr Spa: Duplicate product): a new, unpublished record named "Copy of …", opened in the editor. */
  const duplicateRecord = async (collection: BootCollection, item: ListView["items"][number]) => {
    const one = collection.itemLabel.toLowerCase();
    const name = item.label || item.id;
    const settings = typeof collection.list?.duplicate === "object" ? collection.list.duplicate : {};
    const clearNames = (settings.clear ?? []).map((field) => (listFieldOf(collection, field)?.label ?? field).toLowerCase());
    const fresh = clearNames.length ? `, and the ${clearNames.length > 1 ? `${clearNames.slice(0, -1).join(", ")} and ${clearNames[clearNames.length - 1]}` : clearNames[0]} start${clearNames.length > 1 ? "" : "s"} fresh` : "";
    if (!(await ask(`Duplicate ${one}\n\nCreate a new, unpublished ${one} from "${name}"? The name starts as "Copy of …"${fresh}; everything else is kept. The original ${one} is not changed.`, { confirm: "Create copy" }))) return;
    const view = await api.get<FileView>(`/api/cms/collections/${encodeURIComponent(collection.key)}/items/${encodeURIComponent(item.id)}`);
    if (!view.ok) { say(view.message || "The copy could not be created."); return; }
    const copy = clone((view.data.draft?.content ?? view.data.content) as Record<string, unknown>);
    const labelKey = Object.keys(collection.fields).find((field) => collection.fields[field].type === "text" && field !== collection.idField && typeof copy[field] === "string" && copy[field]);
    const labelField = labelKey ? collection.fields[labelKey] : undefined;
    const copyName = `Copy of ${name}`.slice(0, labelField?.type === "text" && labelField.maxLength ? labelField.maxLength : 500);
    if (labelKey) copy[labelKey] = copyName;
    for (const field of settings.clear ?? []) delete copy[field];
    if (collection.status) copy[collection.status.field] = collection.status.draft;
    const taken = new Set<string>();
    const list = await api.get<ListView>(`/api/cms/collections/${encodeURIComponent(collection.key)}`);
    if (list.ok) for (const entry of list.data.items) taken.add(entry.id);
    const base = slugify(copyName) || `copy-of-${item.id}`;
    let id = base; for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    copy[collection.idField] = id;
    const saved = await api.request<unknown>("PUT", `/api/cms/collections/${encodeURIComponent(collection.key)}/items/${encodeURIComponent(id)}`, { content: copy, expectedRevision: 0, sourceVersion: "new" });
    if (!saved.ok) { say(saved.message || "The copy could not be created."); return; }
    await go(adminHref.item(collection.key, id));
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
    return collection ? describeField(changeFields({ kind: "item", collection, isNew: false }), path, collection.itemLabel) : path.join(".");
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
  /** M6: write the open record's pending recovery copy now (the page is going away). */
  let flushRecovery: (() => void) | undefined;
  win.addEventListener("pagehide", () => flushRecovery?.());

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
    const listedFields = input.kind === "file" ? fields : changeFields({ kind: "item", collection: input.collection, isNew });
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
    let publishing = false;
    let discarding = false;
    /** M6: while "Restore unsaved changes?" is open, the copy is neither written nor removed. */
    let offering = false;
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
    // P12c / M12: Version history (every role, as in the Mr Spa CMS), once the resource exists on the website.
    const historyLink = !isNew && view?.content ? topIcon("history", "View version history", "history", () => {
      const resource = resourceOf();
      const over = historyTarget(resource);
      if (over) openHistory(kit, resource, over, () => { void go(over.href, { force: true }); });
    }, "Version history") : null;
    const discard = topIcon("discard", "Discard draft", "undo", () => { void discardHere(); });
    const reloadKeep = topIcon("reload-keep", "Reload and keep my changes", "rotate-ccw", () => { void reloadKeepingChanges(); });
    const checkAgain = topIcon("check-again", "Check again whether the publish is live", "refresh", () => { void checkLive(); }, "Check again");

    const dirty = () => countChanges(saved, form.value());
    const referenceLabels = (): ReferenceLabels => Object.fromEntries(Object.entries(references).map(([key, target]) => [key, Object.fromEntries(target.items.map((item) => [item.id, item.label]))]));
    const changesToPublish = () => {
      const labels = referenceLabels();
      return summarizeChanges({ fields: listedFields, before: live, after: saved, references: labels, choiceLabels: choiceLabelsOf(view?.choices), ...(collection && !live ? { newRecord: { itemLabel: collection.itemLabel, title: titleText() } } : {}) });
    };
    const stale = Boolean(view?.draft?.stale);
    /** M9: redraws the record editor's right column (set once it exists). */
    let recordUpdate: ((count: number, blocked: string | null) => void) | undefined;
    const refresh = () => {
      const count = dirty();
      // M4 (Mr Spa): a link that cannot be saved holds Save until it is fixed.
      const badLinks = form.invalidLinks();
      title.textContent = titleText();
      inspector?.setTitle(titleText());
      const liveNow = hasDraft ? undefined : publishedStateOf(resourceOf());
      const published = liveNow === "failed" ? undefined : liveNow;
      const reason = stale ? "The website changed after this draft was started. Discard it and make your change again."
        : publishBlockReason({ conflict, dirty: count > 0, hasDraft, invalid: Boolean(problem), changes: hasDraft && !count ? changesToPublish().length : 0 });
      const state = deriveSaveState({
        unsaved: count, hasDraft, canSave: !conflict && !saving && !discarding && !badLinks, publishBlockReason: reason, recordLive, host: siteHost(),
        busy: saving ? "Saving draft…" : publishing ? "Publishing…" : discarding ? "Discarding draft…" : undefined,
        problem: problem || (liveNow === "failed" ? buildFailedText(liveState?.pending.commit ?? "") : "") || undefined, published,
        typicalMinutes: boot.publish?.typicalMinutes,
        ...(published === "publishing" || published === "waiting" ? { detail: elapsedText(now() - (liveState?.pending.at ?? now())) } : {}),
      });
      if (!offering && recovery) recovery.sync(count > 0);
      showState(state);
      save.disabled = !state.saveEnabled;
      save.textContent = saving ? "Saving…" : "Save draft";
      save.dataset.tooltip = badLinks ? INVALID_LINK_REASON : count && conflict ? "Resolve conflicts or loading errors before saving." : "Save your changes as a draft.";
      publish.disabled = !state.publishEnabled;
      // Mr Spa: while saving, Publish reads "Saving…" too.
      publish.textContent = publishing ? "Publishing…" : saving ? "Saving…" : discarding ? "Discarding…" : "Publish";
      publish.dataset.tooltip = state.publishTooltip;
      discard.hidden = !(hasDraft || count > 0) || saving || discarding;
      reloadKeep.hidden = !conflict;
      checkAgain.hidden = published !== "waiting" && liveNow !== "failed";
      syncMore();
      recordUpdate?.(count, reason);
    };

    const seoLayout = input.kind === "file" && input.file.layout === "seo" && Boolean(input.file.seo);
    const documentSpec = input.kind === "file" ? documentOf(input) : documentOf({ kind: "item", collection: input.collection });
    const plain = Boolean(documentSpec?.plain);
    const seoSections = seoLayout && input.kind === "file" ? seoSectionsOf(input.file) : undefined;
    const form: Form = createForm({
      doc, fields, value: start, role: user.role, references, readOnly, pickImage, choices: view?.choices, controls, notify: (text, action) => say(text, "info", action),
      markdown: collection?.markdown && !("body" in collection.fields) ? ["body"] : [],
      // M3 (Mr Spa): deleting a list item asks first; a click on an item's card shows it on the page; the validation
      // summary's buttons go to their field (opening its section).
      confirm: (text, choice) => ask(text, choice),
      onItem: (path) => { preview?.scrollTo(path); },
      reveal: (text) => { reveal(text); },
      // M5: the image cards — drop a file to upload it, Adjust, file sizes; the sheet says where the image area is.
      ...(media.uploads ? { uploadFile, maxBytes: media.maxBytes, adjustImage: adjustAt, canAdjust } : {}),
      imageInfo: (src) => imageCache.get(src),
      imageContext: (path) => {
        if (input.kind !== "file") return `${input.collection.label} › ${titleText() || `New ${input.collection.itemLabel.toLowerCase()}`}`;
        const section = sectionOfPath(sectionList, pathText(path));
        return section && !section.key.startsWith("_") ? `${input.file.label} › ${section.label}` : input.file.label;
      },
      // M4: Link fields offer the site's pages and say where a link goes; Phone fields follow site.phone.country.
      links: { pages: boot.site.pages ?? [], host: siteHost(), ...(boot.site.phone ? { country: boot.site.phone.country } : {}) },
      previewNotes: Boolean((input.kind === "file" ? input.file.preview : input.collection.preview) && options.preview !== false && !seoLayout && !documentSpec),
      // M7: an area's on / off toggle is the Mr Spa CMS's switch, against what the website shows now.
      ...(input.kind === "file" && input.file.toggle ? { switchField: { path: input.file.toggle, noun: input.file.label.toLowerCase(), live: live === undefined || live === null ? undefined : getAt(live, keyPath(input.file.toggle)) === true } } : {}),
      sections: documentSpec ? undefined : seoLayout ? seoSections : input.kind === "file" ? input.file.sections : collection && recordLayoutOf(collection) ? recordSectionsOf(collection, fields) : undefined,
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

    const recovery: Recovery | undefined = isNew ? undefined : createRecovery({ storage, resource: resourceOf(), user: user.username, version: () => version, content: () => form.value(), dirty: () => dirty() > 0, now });
    flushRecovery = recovery?.flush;
    // The copy is read before the first refresh (which removes a copy while there are no unsaved changes).
    const snapshot = !isNew && !kept ? readRecovery(storage, resourceOf(), now()) : null;
    const offer = snapshot && JSON.stringify(snapshot.content) !== JSON.stringify(saved) && (snapshot.user === null || snapshot.user === user.username) && snapshot.version === version ? snapshot : null;
    if (offer) offering = true;
    else if (snapshot) forgetRecovery(storage, resourceOf());

    // P9: the page in the canvas, showing this draft as it is typed.
    const owner = (): PreviewOwner => (input.kind === "file" ? `file:${input.file.key}` : `item:${input.collection.key}:${input.id ?? (String(form.value()[input.collection.idField] ?? "") || "new")}`);
    // M7: Search & sharing is a screen of its own (no page on the canvas).
    const pattern = seoLayout ? undefined : input.kind === "file" ? input.file.preview : input.collection.preview;
    let preview: Preview | undefined;
    let suppressScroll = false;
    let lastFocused = "";
    const recordLayout = Boolean(collection && recordLayoutOf(collection));
    /** M9 / M10: the right column ("On the website", "Ready to publish") instead of the page on the canvas. */
    const sideLayout = recordLayout || Boolean(documentSpec);
    if (pattern && options.preview !== false && !sideLayout) {
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
        onReady: (bridge) => {
          inspector?.setOrder(bridge.order());
          // M7 (Mr Spa): an area is framed in teal on the page while it is edited.
          if (input.kind === "file" && input.file.area && input.file.outline) bridge.showArea(input.file.outline);
        },
      });
    }
    // M3: with the page on the canvas, the form sits in the Mr Spa inspector — sections at level 1, one at level 2.
    const sectionList = inspectorSections(fields, input.kind === "file" ? input.file.sections : undefined, titleText() || input.crumbs.at(-1)?.[0] || "");
    const sessionStore = (() => { try { return win.sessionStorage; } catch { return null; } })();
    const inspector: Inspector | undefined = preview ? createInspector({
      doc, form, fields, sections: sectionList, title: titleText(),
      // M7 (Mr Spa): an area says where it is ("Across the whole site") and what it holds ("…. Applies site-wide.").
      crumb: input.kind === "file" && input.file.area ? "Across the whole site" : input.crumbs.at(-1)?.[0] ?? "Pages",
      before: [...(input.kind === "file" && input.file.area && input.file.description ? [h(doc, "p", { class: "vc-area-description" }, `${input.file.description.replace(/\.$/, "")}. Applies site-wide.`)] : []), banner],
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
      const problems = checkRecordValues({ fields: configFields, record: value, ids, system, ...(boot.site.phone ? { phoneCountry: boot.site.phone.country } : {}) }).errors.map(({ path, message: text }) => ({ path, message: text }));
      if (collection) {
        const id = value[collection.idField];
        if (typeof id !== "string" || !id) problems.push({ path: collection.idField, message: "Fill in the ID." });
        else if (isNew && !ID_PATTERN.test(id)) problems.push({ path: collection.idField, message: "Use lowercase letters, numbers and dashes only (e.g. spa-pedicure)." });
        else if (isNew && existing?.ok && existing.data.items.some((item) => item.id === id)) problems.push({ path: collection.idField, message: `Another ${collection.itemLabel.toLowerCase()} already uses this ID.` });
      }
      return problems;
    };
    // ---- M9: the record editor (sections on the left, the form, "On the website" / "Ready to publish" on the right)
    const recordSections = collection && recordLayout ? recordSectionsOf(collection, fields) : [];
    const recordToc = collection && recordLayout ? createRecordToc(doc, recordSections, (key) => form.element.querySelector<HTMLElement>(`.vc-section[data-section="${key}"]`), () => body, collection.itemLabel) : undefined;
    const recordScroll = () => recordToc?.spy();
    const statusOfLive = (): "live" | "draft" | "archived" => {
      if (!collection?.status || live === undefined || live === null) return "live";
      const override = visibilityOverride.get(resourceOf());
      const value = override ?? (live as Record<string, unknown>)[collection.status.field];
      return value === collection.status.draft ? "draft" : collection.status.archived !== undefined && value === collection.status.archived ? "archived" : "live";
    };
    const webStateOf = (count: number) => {
      const shownAt = input.kind === "file" ? input.file.preview : collection?.preview;
      const path = shownAt && live ? previewUrl(shownAt, live as Record<string, unknown>) : undefined;
      return { status: statusOfLive(), isNew, dirty: count > 0, hasDraft, ...(path ? { link: { href: path, text: `${siteHost()}${path.replace(/\/$/, "")}` } } : {}) };
    };
    const readyItemsOf = () => {
      if (!sideLayout) return [];
      const readyFields = input.kind === "file" ? input.file.fields : input.collection.fields;
      const value = form.value();
      const filled = (field: Field | undefined, entry: unknown) => {
        if (entry === undefined || entry === null) return false;
        if (typeof entry === "string") return entry.trim().length > 0;
        if (Array.isArray(entry)) return entry.length >= Math.max(1, field?.type === "list" ? field.min ?? 1 : 1);
        if (field?.type === "image" && typeof entry === "object") return Boolean((entry as { src?: unknown }).src);
        return true;
      };
      const jump = (path: string) => () => { const box = form.element.querySelector<HTMLElement>(`[data-path="${path}"]`); box?.scrollIntoView?.({ block: "center" }); form.focus(path); };
      const chosen = collection?.ready ?? Object.entries(readyFields).filter(([, field]) => field.required || (field.type === "list" && (field.min ?? 0) > 0)).map(([key]): { field: string; label?: string } => ({ field: key }));
      const items = chosen.map(({ field: key, label }) => {
        const field = readyFields[key];
        const words = label ?? (field?.type === "list" && !field.required ? `At least ${(field.min ?? 1) === 1 ? "one" : field.min} ${(field.itemLabel ?? field.of.label).toLowerCase()}` : field?.label ?? key);
        return { label: words, done: filled(field, getAt(value, keyPath(key))), go: jump(key) };
      });
      // M10 (Mr Spa's Blog post): a new post's address; (Policy) no section left empty.
      if (documentSpec && collection && isNew && addressPrefix !== undefined) {
        const id = String(value[collection.idField] ?? "");
        items.push({ label: "Page address", done: ID_PATTERN.test(id) && id.length <= 160 && id !== "new", go: () => { addressBox?.focus(); } });
      }
      const bodyField = documentSpec ? fields[documentSpec.body] : undefined;
      if (plain && bodyField?.type === "list") {
        const sections = getAt(value, keyPath(documentSpec!.body));
        items.push({ label: "No empty section", done: Array.isArray(sections) && sections.every((section) => stringsIn(section).some((text) => text.trim())), go: jump(documentSpec!.body) });
      }
      const problems = validate();
      items.push({ label: "No errors", done: problems.length === 0, go: () => { if (!problems.length) return; form.showErrors(problems); form.focus(problems[0].path.replace(/\[\d+\].*$/, "")) || form.focus(problems[0].path); } });
      return items;
    };
    // ---- M10: the document layout's parts (the paper is put together with the layout, below)
    const documentNoun = collection ? collection.itemLabel.toLowerCase() : "page";
    const detailsCard = documentSpec ? createDetailsCard(doc, collection ? `${collection.itemLabel} details` : "Page details") : undefined;
    const googleCard = documentSpec ? createGoogleCard(doc, `Worked out from the title and the first lines of the ${documentNoun}.`) : undefined;
    const docBar = plain && documentSpec ? createDocBar(doc, fields[documentSpec.body]?.type !== "list" || (fields[documentSpec.body] as { fixed?: boolean }).fixed ? "Plain text · the sections stay as they are" : "Plain text") : undefined;
    const markdownBody = Boolean(collection?.markdown && documentSpec?.body === "body" && !("body" in collection.fields));
    // Mr Spa: "Web address" — fixed once the record exists; a new post's comes from its title (it can be shortened).
    const addressPattern = documentSpec ? (input.kind === "file" ? input.file.preview : collection?.preview) : undefined;
    const addressPrefix = collection && isNew && addressPattern?.includes(`{${collection.idField}}`) ? addressPattern.split(`{${collection.idField}}`)[0] : undefined;
    const addressPath = () => (addressPattern ? (previewUrl(addressPattern, form.value()) ?? (/\{/.test(addressPattern) ? undefined : addressPattern)) : undefined);
    const addressBox = addressPattern && (addressPrefix !== undefined || !isNew) ? h(doc, "input", { id: uid("address"), class: "vc-input", autocomplete: "off", spellcheck: "false", ...(addressPrefix === undefined ? { readonly: true } : {}) }) as HTMLInputElement : undefined;
    const showAddress = () => {
      if (!addressBox || doc.activeElement === addressBox) return;
      const path = addressPath() ?? "";
      addressBox.value = input.kind === "file" ? `${siteHost()}${path.replace(/\/$/, "")}` : addressPrefix !== undefined ? `${addressPrefix}${String(form.value()[collection!.idField] ?? "")}` : path.replace(/\/$/, "");
    };
    if (addressBox && addressPrefix !== undefined && collection) {
      const typed = () => slugify(addressBox.value.startsWith(addressPrefix) ? addressBox.value.slice(addressPrefix.length) : addressBox.value);
      addressBox.addEventListener("input", () => { idTouched = true; form.setValue([collection.idField], typed()); });
      addressBox.addEventListener("change", () => { addressBox.value = `${addressPrefix}${typed()}`; });
    }
    const addressRow = addressBox ? h(doc, "div", { class: "vc-field vc-doc-address" },
      h(doc, "label", { class: "vc-label", for: addressBox.id }, "Web address"), addressBox,
      h(doc, "p", { class: "vc-help" }, addressPrefix !== undefined ? "Filled in from the title. You can shorten it; it can't be changed after publishing." : "Fixed so existing links keep working.")) : null;
    const updateDocument = () => {
      if (!documentSpec || !googleCard) return;
      const value = form.value();
      const titleValue = String(getAt(value, keyPath(documentSpec.title)) ?? "").trim();
      const bodyValue = getAt(value, keyPath(documentSpec.body));
      const text = plain || typeof bodyValue !== "string" ? stringsIn(bodyValue).join(" ").replace(/\s+/g, " ").trim() : plainTextOf(doc, bodyValue, markdownBody);
      googleCard.update({ path: googlePath(siteHost(), addressPath() ?? ""), title: `${titleValue || (collection ? `Untitled ${documentNoun}` : "")} | ${boot.site.name}`, text: excerptOf(text) });
      docBar?.setCount(wordCount([titleValue, ...stringsIn(bodyValue)]));
      showAddress();
    };
    // M14: the site's panels in the right column, told the record after every change.
    const recordPanels = sideLayout ? pluginPanels(doc, plugins, "record", input.kind === "file" ? { file: input.file.key } : { collection: input.collection.key }) : [];
    const sideExtra = documentSpec ? [detailsCard!.element, googleCard!.element] : [];
    const sidePanels = recordPanels.map((panel) => panel.element);
    const recordSide = collection && sideLayout ? createRecordSide(doc, {
      noun: collection.itemLabel.toLowerCase(), nounTitle: collection.itemLabel,
      ...(sideExtra.length ? { extra: sideExtra } : {}),
      ...(sidePanels.length ? { panels: sidePanels } : {}),
      ...(documentSpec ? { label: `${collection.itemLabel} details` } : {}),
      ...(collection.list?.duplicate && !collection.fixed ? { duplicate: () => {
        if (dirty()) { say(`Save or discard your changes before duplicating this ${collection.itemLabel.toLowerCase()}.`); return; }
        void duplicateRecord(collection, { id: input.kind === "item" ? input.id ?? "" : "", label: titleText(), resource: resourceOf(), version, hasDraft });
      } } : {}),
      ...(collection.status?.archived ? { visibility: (archive: boolean) => { void changeVisibility(archive); } } : {}),
    }) : documentSpec ? createRecordSide(doc, { noun: "page", nounTitle: "Page", extra: sideExtra, panels: sidePanels, label: "Page details" }) : undefined;
    if (recordSide) recordUpdate = (count, blocked) => { recordSide.update(webStateOf(count), readyItemsOf(), blocked ?? undefined); updateDocument(); for (const panel of recordPanels) panel.update({ record: form.value() }); };
    /** M10: the paper — the formatting bar (or a policy's bar), the cover, the title, the body; the rest goes right. */
    const documentPaper = () => {
      const spec = documentSpec!;
      const boxOf = (key: string | undefined) => (key ? form.element.querySelector<HTMLElement>(`:scope > [data-path="${key}"]`) : null);
      const cover = boxOf(spec.cover); const titleBox = boxOf(spec.title); const bodyBox = boxOf(spec.body);
      const onPaper = [cover, titleBox, bodyBox].filter((box): box is HTMLElement => Boolean(box));
      for (const box of onPaper) form.element.append(box);
      for (const child of [...form.element.children]) if (child.classList.contains("vc-field") && !onPaper.includes(child as HTMLElement)) detailsCard!.body.append(child);
      if (addressRow) detailsCard!.body.append(addressRow);
      detailsCard!.element.hidden = !detailsCard!.body.children.length;
      titleBox?.classList.add("vc-doc-title-field");
      titleBox?.querySelector(".vc-label")?.classList.add("vc-sr-only");
      const titleInput = titleBox?.querySelector<HTMLTextAreaElement>("textarea");
      if (titleInput) {
        titleInput.rows = 1;
        titleInput.classList.add("vc-doc-title");
        // Mr Spa: "Give the post a title" for a new post; "Title" on a page.
        titleInput.placeholder = collection ? (isNew ? `Give the ${documentNoun} a title` : "") : "Title";
        titleInput.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });
      }
      bodyBox?.classList.add("vc-doc-body");
      bodyBox?.querySelector(":scope > .vc-label")?.classList.add("vc-sr-only");
      const toolbar = plain ? null : bodyBox?.querySelector<HTMLElement>(".vc-rich-toolbar") ?? null;
      return h(doc, "div", { class: `vc-doc-paper${plain ? " is-plain" : ""}` }, docBar?.element ?? null, toolbar, form.element,
        plain ? null : h(doc, "p", { class: "vc-help vc-doc-paste" }, "Pasting keeps text only; HTML code is not accepted."));
    };
    /** M9 (Mr Spa): Hide from website / Show on website again — at once, outside Save draft and Publish. */
    const changeVisibility = async (archive: boolean) => {
      if (!collection || input.kind !== "item" || !input.id) return;
      const noun = collection.itemLabel.toLowerCase();
      const words = archive ? "Hide from website" : "Show on website again";
      const question = archive ? `Hide this ${noun} from the public website? It is kept in the CMS as Archived and can be shown again later.` : `Show this ${noun} on the public website again?`;
      if (!(await ask(`${words}\n\n${question}`, { confirm: words }))) return;
      const result = await api.post<{ status: "live" | "archived" }>(`/api/cms/collections/${encodeURIComponent(collection.key)}/items/${encodeURIComponent(input.id)}/visibility`, { action: archive ? "archive" : "unarchive" });
      if (!result.ok) { say(result.message || "That did not work. Try again."); return; }
      visibilityOverride.set(resourceOf(), archive ? collection.status!.archived! : collection.status!.live);
      say(archive ? `${collection.itemLabel} hidden from the website (Archived)` : `${collection.itemLabel} shown on the website again`);
      // My draft of it (if any) was moved to the new version: open it again.
      await go(currentPath, { replace: true, force: true });
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
      if (collection?.status && sideLayout) {
        const archived = collection.status.archived !== undefined && (visibilityOverride.get(resourceOf()) ?? value[collection.status.field]) === collection.status.archived;
        value[collection.status.field] = archived ? collection.status.archived : collection.status.live;
        // The form holds it too, or the saved draft would differ from the form by its status.
        if (form.value()[collection.status.field] !== value[collection.status.field]) form.setValue([collection.status.field], value[collection.status.field]);
      }
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

    // M6 (Mr Spa): "Review changes" (by section) → "Publish {name}" → publish; Publish reads "Publishing…" and the
    // outcome is the save state (no toast).
    const publishHere = async () => {
      if (publish.disabled || dirty() || publishing) return;
      const name = titleText();
      const changes = summarizeChanges({ fields: listedFields, before: live, after: saved, references: referenceLabels(), choiceLabels: choiceLabelsOf(view?.choices), full: true, ...(collection && !live ? { newRecord: { itemLabel: collection.itemLabel, title: name } } : {}) });
      if (!changes.length) { problem = "There are no changes to publish."; refresh(); return; }
      if (!(await confirmPublish(name, reviewGroups(changes, sectionList, name)))) return;
      publishing = true;
      problem = "";
      refresh();
      const result = await publishResource(resourceOf(), name);
      publishing = false;
      if (!result.ok) { problem = publishProblem(result); refresh(); return; }
      hasDraft = false;
      forgetRecovery(storage, resourceOf());
      await go(currentPath, { replace: true, force: true });
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
    const checkLive = async () => { await liveTick(0); refresh(); };

    save.addEventListener("click", () => { void doSave(); });
    setTopIcons([viewLive, historyLink, discard, reloadKeep, checkAgain]);
    actions.append(save, publish);
    if (stale) showBanner("The website changed after this draft was started (someone published). Publishing this draft is refused until you discard it and make your change again on the current content.");
    const crumbsFor: Array<[string, string?]> = [...input.crumbs, [titleText() || "…"]];
    // M7 (Mr Spa): Search & sharing has its title in the top bar only.
    if (seoLayout) title.classList.add("vc-sr-only");
    if (sideLayout) title.classList.add("vc-sr-only");
    const content = inspector ? [inspector.element] : seoLayout && input.kind === "file" ? [title, banner, seoScreen(input.file, form)]
      : documentSpec && recordSide ? [title, h(doc, "div", { class: "vc-doc-editor" }, recordRequiredNote(fields), banner, documentPaper(), recordSide.element)]
      : recordLayout && recordToc && recordSide ? [title, h(doc, "div", { class: "vc-record-editor" }, recordToc.element, h(doc, "div", { class: "vc-record-form" }, recordRequiredNote(fields), banner, form.element), recordSide.element)]
      : [title, fieldsRequiredNote(fields), banner, form.element];
    if (recordLayout) { body.classList.add("vc-body-record"); body.addEventListener("scroll", recordScroll, { passive: true }); }
    if (seoLayout) body.classList.add("vc-body-seo");
    if (documentSpec) body.classList.add("vc-body-document");
    const split = preview ? h(doc, "div", { class: "vc-editor-split vc-preview-on" }, h(doc, "div", { class: "vc-editor-main" }, ...content), preview.element) : undefined;
    if (preview) {
      body.classList.add("vc-body-wide");
      // U2: the device switch in the middle of the top bar.
      topCenter.append(preview.devices);
    }
    show({ title: titleText(), crumbs: crumbsFor, dirty, save: doSave, refreshState: refresh, resource: resourceOf(), leave: () => { body.classList.remove("vc-body-seo"); body.classList.remove("vc-body-record"); body.classList.remove("vc-body-document"); body.removeEventListener("scroll", recordScroll); recovery?.stop(); if (flushRecovery === recovery?.flush) flushRecovery = undefined; if (dirty()) forgetRecovery(storage, resourceOf()); preview?.destroy(); inspector?.destroy(); body.classList.remove("vc-body-wide"); } }, split ? [split] : content);
    preview?.start();
    refresh();
    // M4: a Link field turning invalid / valid turns Save off / on.
    form.element.addEventListener(LINK_VALIDITY, () => refresh());
    // M6 (Mr Spa): a copy of the unsaved edits in this browser — offered back when the record is opened again.
    if (offer) {
      const here = currentPath;
      const noun = input.kind === "file" ? "page" : input.collection.itemLabel.toLowerCase();
      void ask(recoveryQuestion(noun, offer.savedAt, now()), { confirm: "Restore changes", cancel: "Discard them" }).then((yes) => {
        offering = false;
        if (currentPath !== here || !input.stillHere()) return;
        if (!yes) { forgetRecovery(storage, resourceOf()); return; }
        carry = { path: here, changes: unsavedLeafChanges(saved, offer.content) };
        void go(here, { replace: true, force: true });
      });
    }
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
    if (kind === "file") { const file = boot.files.find((entry) => entry.key === key); return file ? { label: file.label, fields: changeFields({ kind: "file", file }), href: adminHref.file(key) } : undefined; }
    const collection = kind === "item" ? collectionOf(key) : undefined;
    const id = rest.join(":");
    return collection && id ? { label: `${collection.itemLabel} · ${id}`, fields: changeFields({ kind: "item", collection, isNew: false }), href: adminHref.item(key, id) } : undefined;
  };
  const fieldsOfDraft = (row: DraftRow) => {
    if (row.kind === "file") { const file = boot.files.find((entry) => entry.key === row.key); return file ? changeFields({ kind: "file", file }) : undefined; }
    const collection = collectionOf(row.key);
    return collection ? changeFields({ kind: "item", collection, isNew: row.isNew }) : undefined;
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

  /** M6 (Mr Spa): the changes grouped by the inspector's sections (one group, named after the record, without them). */
  const reviewGroups = (changes: Change[], sections: InspectorSection[], name: string): ReviewGroup[] => {
    const groups = sections.map((section) => ({ label: section.key === "_all" ? name : section.label, changes: [] as Change[] }));
    const rest: Change[] = [];
    for (const change of changes) {
      const section = sectionOfPath(sections, change.path);
      (section ? groups[sections.indexOf(section)].changes : rest).push(change);
    }
    return rest.length ? [{ label: name, changes: rest }, ...groups] : groups;
  };
  /** M6 (Mr Spa): "Review changes" → "Publish {name}" (This will publish to {host}.). True = publish. */
  const confirmPublish = async (name: string, groups: ReviewGroup[]) => {
    const review = openDialog(doc, {
      title: "Review changes", text: `Review the changes to ${name} before publishing.`,
      body: [reviewSummary(doc, groups)],
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Continue to publish", kind: "primary", value: "continue" }],
    });
    review.element.classList.add("vc-review-dialog");
    review.element.querySelector<HTMLElement>('[data-value="cancel"]')?.focus();
    if ((await review.done) !== "continue") return false;
    return ask(`Publish ${name}\n\nThis will publish to ${siteHost()}.`, { confirm: "Publish" });
  };
  /** Publish one resource; a commit is then followed until it is live. */
  const publishResource = async (resource: string, name: string) => {
    const result = await api.post<PublishResult>("/api/cms/publish", { resources: [resource] });
    if (result.ok) {
      if (result.data.commitSha) watchLive({ expected: result.data.expectedLiveVersion, at: now(), userId: user.id, labels: [name], resources: result.data.resources, commit: result.data.commitSha });
      void refreshDrafts();
    }
    return result;
  };

  // ---------------------------------------------------------------- U4: Drafts (Mr Spa 18)

  type PublishEntry = { id: number; at: string; who: string | null; action: string; resource: string; what: string; detail?: { commitSha?: string | null } };
  /** M11 (Mr Spa): "Oct 13" (this year) / "Oct 13, 2025". */
  const shortDate = (iso: string) => { const date = new Date(iso); if (Number.isNaN(date.getTime())) return "—"; return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === new Date(now()).getFullYear() ? {} : { year: "numeric" }) }); };
  /**
   * M11: My drafts, as in the Mr Spa CMS — one card per draft (its kind, its name, "N changes: a, b, c and K more",
   * "Saved …", Live + "Unpublished changes" / Draft + "Not on the website yet"), See changes (read-only), Open,
   * ⋯ Discard draft; "Recently published" for admins (the last 5, with the 7-character commit). The package keeps
   * "Review & publish all" (several drafts in one publish, DESIGN §H.1).
   */
  const draftsScreen = async (stillHere: () => boolean) => {
    const crumbsFor: Array<[string, string?]> = [["Drafts"]];
    const listed = await refreshDrafts();
    if (!stillHere()) return;
    if (!listed.ok) return failed(listed, crumbsFor);
    const rows = listed.data.drafts;
    const [reviews, recent] = await Promise.all([reviewsOf(rows), user.role === "owner" ? api.get<{ entries: PublishEntry[] }>("/api/cms/activity?kind=publish") : Promise.resolve(undefined)]);
    if (!stillHere()) return;
    const summary = (row: DraftRow, changes: Change[], ok: boolean) => {
      if (row.isNew) return `Not on the website yet · ${row.label || "untitled"}`;
      if (!ok) return "Open to see the changes.";
      if (!changes.length) return "No differences from the live version.";
      const labels = [...new Set(changes.map((change) => change.label))];
      return `${plural(changes.length, "change")}: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}`;
    };
    const typeOf = (row: DraftRow) => {
      if (row.kind === "file") return boot.files.find((entry) => entry.key === row.key)?.area ? "Across the whole site" : "Page";
      const collection = collectionOf(row.key);
      return row.isNew ? `New ${(collection?.itemLabel ?? "record").toLowerCase()}` : collection?.itemLabel ?? "Content";
    };
    const waiting = reviews.map(({ row, view, changes }) => {
      const discard = async () => {
        if (!(await ask(`Discard your draft?\n\nThe website stays as it is. The changes saved in your draft of "${row.label}" are deleted.`, { confirm: "Discard draft", danger: true }))) return;
        const result = await api.delete(urlOfDraft(row));
        if (!result.ok) { say(result.message || "The draft could not be discarded.", "error"); return; }
        pending = route();
      };
      const seeChanges = () => {
        const sections = inspectorSections(fieldsOfDraft(row) ?? {}, row.kind === "file" ? boot.files.find((entry) => entry.key === row.key)?.sections : undefined, row.label);
        const dialog = openDialog(doc, { title: "Changes in this draft", text: `${row.label} — saved draft compared with the website.`, body: [reviewSummary(doc, reviewGroups(changes, sections, row.label))], buttons: [{ label: "Close", value: "close" }] });
        dialog.element.classList.add("vc-review-dialog");
      };
      const what = summary(row, changes, view.ok);
      return h(doc, "li", { class: "vc-drafts-card", "data-resource": row.resource },
        h(doc, "div", { class: "vc-drafts-what" },
          h(doc, "span", { class: "vc-draft-type" }, typeOf(row)),
          h(doc, "strong", { class: "vc-draft-label" }, row.label),
          h(doc, "span", { class: "vc-draft-changes", ...(row.stale ? { "data-state": "conflict" } : {}) }, row.stale ? `${what} · The live version changed since; reload the draft before publishing.` : what),
          h(doc, "span", { class: "vc-drafts-saved" }, `Saved ${new Date(row.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`)),
        h(doc, "div", { class: "vc-draft-actions" },
          h(doc, "span", { class: "vc-drafts-status" },
            h(doc, "span", { class: `vc-content-status${row.isNew ? " is-draft" : ""}` }, row.isNew ? "Draft" : "Live"),
            h(doc, "span", { class: "vc-list-status-note" }, row.isNew ? "Not on the website yet" : "Unpublished changes")),
          !row.isNew && view.ok && changes.length ? h(doc, "button", { type: "button", class: "vc-button", "data-action": "see-changes", onclick: seeChanges }, "See changes") : null,
          link(hrefOfDraft(row), "Open", { class: "vc-button" }),
          moreMenu(`More for ${row.label}`, [{ text: "Discard draft", danger: true, run: () => { void discard(); } }])));
    });
    const published = recent?.ok ? recent.data.entries.filter((entry) => entry.action === "succeeded").slice(0, 5) : [];
    const recentRows = published.map((entry) => {
      const sha = entry.detail?.commitSha ?? "";
      return h(doc, "li", { class: "vc-drafts-card" },
        h(doc, "div", { class: "vc-drafts-what" }, h(doc, "strong", { class: "vc-draft-label" }, entry.what), h(doc, "span", { class: "vc-drafts-saved" }, `Published by ${entry.who ?? "someone"} · ${shortDate(entry.at)}`)),
        h(doc, "code", { class: "vc-activity-commit", ...(sha ? { title: sha } : {}) }, sha.slice(0, 7)));
    });
    if (rows.length) actions.append(link(adminHref.review(), `Review & publish ${rows.length === 1 ? "it" : "all"}`, { class: "vc-button vc-primary", "data-action": "review-all" }));
    const empty = h(doc, "li", { class: "vc-drafts-empty" }, h(doc, "strong", {}, "No drafts"), h(doc, "span", {}, "When you save a draft, it waits here until you publish or discard it."));
    show({ title: "Drafts", crumbs: crumbsFor }, [
      quietHeading("Drafts"),
      h(doc, "div", { class: "vc-drafts-view" },
        h(doc, "section", {}, h(doc, "h2", { class: "vc-drafts-heading" }, "Waiting to publish"), h(doc, "ul", { class: "vc-drafts-list" }, rows.length ? waiting : [empty]),
          h(doc, "p", { class: "vc-drafts-note" }, "Each person keeps their own drafts. Nothing here is on the website until it is published.")),
        recentRows.length ? h(doc, "section", {}, h(doc, "h2", { class: "vc-drafts-heading" }, "Recently published"), h(doc, "ul", { class: "vc-drafts-list" }, recentRows)) : null),
    ]);
  };

  // ---------------------------------------------------------------- U4: Media (Mr Spa 17)

  const sizeOf = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  // M11: the Media screen of the Mr Spa CMS (src/admin/media-screen.ts).
  const mediaScreen = async (stillHere: () => boolean) => {
    const screen = openMediaScreen({
      doc, api, media, prepare, upload: uploadImage, adjust, measure, groups: imageGroups, actions, stillHere, remember: rememberImages,
      say: (text, tone, action) => say(text, tone ?? "info", action), ask: (text, choice) => ask(text, choice),
      openPlace: (resource, path) => {
        const [kind, key, ...rest] = resource.split(":");
        if (path) pendingFocus = path;
        void go(kind === "file" ? adminHref.file(key) : adminHref.item(key, rest.join(":")));
      },
    });
    show({ title: "Media", crumbs: [["Media"]], leave: () => { screen.leave(); body.classList.remove("vc-body-wide"); } }, [quietHeading("Media"), screen.element]);
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
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  type LiveState = PublishedState | "failed";
  let liveState: { state: LiveState; resources: string[]; pending: PendingPublish } | undefined;
  const publishedStateOf = (resource: string) => (liveState && liveState.resources.includes(resource) ? liveState.state : undefined);
  const remember = (pending: PendingPublish | null) => { try { if (pending) storage?.setItem(PENDING_KEY, JSON.stringify(pending)); else storage?.removeItem(PENDING_KEY); } catch { /* private mode: just not remembered */ } };
  // M6 (Mr Spa): the chip's tooltip counts the time since Publish, every second, while it builds.
  const startElapsed = () => { if (!elapsedTimer) elapsedTimer = setInterval(() => current?.refreshState?.(), 1000); };
  const stopElapsed = () => { if (elapsedTimer) clearInterval(elapsedTimer); elapsedTimer = undefined; };
  const liveChanged = () => {
    const screen = current;
    if (liveState?.state === "live" && screen?.resource && liveState.resources.includes(screen.resource) && !screen.dirty?.()) { void go(currentPath, { replace: true, force: true }); return; }
    screen?.refreshState?.();
  };
  /** The wait before check `attempt` (0 = now): 10, 20, 30, 45 s, then every 60 s (tests pass their own pollMs). */
  const waitBefore = (attempt: number) => (options.pollMs ?? LIVE_CHECK_STEPS[Math.min(attempt - 1, LIVE_CHECK_STEPS.length - 1)]);
  const liveTick = async (attempt = 0) => {
    if (!liveState) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = undefined;
    const { pending } = liveState;
    const result = await api.get<{ liveVersion: string; build?: string }>(`/api/cms/live-version${pending.commit ? `?commit=${encodeURIComponent(pending.commit)}` : ""}`);
    if (!liveState || liveState.pending !== pending) return;
    if (result.ok && result.data.liveVersion === pending.expected) {
      remember(null);
      stopElapsed();
      liveState = { ...liveState, state: "live" };
      liveChanged();
      return;
    }
    // The site's build failed (publish.buildCheck): say so instead of waiting. The receipt stays (checked again on reload).
    if (result.ok && result.data.build === "failed") { stopElapsed(); liveState = { ...liveState, state: "failed" }; liveChanged(); return; }
    // At most 20 minutes from the publish (also across reloads); check `attempt` 0 always runs.
    const wait = waitBefore(attempt + 1);
    if (now() - pending.at + wait > maxWaitMs) { stopElapsed(); liveState = { ...liveState, state: "waiting" }; liveChanged(); return; }
    if (liveState.state !== "publishing") { liveState = { ...liveState, state: "publishing" }; liveChanged(); }
    startElapsed();
    liveTimer = setTimeout(() => { void liveTick(attempt + 1); }, wait);
  };
  const watchLive = (pending: PendingPublish) => {
    if (liveTimer) clearTimeout(liveTimer);
    remember(pending);
    liveState = { state: "publishing", resources: pending.resources ?? [], pending };
    startElapsed();
    void liveTick(0);
  };
  // A publish started before a reload (by this person) is still watched: the receipt stays until it is live.
  try {
    const saved = JSON.parse(storage?.getItem(PENDING_KEY) ?? "null") as PendingPublish | null;
    if (saved && saved.userId === user.id && typeof saved.expected === "string" && typeof saved.at === "number") watchLive(saved);
    else if (saved) remember(null);
  } catch { remember(null); }

  /** M9: the record editor's sections — the collection's `sections`, or one card with every field ("Details"). */
  const recordSectionsOf = (collection: BootCollection, fields: Record<string, Field>) =>
    inspectorSections(fields, collection.sections, "Details").map((section) => ({ ...section, label: section.key === "_other" ? "More" : section.label }));
  /** Mr Spa: the first line of a record's form. */
  const recordRequiredNote = (fields: Record<string, Field>) => (Object.values(fields).some((field) => field.required)
    ? h(doc, "p", { class: "vc-record-required" }, h(doc, "span", { class: "vc-required", "aria-hidden": "true" }, "*"), " Required before you can publish")
    : h(doc, "span", { hidden: true }));
  /** M9: Hide / Show changes the website at once; until the site has rebuilt, the editor shows the new status. */
  const visibilityOverride = new Map<string, unknown>();

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
