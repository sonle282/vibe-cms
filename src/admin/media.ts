/**
 * P10 / M5: choosing an image — the image sheet of the Mr Spa CMS (Library | Upload, search, chips, a 5-column grid,
 * "Load more", Cancel · Use image) — and Adjust (a new copy of an image for one image area: Shape + focus point).
 *
 * Before uploading, the browser prepares the file: the longest edge at most 2400 px and WebP (JPEG / PNG when the
 * browser cannot write WebP); re-encoding also drops hidden data such as the camera's GPS position. The server checks
 * the real type from the bytes anyway (src/media).
 */
import type { Client } from "./api.js";
import type { BootMedia } from "./boot.js";
import { openDialog } from "./dialog.js";
import { clear, h, icon } from "./dom.js";
import type { ImagePlace, ImageUsage } from "../media/usage.js";

export type LibraryImage = { src: string; width?: number; height?: number; bytes: number; uploadedAt?: string; name?: string; source: "upload" | "site" };
export type PreparedImage = { blob: Blob; name: string; width?: number; height?: number };
export type Prepare = (file: File) => Promise<PreparedImage>;
/** Upload a prepared image; `onProgress` gets 0–1 while the bytes go out. `reused`: the same image was already uploaded. */
export type Upload = (prepared: PreparedImage, onProgress?: (fraction: number) => void) => Promise<{ ok: true; image: LibraryImage; reused?: boolean } | { ok: false; message: string }>;

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const MAX_EDGE = 2400;

/** Resize (longest edge ≤ 2400 px) and re-encode in the browser; falls back to the file itself where canvas is missing. */
export const prepareImage = (win: Window): Prepare => async (file) => {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error(TYPE_PROBLEM);
  const name = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const scope = win as unknown as { createImageBitmap?: typeof createImageBitmap; OffscreenCanvas?: typeof OffscreenCanvas };
  if (typeof scope.createImageBitmap !== "function") return { blob: file, name: file.name };
  let bitmap: ImageBitmap;
  try { bitmap = await scope.createImageBitmap(file); } catch { throw new Error("This file can't be read as an image."); }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = win.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { blob: file, name: file.name, width: bitmap.width, height: bitmap.height };
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp", 0.82);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") { const fallback = file.type === "image/png" ? "image/png" : "image/jpeg"; blob = await encode(fallback, 0.86); ext = fallback === "image/png" ? "png" : "jpg"; }
  if (!blob) throw new Error("This image could not be prepared for the website.");
  return { blob, name: `${name}.${ext}`, width, height };
};

// ---------------------------------------------------------------- M5: the Mr Spa CMS's words and formats

export const TYPE_PROBLEM = "This file type is not supported. Choose a JPEG, PNG, AVIF or WebP image.";
/** The size the Mr Spa CMS writes: "10 MB" (whole MB), else KB. */
const limitText = (bytes: number) => (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0 ? `${bytes / 1024 / 1024} MB` : sheetBytes(bytes));
/** Why a file cannot go into an image area (before it is uploaded), or null. */
export const imageFileProblem = (file: { type: string; size: number }, maxBytes: number) => {
  if (!ACCEPTED_TYPES.includes(file.type)) return TYPE_PROBLEM;
  if (file.size > maxBytes) return `This file is larger than ${limitText(maxBytes)}. Choose a smaller image.`;
  if (file.size === 0) return "This file is empty. Choose another image.";
  return null;
};
/** On an image card: "194 KB", "1.0 MB". */
export const cardBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
/** In the image sheet: "184 KB", "1 MB", "1.4 MB"; nothing for 0. */
export const sheetBytes = (bytes: number) => (!bytes || bytes < 0 ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`);
/** "showroom-ne…op-1920.webp": the start and the end of a long name, the whole name in a tooltip. */
export const middleTruncate = (name: string, max: number) => {
  if (name.length <= max) return name;
  const tail = Math.min(12, Math.floor((max - 1) / 2));
  return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
};
/** The name people see for an image: its own name, else the last part of its address. */
export const imageName = (src: string, name?: string) => name || (src.startsWith("data:") ? "Embedded image" : decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() || src));
/** "1920 × 1280 · 194 KB" — each part when it is known. */
export const imageDetails = (width?: number, height?: number, bytes?: string) => [width && height ? `${width} × ${height}` : "", bytes ?? ""].filter(Boolean).join(" · ");

// ---------------------------------------------------------------- M5: Adjust = a new copy for one image area

/** The Mr Spa CMS's shapes: Original (the same picture, made again for the web) or a fixed size cut around the focus point. */
export const ADJUST_SHAPES: Array<{ key: string; label: string; size: { width: number; height: number } | null }> = [
  { key: "original", label: "Original", size: null },
  { key: "square", label: "Square", size: { width: 1200, height: 1200 } },
  { key: "landscape", label: "Landscape", size: { width: 1600, height: 900 } },
  { key: "portrait", label: "Portrait", size: { width: 1200, height: 1500 } },
];
export type CropRect = { x: number; y: number; width: number; height: number };
/**
 * The part of the image that is kept, in its own pixels: the whole image for Original; otherwise the largest box of
 * the shape, centred on the focus point (fractions 0–1 of the image) as far as the image allows ("cover").
 */
export const adjustRect = (image: { width: number; height: number }, shape: string, focusX = 0.5, focusY = 0.5): CropRect => {
  const size = ADJUST_SHAPES.find((entry) => entry.key === shape)?.size;
  if (!size) return { x: 0, y: 0, width: image.width, height: image.height };
  const ratio = size.width / size.height;
  let width = image.width; let height = width / ratio;
  if (height > image.height) { height = image.height; width = height * ratio; }
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  const x = Math.round(Math.min(image.width - width, Math.max(0, focusX * image.width - width / 2)));
  const y = Math.round(Math.min(image.height - height, Math.max(0, focusY * image.height - height / 2)));
  return { x, y, width, height };
};
/** The copy's size: the shape's size (never larger than the part kept), or for Original the image, at most 2400 px. */
export const adjustSize = (rect: CropRect, shape: string) => {
  const size = ADJUST_SHAPES.find((entry) => entry.key === shape)?.size;
  const scale = size ? Math.min(1, rect.width / size.width) : Math.min(1, MAX_EDGE / Math.max(rect.width, rect.height));
  const width = size ? size.width : rect.width; const height = size ? size.height : rect.height;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

export type Adjust = (src: string, rect: CropRect, size: { width: number; height: number }, name: string) => Promise<PreparedImage>;
/** The image's natural size (to place the crop), read in the browser. */
export type Measure = (src: string) => Promise<{ width: number; height: number }>;

const loadBitmap = async (win: Window, src: string) => {
  const scope = win as unknown as { createImageBitmap?: typeof createImageBitmap };
  if (typeof scope.createImageBitmap !== "function") throw new Error("This browser cannot change images.");
  // Same origin (the site's own images and its uploads): reading the bytes keeps the canvas clean.
  const response = await win.fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error("The image could not be loaded.");
  return scope.createImageBitmap(await response.blob());
};
export const measureImage = (win: Window): Measure => async (src) => { const bitmap = await loadBitmap(win, src); const size = { width: bitmap.width, height: bitmap.height }; bitmap.close?.(); return size; };

/** Cut and scale in a canvas, WebP (JPEG where the browser cannot write WebP) — the original is only read. */
export const adjustImage = (win: Window): Adjust => async (src, rect, size, name) => {
  const bitmap = await loadBitmap(win, src);
  const canvas = win.document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot change images.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
  bitmap.close?.();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp", 0.85); let ext = "webp";
  if (!blob || blob.type !== "image/webp") { blob = await encode("image/jpeg", 0.88); ext = "jpg"; }
  if (!blob) throw new Error("The new image could not be made.");
  return { blob, name: `${name}.${ext}`, width: size.width, height: size.height };
};

export type AdjustOptions = { doc: Document; image: LibraryImage; measure: Measure; adjust: Adjust; upload: Upload; maxBytes: number; onCreated: (image: LibraryImage) => void };
/** The Shape chosen last time (the Mr Spa CMS keeps it between openings). */
let lastShape = "original";

/**
 * M5: the Mr Spa CMS's "Adjust image" — Shape (Original / Square / Landscape / Portrait), the focus point (click the
 * preview, or the Horizontal / Vertical focus sliders), "Create adjusted copy". The copy is uploaded as a new image
 * ("Not published yet"); the original is never changed.
 */
export const openAdjust = ({ doc, image, measure, adjust, upload, maxBytes, onCreated }: AdjustOptions) => {
  let x = 50; let y = 50;
  const name = imageName(image.src, image.name);
  const picture = h(doc, "img", { src: image.src, alt: name, draggable: "false" });
  const preview = h(doc, "button", { type: "button", class: "vc-adjust-preview", "aria-label": "Set image focus point" }, picture);
  const slider = (label: string, which: "x" | "y") => {
    const output = h(doc, "output", {}, "50%");
    const input = h(doc, "input", { type: "range", min: "0", max: "100", value: "50", "data-focus": which });
    input.addEventListener("input", () => { if (which === "x") x = Number(input.value); else y = Number(input.value); show(); });
    return { output, input, element: h(doc, "label", { class: "vc-adjust-range" }, h(doc, "span", {}, `${label} `, output), input) };
  };
  const horizontal = slider("Horizontal focus", "x");
  const vertical = slider("Vertical focus", "y");
  const show = () => {
    horizontal.input.value = String(x); vertical.input.value = String(y);
    horizontal.output.textContent = `${x}%`; vertical.output.textContent = `${y}%`;
    picture.style.objectPosition = `${x}% ${y}%`;
  };
  preview.addEventListener("click", (event) => {
    const box = preview.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const at = event as MouseEvent;
    x = Math.round(Math.min(100, Math.max(0, ((at.clientX - box.left) / box.width) * 100)));
    y = Math.round(Math.min(100, Math.max(0, ((at.clientY - box.top) / box.height) * 100)));
    show();
  });
  const shapes = h(doc, "fieldset", { class: "vc-adjust-shapes" }, h(doc, "legend", {}, "Shape"),
    ...ADJUST_SHAPES.map((shape) => {
      const radio = h(doc, "input", { type: "radio", name: "vc-adjust-shape", value: shape.key, checked: shape.key === lastShape });
      radio.addEventListener("change", () => { if (radio.checked) lastShape = shape.key; });
      return h(doc, "label", {}, radio, ` ${shape.label}`);
    }));
  const status = h(doc, "p", { class: "vc-adjust-status", role: "status", "aria-live": "polite" });
  const dialog = openDialog(doc, {
    title: "Adjust image",
    text: "Create a new copy for this image area. Your original image will stay unchanged.",
    body: [h(doc, "div", { class: "vc-adjust-layout" },
      h(doc, "div", { class: "vc-adjust-preview-wrap" }, preview, h(doc, "span", { class: "vc-adjust-note" }, "Click the preview to set the focus point.")),
      h(doc, "div", { class: "vc-adjust-options" }, shapes, horizontal.element, vertical.element, h(doc, "p", { class: "vc-adjust-note" }, "Original stays available in Media and is never overwritten."))),
    status],
    buttons: [{ label: "Cancel", value: "cancel" }, { label: "Create adjusted copy", kind: "primary", value: "create" }],
    onButton: async (value, open) => {
      if (value !== "create") return;
      const shape = (shapes.querySelector<HTMLInputElement>("input:checked")?.value) ?? "square";
      open.busy(true);
      status.dataset.state = "saving"; status.textContent = "Creating adjusted copy…";
      try {
        const natural = image.width && image.height ? { width: image.width, height: image.height } : await measure(image.src);
        const rect = adjustRect(natural, shape, x / 100, y / 100);
        const size = adjustSize(rect, shape);
        const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/-[0-9a-f]{8}$/, "");
        const made = await adjust(image.src, rect, size, `${base}-${shape}`);
        if (made.blob.size > maxBytes) throw new Error("too large");
        const result = await upload(made);
        if (!result.ok) throw new Error(result.message);
        open.busy(false);
        open.close("created");
        onCreated(result.image);
        return false;
      } catch {
        open.busy(false);
        status.dataset.state = "error"; status.textContent = "Adjustment failed. Your original image is unchanged.";
        return false;
      }
    },
  });
  dialog.element.classList.add("vc-adjust-dialog");
  show();
  dialog.element.querySelector<HTMLElement>('[data-value="create"]')?.focus();
  return dialog;
};

// ---------------------------------------------------------------- the image sheet

export type PickerOptions = {
  doc: Document;
  api: Client;
  media: BootMedia;
  prepare: Prepare;
  upload: Upload;
  current?: string;
  onPick: (image: LibraryImage) => void;
  /** The image area ("Choose image for Hero image"). */
  label?: string;
  /** M5: where it is ("Homepage › Showroom"). */
  context?: string;
  /** M5: a line under the title. */
  hint?: string;
  /** M5: the area chips besides All, in order (Pages, then the collections). */
  groups?: string[];
  /** M5: an image to show first and select (a copy just made with Adjust). */
  select?: LibraryImage;
  /** M5: the images the sheet loaded (with where they are used), for the image cards' file sizes. */
  onLoad?: (images: LibraryImage[]) => void;
};

/** Mr Spa: 40 images at a time. */
export const SHEET_PAGE = 40;
type Entry = LibraryImage & { places: ImagePlace[]; staged: boolean; current?: boolean };

/** Open the sheet; returns a function that closes it. */
export const openImagePicker = (options: PickerOptions) => {
  const { doc, api, media } = options;
  const win = doc.defaultView;
  const opener = doc.activeElement as HTMLElement | null;
  let entries: Entry[] = [];
  let loaded = false;
  let failed = false;
  let filter = "all";
  let shown = SHEET_PAGE;
  let selected: Entry | undefined;
  const titleId = "vc-sheet-title";

  // ---- head and bar
  const close = () => {
    doc.removeEventListener("keydown", onKey, true);
    for (const element of inerted) element.removeAttribute("inert");
    overlay.remove();
    opener?.focus?.({ preventScroll: true });
  };
  const titleText = options.label ? `Choose image for ${options.label}` : "Choose an image";
  const head = h(doc, "header", { class: "vc-sheet-head" },
    h(doc, "div", { class: "vc-sheet-titles" },
      h(doc, "p", { class: "vc-sheet-context", hidden: !options.context }, options.context ?? ""),
      h(doc, "h2", { id: titleId, class: "vc-sheet-title" }, titleText),
      h(doc, "p", { class: "vc-sheet-hint", hidden: !options.hint }, options.hint ?? "")),
    h(doc, "button", { type: "button", class: "vc-sheet-close", "aria-label": "Close", "data-tooltip": "Close", onclick: close }, icon(doc, "remove")));
  const tab = (name: "library" | "upload", text: string) => h(doc, "button", { type: "button", role: "tab", id: `vc-sheet-tab-${name}`, class: "vc-sheet-tab", "aria-controls": `vc-sheet-panel-${name}`, "aria-selected": String(name === "library"), tabindex: name === "library" ? "0" : "-1", "data-tab": name, onclick: () => showTab(name) }, text);
  const tabs = h(doc, "div", { class: "vc-sheet-tabs", role: "tablist", "aria-label": "Image source" }, tab("library", "Library"), tab("upload", "Upload"));
  const search = h(doc, "input", { type: "search", class: "vc-sheet-search-input", placeholder: "Search by file name, page or product", "aria-label": "Search images", autocomplete: "off" });
  const searchBox = h(doc, "label", { class: "vc-sheet-search" }, icon(doc, "search"), search);
  const count = h(doc, "p", { class: "vc-sheet-count", "aria-live": "polite" });
  const bar = h(doc, "div", { class: "vc-sheet-bar" }, tabs, searchBox, count);
  const chipList: Array<[string, string]> = [["all", "All"], ...(options.groups ?? []).map((group): [string, string] => [`group:${group}`, group]), ["divider", ""], ["unused", "Not used"], ...(media.uploads ? [["staged", "Not published yet"] as [string, string]] : [])];
  const chips = h(doc, "div", { class: "vc-chips", role: "group", "aria-label": "Show images" },
    ...chipList.map(([key, text]) => key === "divider" ? h(doc, "span", { class: "vc-chip-divider", "aria-hidden": "true" }) : h(doc, "button", { type: "button", class: "vc-chip", "data-filter": key, "aria-pressed": String(key === "all"), onclick: () => { filter = key; shown = SHEET_PAGE; render(); } }, text)));
  const chipRow = h(doc, "div", { class: "vc-sheet-chips" }, chips);

  // ---- library
  const grid = h(doc, "div", { class: "vc-sheet-grid", role: "listbox", "aria-label": "Images", tabindex: "0" });
  const empty = h(doc, "p", { class: "vc-sheet-empty", hidden: true });
  const more = h(doc, "button", { type: "button", class: "vc-sheet-more", hidden: true, onclick: () => { shown += SHEET_PAGE; render(); } }, "Load more");
  const libraryPanel = h(doc, "div", { class: "vc-sheet-panel", id: "vc-sheet-panel-library", role: "tabpanel", "aria-labelledby": "vc-sheet-tab-library" }, grid, empty, more);

  // ---- footer
  const selection = h(doc, "p", { class: "vc-sheet-selection", "aria-live": "polite" }, "No image selected");
  const error = h(doc, "p", { class: "vc-sheet-error", role: "alert", hidden: true });
  const useButton = h(doc, "button", { type: "button", class: "vc-sheet-use", "data-action": "use-image", disabled: true, onclick: () => use() }, "Use image");
  const foot = h(doc, "footer", { class: "vc-sheet-foot" }, selection, error, h(doc, "button", { type: "button", class: "vc-sheet-cancel", onclick: close }, "Cancel"), useButton);

  const metaOf = (entry: Entry) => {
    const labels = [...new Set(entry.places.map((place) => place.label))];
    const places = labels.length ? `${labels[0]}${labels.length > 1 ? ` +${labels.length - 1}` : ""}` : "";
    return [imageDetails(entry.width, entry.height, sheetBytes(entry.bytes)), places].filter(Boolean).join(" · ");
  };
  const matches = (entry: Entry, words: string[]) => {
    const text = [imageName(entry.src, entry.name), entry.src, ...entry.places.map((place) => place.label)].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const visible = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((entry) => {
      if (entry.current && filter !== "all") return false;
      if (filter.startsWith("group:") && (entry.staged || !entry.places.some((place) => `group:${place.group}` === filter))) return false;
      if (filter === "unused" && entry.places.length) return false;
      if (filter === "staged" && !entry.staged) return false;
      return matches(entry, words);
    });
  };
  const tileId = (src: string) => `vc-sheet-image-${[...src].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7).toString(36).replace("-", "n")}`;
  const select = (entry: Entry | undefined, focus = false) => {
    selected = entry;
    for (const tile of grid.querySelectorAll<HTMLElement>(".vc-sheet-tile")) tile.setAttribute("aria-selected", String(tile.dataset.src === entry?.src));
    if (entry) { grid.setAttribute("aria-activedescendant", tileId(entry.src)); grid.querySelector<HTMLElement>(`#${tileId(entry.src)}`)?.scrollIntoView?.({ block: "nearest" }); } else grid.removeAttribute("aria-activedescendant");
    selection.textContent = entry ? [imageName(entry.src, entry.name), imageDetails(entry.width, entry.height, sheetBytes(entry.bytes))].filter(Boolean).join(" · ") : "No image selected";
    useButton.disabled = !entry;
    if (focus) grid.focus();
  };
  const render = () => {
    for (const chip of chips.querySelectorAll<HTMLElement>(".vc-chip")) chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter));
    clear(grid);
    const list = visible();
    for (const entry of list.slice(0, shown)) {
      const name = imageName(entry.src, entry.name);
      const badge = entry.current ? "Current" : entry.staged ? "Not published yet" : "";
      const details = imageDetails(entry.width, entry.height, sheetBytes(entry.bytes));
      const tile = h(doc, "div", { class: "vc-sheet-tile", role: "option", id: tileId(entry.src), "data-src": entry.src, "aria-selected": String(selected?.src === entry.src), "aria-label": [name, entry.current ? "current image" : "", entry.staged ? "not published yet" : "", details].filter(Boolean).join(", ") },
        h(doc, "span", { class: "vc-sheet-thumb" }, h(doc, "img", { src: entry.src, alt: "", loading: "lazy", decoding: "async" }),
          badge ? h(doc, "span", { class: `vc-sheet-badge${entry.current ? "" : " vc-sheet-badge-new"}` }, badge) : null,
          h(doc, "span", { class: "vc-sheet-check", "aria-hidden": "true" }, "✓")),
        h(doc, "span", { class: "vc-sheet-name", title: name }, name),
        h(doc, "span", { class: "vc-sheet-meta", ...(entry.places.length ? { title: `Used on ${[...new Set(entry.places.map((place) => place.label))].join(", ")}` } : {}) }, metaOf(entry)));
      tile.addEventListener("click", () => select(entry, true));
      tile.addEventListener("dblclick", () => { select(entry); use(); });
      grid.append(tile);
    }
    const query = search.value.trim();
    const chipLabel = chipList.find(([key]) => key === filter)?.[1] ?? "";
    empty.hidden = Boolean(list.length) || !loaded;
    empty.textContent = failed ? "" : query ? `No images match "${query}".` : filter !== "all" ? `No images under ${chipLabel}.` : media.uploads ? "No images yet. Upload one in the Upload tab." : "No images yet.";
    more.hidden = list.length <= shown;
    count.textContent = !loaded ? "Loading images…" : `${list.length.toLocaleString("en-US")} ${list.length === 1 ? "image" : "images"}${query || filter !== "all" ? " found" : ""}`;
  };
  search.addEventListener("input", () => { shown = SHEET_PAGE; render(); });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (!selected) { const first = visible()[0]; if (first) select(first); }
    grid.focus();
  });
  const columns = () => {
    const template = win?.getComputedStyle?.(grid).gridTemplateColumns ?? "";
    const counted = template.split(" ").filter(Boolean).length;
    return counted > 0 && counted <= 8 ? counted : 5;
  };
  grid.addEventListener("keydown", (event) => {
    const list = visible().slice(0, shown);
    if (!list.length) return;
    const index = selected ? list.findIndex((entry) => entry.src === selected!.src) : -1;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() };
    if (event.key === "Enter") { event.preventDefault(); if (selected) use(); return; }
    let next: number | undefined;
    if (event.key in step) next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + step[event.key]));
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(list[next]);
  });
  grid.addEventListener("focus", () => { if (!selected && grid.matches?.(":focus-visible")) { const first = visible()[0]; if (first) select(first); } });

  // A pick of the image the area already has changes nothing.
  const use = () => {
    if (!selected) return;
    const image = selected;
    close();
    if (image.current || image.src === options.current) return;
    const { places: _places, staged: _staged, current: _current, ...picked } = image;
    options.onPick(picked);
  };

  // ---- upload
  const uploadStatus = h(doc, "p", { class: "vc-sheet-upload-status", role: "status", "data-state": "idle" });
  const progress = h(doc, "div", { class: "vc-sheet-progress", role: "progressbar", "aria-label": "Upload progress", "aria-valuemin": "0", "aria-valuemax": "100", hidden: true }, h(doc, "span", {}));
  const setProgress = (percent: number) => { progress.hidden = false; progress.setAttribute("aria-valuenow", String(percent)); (progress.firstElementChild as HTMLElement).style.width = `${percent}%`; };
  const fileInput = h(doc, "input", { type: "file", accept: ACCEPTED_TYPES.join(","), hidden: true });
  const chooseFile = h(doc, "button", { type: "button", class: "vc-sheet-choose", onclick: () => fileInput.click() }, "Choose file");
  const drop = h(doc, "div", { class: "vc-sheet-drop" },
    h(doc, "p", { class: "vc-sheet-drop-title" }, "Drop an image here"), h(doc, "p", { class: "vc-sheet-drop-or" }, "or"), chooseFile, fileInput,
    h(doc, "p", { class: "vc-sheet-drop-help" }, `JPEG, PNG, AVIF or WebP, up to ${limitText(media.maxBytes)}. The website gets an optimized copy.`),
    progress, uploadStatus);
  const say = (state: string, text: string) => { uploadStatus.dataset.state = state; uploadStatus.textContent = text; };
  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = !ACCEPTED_TYPES.includes(file.type) ? TYPE_PROBLEM : file.size > media.maxBytes ? `This file is larger than ${limitText(media.maxBytes)}. Choose a smaller image.` : null;
    if (problem) { say("error", problem); return; }
    chooseFile.disabled = true; drop.dataset.state = "uploading";
    setProgress(2); say("saving", `Uploading ${file.name}…`);
    try {
      let prepared: PreparedImage;
      try { prepared = await options.prepare(file); } catch (failure) { say("error", (failure as Error).message); return; }
      if (prepared.blob.size > media.maxBytes) { say("error", `This file is larger than ${limitText(media.maxBytes)}. Choose a smaller image.`); return; }
      const result = await options.upload(prepared, (fraction) => setProgress(Math.max(2, Math.round(fraction * 90))));
      if (!result.ok) { say("error", result.message || "The image could not be uploaded. Please try again."); return; }
      setProgress(100);
      say("success", result.reused ? "This image was already uploaded. It is selected in the Library." : "Uploaded. It is selected in the Library.");
      win?.setTimeout(() => { progress.hidden = true; }, 600);
      const entry: Entry = { ...result.image, source: "upload", places: placesOf(result.image.src), staged: !siteSet.has(result.image.src) };
      entries = [...entries.filter((other) => other.current), entry, ...entries.filter((other) => !other.current && other.src !== entry.src)];
      if (filter !== "all" && filter !== "staged") filter = "all";
      search.value = "";
      showTab("library");
      render();
      select(entry);
      useButton.focus();
    } finally { chooseFile.disabled = false; delete drop.dataset.state; }
  };
  fileInput.addEventListener("change", () => { void uploadFile(fileInput.files?.[0]); fileInput.value = ""; });
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.dataset.drag = "true"; });
  drop.addEventListener("dragleave", () => { delete drop.dataset.drag; });
  drop.addEventListener("drop", (event) => { event.preventDefault(); delete drop.dataset.drag; void uploadFile((event as DragEvent).dataTransfer?.files?.[0]); });
  const uploadPanel = h(doc, "div", { class: "vc-sheet-panel vc-sheet-upload", id: "vc-sheet-panel-upload", role: "tabpanel", "aria-labelledby": "vc-sheet-tab-upload", hidden: true },
    media.uploads ? drop : h(doc, "p", { class: "vc-sheet-empty" }, "Uploading is not set up on this site (its image storage is missing); you can use images that are already on the website."));

  const showTab = (name: "library" | "upload") => {
    for (const button of tabs.querySelectorAll<HTMLElement>(".vc-sheet-tab")) { const on = button.dataset.tab === name; button.setAttribute("aria-selected", String(on)); button.tabIndex = on ? 0 : -1; }
    libraryPanel.hidden = name !== "library"; uploadPanel.hidden = name !== "upload";
    // Mr Spa: the Upload tab has no search, count or chips.
    searchBox.hidden = name !== "library"; count.hidden = name !== "library"; chipRow.hidden = name !== "library";
    bar.classList.toggle("vc-sheet-bar-alone", name !== "library");
  };
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (doc.activeElement as HTMLElement | null)?.dataset.tab === "library" ? "upload" : "library";
    showTab(next);
    tabs.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  });

  // ---- the sheet
  const sheet = h(doc, "div", { class: "vc-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, head, bar, chipRow, libraryPanel, uploadPanel, foot);
  const reduced = Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const overlay = h(doc, "div", { class: "vc-overlay vc-sheet-backdrop", "data-motion": reduced ? "none" : "full", "data-state": "opening" }, sheet);
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"]), [tabindex="0"]')].filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  // The page behind cannot be reached while the sheet is open.
  const inerted = [...doc.body.children].filter((element) => !element.hasAttribute("inert"));
  for (const element of inerted) element.setAttribute("inert", "");
  doc.body.append(overlay);
  doc.addEventListener("keydown", onKey, true);
  (win?.requestAnimationFrame ?? ((run: () => void) => run()))(() => { overlay.dataset.state = "open"; });
  search.focus();
  render();

  // ---- load: Current first, then uploads not on the website yet, then the website's images (used first, in content order)
  let siteSet = new Set<string>();
  let usage: ImageUsage = {};
  const placesOf = (src: string) => usage[src] ?? [];
  void (async () => {
    const result = await api.get<{ uploads: LibraryImage[]; site: LibraryImage[]; usage?: ImageUsage; notes?: Record<string, { displayName?: string; archivedAt?: string }> }>("/api/cms/media");
    loaded = true;
    if (!result.ok) { failed = true; error.hidden = false; error.textContent = "The image library could not be loaded."; render(); return; }
    usage = result.data.usage ?? {};
    siteSet = new Set(result.data.site.map((image) => image.src));
    const uploads = result.data.uploads.map((image): Entry => ({ ...image, source: "upload", places: placesOf(image.src), staged: !siteSet.has(image.src) }));
    const uploadSet = new Set(uploads.map((image) => image.src));
    const order = new Map(Object.keys(usage).map((src, index) => [src, index]));
    const site = result.data.site.filter((image) => !uploadSet.has(image.src)).map((image): Entry => ({ ...image, source: "site", places: placesOf(image.src), staged: false }))
      .sort((a, b) => (order.get(a.src) ?? Infinity) - (order.get(b.src) ?? Infinity) || (order.has(a.src) ? 0 : a.src.localeCompare(b.src)));
    // M11 (Mr Spa): an archived image cannot be chosen; a display name is the name people see.
    const notes = result.data.notes ?? {};
    const named = (image: Entry): Entry => (notes[image.src]?.displayName ? { ...image, name: notes[image.src].displayName } : image);
    const library = [...uploads.filter((image) => image.staged), ...uploads.filter((image) => !image.staged), ...site].filter((image) => !notes[image.src]?.archivedAt).map(named);
    options.onLoad?.(library);
    const known = options.current ? library.find((image) => image.src === options.current) : undefined;
    const current: Entry[] = options.current ? [{ ...(known ?? { src: options.current, bytes: 0, source: "site" as const, places: placesOf(options.current), staged: false }), current: true }] : [];
    const chosen = options.select ? { ...options.select, source: "upload" as const, places: placesOf(options.select.src), staged: !siteSet.has(options.select.src) } : undefined;
    entries = [...current, ...(chosen ? [chosen] : []), ...library.filter((image) => image.src !== options.current && image.src !== chosen?.src)];
    render();
    if (chosen) select(entries.find((entry) => entry.src === chosen.src));
  })();
  return close;
};
