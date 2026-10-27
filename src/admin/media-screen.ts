/**
 * M11: the Media screen of the Mr Spa CMS (its media-library.ts) — search, chips (All · Pages · each collection | Not
 * used · Not published yet · Archived), a grid of 4:3 tiles ("1440 × 990 · 184 KB · Salon info +4"), Load more (40),
 * and the detail panel (360 px; × or Esc): Rename (a display name — the address never changes), Copy link, Adjust,
 * Dimensions / Format / File size / Uploaded, "Used on" (each row opens the field), Remove image (an upload never
 * published and used nowhere), Archive / Unarchive (a published upload used nowhere: hidden from the image sheet).
 * The top bar: ⋯ "Remove unused images…" and "Upload images".
 */
import type { Client } from "./api.js";
import type { BootMedia } from "./boot.js";
import { openDialog } from "./dialog.js";
import { clear, h, icon } from "./dom.js";
import { imageDetails, imageName, libraryOrder, openAdjust, savedSort, sortLibrary, sortMenu, sheetBytes, SHEET_PAGE, type Adjust, type LibraryImage, type Measure, type Prepare, type PreparedImage, type Upload } from "./media.js";
import type { ImagePlace, ImageUsage } from "../media/usage.js";

type Note = { displayName?: string; archivedAt?: string; archivedBy?: string; uploadedAt?: string };
type Entry = LibraryImage & { places: ImagePlace[]; staged: boolean; upload: boolean; archivedAt?: string; displayName?: string };
type Usage = { places: ImagePlace[]; drafts: Array<{ resource: string; label: string; mine: boolean }>; draftsKnown: boolean };

export type MediaScreenOptions = {
  doc: Document;
  api: Client;
  media: BootMedia;
  prepare: Prepare;
  upload: Upload;
  adjust: Adjust;
  measure: Measure;
  /** The area chips besides All (Pages, then the collections). */
  groups: string[];
  /** The top bar's right side. */
  actions: HTMLElement;
  say: (text: string, tone?: "info" | "success" | "error", action?: { label: string; run: () => void }) => void;
  ask: (message: string, choice?: { confirm?: string; cancel?: string; danger?: boolean }) => Promise<boolean>;
  /** Open the editor of a resource ("file:site", "item:team:alex") at a field (its path), or just the record. */
  openPlace: (resource: string, path?: string) => void;
  /** What the library knows, for the image cards. */
  remember?: (images: LibraryImage[]) => void;
  /** The page is still this screen. */
  stillHere: () => boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Sep 25, 2026" (the Mr Spa CMS's dates, UTC); a published upload knows only its month ("September 2026"). */
export const mediaDate = (iso: string | undefined, src = "") => {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(at)) return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const match = /\/(20\d{2})\/(0[1-9]|1[0-2])\//.exec(src);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
};
/** "WebP", "JPEG", "PNG", "SVG"… */
export const mediaFormat = (src: string) => { const ext = (src.split(/[?#]/)[0].split(".").pop() ?? "").toUpperCase(); return ext === "JPG" ? "JPEG" : ext === "WEBP" ? "WebP" : ext; };
/** The detail panel's state line (the Mr Spa CMS's mediaStateLabel). */
export const mediaState = (entry: { archivedAt?: string; staged: boolean; upload: boolean }, inUse: boolean | undefined) => {
  if (entry.archivedAt) return "Archived";
  const used = inUse === undefined ? "" : inUse ? " · In use" : " · Not used";
  if (entry.staged) return inUse === false ? "Not published yet · Not used" : "Not published yet";
  return `${entry.upload ? "Published" : "Website image"}${used}`;
};

export const openMediaScreen = (options: MediaScreenOptions) => {
  const { doc, api, media } = options;
  const win = doc.defaultView;
  const uploadPattern = new RegExp(`^${media.base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/20\\d{2}/(0[1-9]|1[0-2])/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}\\.(webp|jpg|png|avif)$`);
  let entries: Entry[] = [];
  let siteSet = new Set<string>();
  let usage: ImageUsage = {};
  let loaded = false;
  let filter = "all";
  let sort = savedSort(win);
  let shown = SHEET_PAGE;
  let selected: Entry | undefined;

  // ---- the filter row
  const search = h(doc, "input", { type: "search", class: "vc-sheet-search-input", placeholder: "Search by file name, page or product", "aria-label": "Search images", autocomplete: "off" });
  const chipList: Array<[string, string]> = [["all", "All"], ...options.groups.map((group): [string, string] => [`group:${group}`, group]), ["divider", ""], ["unused", "Not used"], ...(media.uploads ? [["staged", "Not published yet"] as [string, string]] : []), ["archived", "Archived"]];
  const chips = h(doc, "div", { class: "vc-chips", role: "group", "aria-label": "Show images" },
    ...chipList.map(([key, text]) => key === "divider" ? h(doc, "span", { class: "vc-chip-divider", "aria-hidden": "true" }) : h(doc, "button", { type: "button", class: "vc-chip", "data-filter": key, "aria-pressed": String(key === "all"), onclick: () => { filter = key; shown = SHEET_PAGE; render(); } }, text)));
  const count = h(doc, "p", { class: "vc-sheet-count", "aria-live": "polite" });
  const status = h(doc, "p", { class: "vc-media-status", role: "status", "aria-live": "polite" });
  const grid = h(doc, "div", { class: "vc-sheet-grid vc-media-library", role: "listbox", "aria-label": "Images", tabindex: "0" });
  const empty = h(doc, "p", { class: "vc-sheet-empty", hidden: true });
  const more = h(doc, "button", { type: "button", class: "vc-sheet-more", hidden: true, onclick: () => { shown += SHEET_PAGE; render(); } }, "Load more");
  const panel = h(doc, "aside", { class: "vc-media-panel", "aria-labelledby": "vc-media-panel-name", hidden: true });
  const main = h(doc, "div", { class: "vc-media-main" }, status,
    h(doc, "div", { class: "vc-media-filter-row" }, h(doc, "label", { class: "vc-sheet-search" }, icon(doc, "search"), search), chips, sortMenu(doc, sort, (next) => { sort = next; shown = SHEET_PAGE; render(); }), count), grid, empty, more);
  const element = h(doc, "div", { class: "vc-media-view" }, h(doc, "div", { class: "vc-media-layout" }, main, panel));
  const say = (text: string, state: "" | "saving" | "error" | "success" = "") => { status.textContent = text; status.dataset.state = state; };

  const placesLabel = (places: ImagePlace[]) => { const labels = [...new Set(places.map((place) => place.label))]; return labels.length ? `${labels[0]}${labels.length > 1 ? ` +${labels.length - 1}` : ""}` : ""; };
  const metaOf = (entry: Entry) => [imageDetails(entry.width, entry.height, sheetBytes(entry.bytes)), placesLabel(entry.places)].filter(Boolean).join(" · ");
  const nameOf = (entry: Entry) => entry.displayName || imageName(entry.src, entry.name);
  const visible = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sortLibrary(entries.filter((entry) => {
      if (filter === "archived") { if (!entry.archivedAt) return false; } else if (entry.archivedAt) return false;
      if (filter.startsWith("group:") && (entry.staged || !entry.places.some((place) => `group:${place.group}` === filter))) return false;
      if (filter === "unused" && entry.places.length) return false;
      if (filter === "staged" && !entry.staged) return false;
      const text = [nameOf(entry), imageName(entry.src, entry.name), entry.src, ...entry.places.map((place) => place.label)].join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    }), sort, nameOf, usage);
  };
  const tileId = (src: string) => `vc-media-image-${[...src].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7).toString(36).replace("-", "n")}`;
  const select = (entry: Entry | undefined, open = false) => {
    selected = entry;
    for (const tile of grid.querySelectorAll<HTMLElement>(".vc-sheet-tile")) tile.setAttribute("aria-selected", String(tile.dataset.src === entry?.src));
    if (entry) { grid.setAttribute("aria-activedescendant", tileId(entry.src)); grid.querySelector<HTMLElement>(`#${tileId(entry.src)}`)?.scrollIntoView?.({ block: "nearest" }); }
    if (entry && (open || !panel.hidden)) void openPanel(entry);
  };
  const render = () => {
    for (const chip of chips.querySelectorAll<HTMLElement>(".vc-chip")) chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter));
    clear(grid);
    const list = visible();
    for (const entry of list.slice(0, shown)) {
      const name = nameOf(entry);
      const badge = entry.staged ? "Not published yet" : entry.archivedAt && filter !== "archived" ? "Archived" : "";
      const tile = h(doc, "div", { class: "vc-sheet-tile", role: "option", id: tileId(entry.src), "data-src": entry.src, "aria-selected": String(selected?.src === entry.src), "aria-label": [name, entry.staged ? "not published yet" : "", entry.archivedAt ? "archived" : "", imageDetails(entry.width, entry.height, sheetBytes(entry.bytes))].filter(Boolean).join(", ") },
        h(doc, "span", { class: "vc-sheet-thumb" }, h(doc, "img", { src: entry.src, alt: "", loading: "lazy", decoding: "async" }),
          badge ? h(doc, "span", { class: `vc-sheet-badge${entry.staged ? " vc-sheet-badge-new" : ""}` }, badge) : null,
          h(doc, "span", { class: "vc-sheet-check", "aria-hidden": "true" }, "✓")),
        h(doc, "span", { class: "vc-sheet-name", title: name }, name),
        h(doc, "span", { class: "vc-sheet-meta", ...(entry.places.length ? { title: `Used on ${[...new Set(entry.places.map((place) => place.label))].join(", ")}` } : {}) }, metaOf(entry)));
      tile.addEventListener("click", () => { select(entry, true); grid.focus(); });
      grid.append(tile);
    }
    const query = search.value.trim();
    const chipLabel = chipList.find(([key]) => key === filter)?.[1] ?? "";
    empty.hidden = Boolean(list.length) || !loaded;
    empty.textContent = query ? `No images match "${query}".` : filter !== "all" ? `No images under ${chipLabel}.` : media.uploads ? "No images yet. Use Upload images to add one." : "No images yet.";
    more.hidden = list.length <= shown;
    count.textContent = !loaded ? "Loading images…" : `${list.length.toLocaleString("en-US")} ${list.length === 1 ? "image" : "images"}${query || filter !== "all" ? " found" : ""}`;
  };
  search.addEventListener("input", () => { shown = SHEET_PAGE; render(); });
  grid.addEventListener("keydown", (event) => {
    const list = visible().slice(0, shown);
    if (!list.length) return;
    const index = selected ? list.findIndex((entry) => entry.src === selected!.src) : -1;
    const template = win?.getComputedStyle?.(grid).gridTemplateColumns ?? "";
    const columns = template.split(" ").filter(Boolean).length || 5;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (event.key === "Enter") { event.preventDefault(); if (selected) void openPanel(selected); return; }
    let next: number | undefined;
    if (event.key in step) next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + step[event.key]));
    else if (event.key === "Home") next = 0; else if (event.key === "End") next = list.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(list[next]);
  });

  // ---- the detail panel
  const closePanel = () => { panel.hidden = true; element.classList.remove("has-media-panel"); clear(panel); grid.focus(); if (selected) grid.querySelector<HTMLElement>(`#${tileId(selected.src)}`)?.scrollIntoView?.({ block: "nearest" }); };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !panel.hidden && !doc.querySelector(".vc-overlay")) { event.preventDefault(); closePanel(); } };
  doc.addEventListener("keydown", onKey);
  let panelFor = "";
  const openPanel = async (entry: Entry) => {
    panelFor = entry.src;
    element.classList.add("has-media-panel");
    panel.hidden = false;
    clear(panel);
    const name = nameOf(entry);
    const file = imageName(entry.src, entry.name);
    const stateLine = h(doc, "p", { class: "vc-media-panel-state" }, entry.upload ? "Checking where it is used…" : "Website image · checking where it is used…");
    const dims = entry.width && entry.height ? `${entry.width} × ${entry.height}` : "";
    const facts = h(doc, "dl", { class: "vc-media-panel-details" });
    const fact = (term: string, value: string, first = false) => { if (!value) return; const row = [h(doc, "dt", {}, term), h(doc, "dd", {}, value)]; if (first) facts.prepend(...row); else facts.append(...row); };
    fact("Dimensions", dims); fact("Format", mediaFormat(entry.src)); fact("File size", sheetBytes(entry.bytes));
    fact(entry.staged ? "Uploaded" : "Added", mediaDate(entry.uploadedAt, entry.src));
    if (entry.archivedAt) fact("Archived", mediaDate(entry.archivedAt));
    const picture = h(doc, "img", { src: entry.src, alt: "" });
    picture.addEventListener("load", () => { if (!dims && picture.naturalWidth) fact("Dimensions", `${picture.naturalWidth} × ${picture.naturalHeight}`, true); });
    const places = h(doc, "ul", { class: "vc-media-panel-places", "aria-live": "polite" }, h(doc, "li", { class: "vc-media-panel-note" }, "Checking…"));
    const footer = h(doc, "div", { class: "vc-media-panel-footer", hidden: true });
    const action = (text: string, run: () => void) => h(doc, "button", { type: "button", class: "vc-button", onclick: run }, text);
    panel.append(
      h(doc, "div", { class: "vc-media-panel-head" }, h(doc, "p", { class: "vc-media-panel-kicker" }, "Image details"), h(doc, "button", { type: "button", class: "vc-media-panel-close", "aria-label": "Close details", "data-tooltip": "Close", onclick: closePanel }, icon(doc, "remove"))),
      h(doc, "div", { class: "vc-media-panel-preview" }, picture),
      h(doc, "h2", { class: "vc-media-panel-name", id: "vc-media-panel-name" }, name),
      file !== name ? h(doc, "p", { class: "vc-media-panel-file" }, file) : h(doc, "span", { hidden: true }),
      stateLine,
      h(doc, "div", { class: "vc-media-panel-actions" },
        entry.upload ? action("Rename", () => rename(entry)) : null,
        action("Copy link", () => { void copy(entry); }),
        entry.upload && media.uploads ? action("Adjust", () => adjustCopy(entry)) : null),
      facts,
      h(doc, "h3", { class: "vc-media-panel-heading" }, "Used on"),
      places, footer);
    const result = await api.get<Usage>(`/api/cms/media/usage?src=${encodeURIComponent(entry.src)}`);
    if (panelFor !== entry.src || !options.stillHere()) return;
    clear(places);
    if (!result.ok) { stateLine.textContent = mediaState(entry, undefined); places.append(h(doc, "li", { class: "vc-media-panel-note" }, "Could not check where this image is used. Open it again to retry.")); return; }
    const { places: where, drafts, draftsKnown } = result.data;
    const inUse = where.length > 0 || drafts.length > 0 || !draftsKnown;
    stateLine.textContent = mediaState(entry, inUse);
    for (const place of where) {
      const label = `${place.group === "Pages" ? place.label : `${place.group} › ${place.label}`}`;
      places.append(h(doc, "li", {}, place.resource
        ? h(doc, "button", { type: "button", class: "vc-media-place", "aria-label": `Open ${label}, ${place.detail ?? ""}`, onclick: () => options.openPlace(place.resource!, place.path) }, h(doc, "span", { class: "vc-media-place-label" }, label), h(doc, "span", { class: "vc-media-place-detail" }, place.detail ?? ""))
        : h(doc, "span", { class: "vc-media-place is-static" }, h(doc, "span", { class: "vc-media-place-label" }, label))));
    }
    for (const draft of drafts) places.append(h(doc, "li", {}, draft.mine
      ? h(doc, "button", { type: "button", class: "vc-media-place", "aria-label": `Open ${draft.label}, Saved draft, not published yet`, onclick: () => options.openPlace(draft.resource) }, h(doc, "span", { class: "vc-media-place-label" }, draft.label || "A saved draft"), h(doc, "span", { class: "vc-media-place-detail" }, "Saved draft, not published yet"))
      : h(doc, "span", { class: "vc-media-place is-static" }, h(doc, "span", { class: "vc-media-place-label" }, "A saved draft"), h(doc, "span", { class: "vc-media-place-detail" }, "Saved draft, not published yet"))));
    if (!where.length && !drafts.length) places.append(h(doc, "li", { class: "vc-media-panel-note" }, draftsKnown ? "Not used on the website or in a saved draft." : "Could not read the saved drafts, so this image counts as in use."));
    // Remove (never published, used nowhere) · Archive (published, used nowhere) · Unarchive.
    const danger = (text: string, run: () => void) => h(doc, "button", { type: "button", class: "vc-button vc-danger", onclick: run }, text);
    const note = (text: string) => h(doc, "p", { class: "vc-media-panel-note" }, text);
    if (entry.upload && entry.archivedAt) footer.append(action("Unarchive", () => { void archive(entry, false); }));
    else if (entry.upload && entry.staged && !inUse && media.uploads) footer.append(danger("Remove image", () => { void remove(entry); }), note("Not published and not used in any draft: removing deletes it for good."));
    else if (entry.upload && !entry.staged && !inUse) footer.append(action("Archive image", () => { void archive(entry, true); }), note("Archive hides it from the library. The file stays on the website."));
    else if (entry.upload && inUse) { const total = where.length + drafts.length; footer.append(note(`${total ? `In use on ${total} ${total === 1 ? "place" : "places"}.` : "In use."} Replace it there first to remove or archive it.`)); }
    footer.hidden = !footer.childElementCount;
  };

  // ---- the actions
  const copy = async (entry: Entry) => {
    const address = new URL(entry.src, win?.location.href ?? "http://localhost").href;
    try { await win?.navigator.clipboard.writeText(address); options.say("Image link copied"); } catch { say(`Image link: ${address}`); }
  };
  const rename = (entry: Entry) => {
    const input = h(doc, "input", { type: "text", class: "vc-input", maxlength: "120", autocomplete: "off" });
    input.value = nameOf(entry);
    const line = h(doc, "p", { class: "vc-media-rename-status", role: "status" });
    const dialog = openDialog(doc, {
      title: "Rename image", text: "This changes the display name only. The image URL and existing references stay unchanged.",
      body: [h(doc, "label", { class: "vc-media-rename-label" }, "Image name", input), line],
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Save name", kind: "primary", value: "save" }],
      onButton: async (value, open) => {
        if (value !== "save") return;
        const name = input.value.trim();
        if (!name) { line.dataset.state = "error"; line.textContent = "Enter an image name."; return false; }
        open.busy(true); line.dataset.state = "saving"; line.textContent = "Saving name…";
        const result = await api.post<{ src: string; displayName: string }>("/api/cms/media/name", { src: entry.src, name });
        open.busy(false);
        if (!result.ok) { line.dataset.state = "error"; line.textContent = result.message || "The image name could not be saved."; return false; }
        entry.displayName = result.data.displayName;
        render(); void openPanel(entry);
        options.say("Name saved. The image address did not change.");
        return true;
      },
    });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); dialog.element.querySelector<HTMLElement>('[data-value="save"]')?.click(); } });
    input.focus(); input.select();
  };
  const adjustCopy = (entry: Entry) => openAdjust({ doc, image: entry, measure: options.measure, adjust: options.adjust, upload: options.upload, maxBytes: media.maxBytes, onCreated: (image) => {
    const made: Entry = { ...image, source: "upload", places: [], staged: true, upload: true };
    entries = [made, ...entries.filter((other) => other.src !== made.src)];
    filter = filter === "staged" ? filter : "all"; search.value = "";
    render(); select(made, true);
    options.say("Adjusted copy created. It is not published yet.");
  } });
  const remove = async (entry: Entry) => {
    const name = nameOf(entry);
    if (!(await options.ask(`Remove image\n\nRemove ${name}? It is not published and no draft uses it, so it is deleted for good.`, { confirm: "Remove", danger: true }))) return;
    const result = await api.delete(`/api/cms/media?src=${encodeURIComponent(entry.src)}`);
    if (!result.ok) { say(result.message, "error"); return; }
    entries = entries.filter((other) => other.src !== entry.src);
    selected = undefined; closePanel(); render();
    options.say("Image removed");
  };
  const archive = async (entry: Entry, on: boolean) => {
    const result = await api.post<{ archivedAt?: string }>(`/api/cms/media/${on ? "archive" : "unarchive"}`, { src: entry.src });
    if (!result.ok) { say(result.message, "error"); return; }
    entry.archivedAt = on ? result.data.archivedAt ?? new Date().toISOString() : undefined;
    closePanel(); render();
    if (on) options.say("Image archived. Find it under Archived.", "info", { label: "Undo", run: () => { void archive(entry, false); } });
    else options.say("Image is back in the library");
  };
  const cleanup = async () => {
    say("Checking which images are unused…", "saving");
    const checked = await api.post<{ removed: number; keptRecent: number }>("/api/cms/media/cleanup", { dryRun: true });
    if (!checked.ok) { say(checked.message || "Unused images could not be removed.", "error"); return; }
    say("");
    const { removed: count, keptRecent } = checked.data;
    const recent = keptRecent ? ` ${keptRecent} unused ${keptRecent === 1 ? "image" : "images"} uploaded in the last 30 days ${keptRecent === 1 ? "is" : "are"} kept.` : "";
    if (!count) { options.say(`No unused images older than 30 days.${recent}`); return; }
    const many = count !== 1;
    if (!(await options.ask(`Remove unused images\n\nRemove ${count} ${many ? "images" : "image"}? ${many ? "They were" : "It was"} uploaded more than 30 days ago, never published, and no page, record or saved draft uses ${many ? "them" : "it"}.${recent}`, { confirm: `Remove ${count} ${many ? "images" : "image"}`, danger: true }))) return;
    say("Removing unused images…", "saving");
    const done = await api.post<{ removed: number }>("/api/cms/media/cleanup", { dryRun: false });
    if (!done.ok) { say(done.message || "Unused images could not be removed.", "error"); return; }
    say(""); if (!panel.hidden) closePanel();
    await load();
    options.say(done.data.removed ? `${done.data.removed} unused ${done.data.removed === 1 ? "image" : "images"} removed` : "No unused images older than 30 days.");
  };

  // ---- the top bar: ⋯ Remove unused images… · Upload images
  if (media.uploads) {
    const menu = h(doc, "div", { class: "vc-menu vc-media-more-menu", role: "menu", "aria-label": "More media actions", hidden: true },
      h(doc, "button", { type: "button", class: "vc-menu-item vc-danger", role: "menuitem", onclick: () => { menu.hidden = true; void cleanup(); } }, "Remove unused images…"));
    const toggle = h(doc, "button", { type: "button", class: "vc-icon-button vc-top-icon", "aria-label": "More media actions", "aria-haspopup": "menu", "aria-expanded": "false", "data-tooltip": "More", onclick: (event: Event) => { event.stopPropagation(); menu.hidden = !menu.hidden; toggle.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLElement>("button")?.focus(); } }, icon(doc, "more"));
    menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { menu.hidden = true; toggle.focus(); } });
    doc.addEventListener("pointerdown", (event) => { if (!menu.hidden && !menu.contains(event.target as Node) && event.target !== toggle) menu.hidden = true; }, true);
    const fileInput = h(doc, "input", { type: "file", accept: "image/jpeg,image/png,image/avif,image/webp", multiple: true, hidden: true, id: "vc-media-file", "aria-label": "Images to upload" });
    const uploadButton = h(doc, "button", { type: "button", class: "vc-button vc-primary", "data-action": "upload-images", onclick: () => fileInput.click() }, icon(doc, "upload"), "Upload images");
    fileInput.addEventListener("change", async () => {
      const files = [...(fileInput.files ?? [])];
      fileInput.value = "";
      if (!files.length) return;
      uploadButton.disabled = true;
      say(`Uploading ${files.length} ${files.length === 1 ? "image" : "images"}…`, "saving");
      const done: Entry[] = [];
      for (const file of files) {
        let prepared: PreparedImage;
        try { prepared = await options.prepare(file); } catch (error) { say((error as Error).message, "error"); break; }
        if (prepared.blob.size > media.maxBytes) { say("This file is larger than 10 MB. Choose a smaller image.", "error"); break; }
        const result = await options.upload(prepared);
        if (!result.ok) { say(result.message || `Unable to upload ${file.name}`, "error"); break; }
        const made: Entry = { ...result.image, source: "upload", places: [], staged: true, upload: true };
        entries = [made, ...entries.filter((other) => other.src !== made.src)];
        done.push(made);
      }
      uploadButton.disabled = false;
      if (status.dataset.state !== "error") say("");
      if (!done.length) return;
      if (filter !== "all" && filter !== "staged") filter = "all";
      search.value = "";
      render(); select(done[done.length - 1], true);
      options.say(done.length === 1 ? "Image uploaded. Not published yet — place it with Replace on a page." : `${done.length} images uploaded. Not published yet — place them with Replace on a page.`);
    });
    options.actions.append(h(doc, "div", { class: "vc-media-more" }, toggle, menu), fileInput, uploadButton);
  }

  // ---- load: uploads not on the website yet first, then uploads newest first, then the website's images (used first)
  const load = async () => {
    loaded = false; render();
    const result = await api.get<{ uploads: LibraryImage[]; site: LibraryImage[]; usage?: ImageUsage; notes?: Record<string, Note> }>("/api/cms/media");
    if (!options.stillHere()) return;
    loaded = true;
    if (!result.ok) { say("The image library could not be loaded.", "error"); render(); return; }
    usage = result.data.usage ?? {};
    const notes = result.data.notes ?? {};
    siteSet = new Set(result.data.site.map((image) => image.src));
    const withNote = (image: LibraryImage, source: "upload" | "site"): Entry => {
      const note = notes[image.src] ?? {};
      return { ...image, ...(note.uploadedAt ? { uploadedAt: note.uploadedAt } : {}), source, places: usage[image.src] ?? [], staged: source === "upload" && !siteSet.has(image.src), upload: uploadPattern.test(image.src), ...(note.archivedAt ? { archivedAt: note.archivedAt } : {}), ...(note.displayName ? { displayName: note.displayName } : {}) };
    };
    const uploads = result.data.uploads.map((image) => withNote(image, "upload"));
    const site = result.data.site.map((image) => withNote(image, "site"));
    entries = libraryOrder(uploads, site, usage);
    options.remember?.(entries);
    render();
  };
  void load();
  return { element, leave: () => doc.removeEventListener("keydown", onKey) };
};
