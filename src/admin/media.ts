/**
 * P10: choosing an image — a sheet with an upload area (drop or choose a file) and the image library (uploads, newest
 * first, then the site's own images), with search. Before uploading, the browser prepares the file: the longest edge
 * at most 2400 px and WebP (JPEG / PNG when the browser cannot write WebP); re-encoding also drops hidden data such as
 * the camera's GPS position. The server checks the real type from the bytes anyway (src/media).
 */
import type { Client } from "./api.js";
import type { BootMedia } from "./boot.js";
import { clear, h, icon } from "./dom.js";

export type LibraryImage = { src: string; width?: number; height?: number; bytes: number; uploadedAt?: string; name?: string; source: "upload" | "site" };
export type PreparedImage = { blob: Blob; name: string; width?: number; height?: number };
export type Prepare = (file: File) => Promise<PreparedImage>;

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const MAX_EDGE = 2400;

/** Resize (longest edge ≤ 2400 px) and re-encode in the browser; falls back to the file itself where canvas is missing. */
export const prepareImage = (win: Window): Prepare => async (file) => {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Choose a JPEG, PNG, WebP or AVIF image (SVG and GIF are not accepted).");
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

// ---------------------------------------------------------------- P12f: crop / resize = a new copy

/** Presets first (the first site's choice): no coordinates to type. Ratio = width / height; null = the image's own. */
export const CROP_PRESETS: Array<{ key: string; label: string; ratio: number | null }> = [
  { key: "original", label: "Original", ratio: null },
  { key: "square", label: "Square", ratio: 1 },
  { key: "landscape", label: "Landscape", ratio: 4 / 3 },
  { key: "wide", label: "Wide", ratio: 16 / 9 },
  { key: "portrait", label: "Portrait", ratio: 4 / 5 },
];
/** Widths offered for the copy (never larger than the crop itself). */
export const RESIZE_WIDTHS = [2400, 1600, 1200, 800, 400];
export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * The crop in the image's own pixels: the largest `ratio` box that fits, made `zoom` (0.2–1) times smaller, centred on
 * (cx, cy) — fractions of the image — and kept inside it.
 */
export const cropRect = (image: { width: number; height: number }, ratio: number | null, zoom = 1, cx = 0.5, cy = 0.5): CropRect => {
  const r = ratio ?? image.width / image.height;
  let width = image.width; let height = width / r;
  if (height > image.height) { height = image.height; width = height * r; }
  const z = Math.min(1, Math.max(0.2, zoom));
  width = Math.max(1, Math.round(width * z)); height = Math.max(1, Math.round(height * z));
  const x = Math.round(Math.min(image.width - width, Math.max(0, cx * image.width - width / 2)));
  const y = Math.round(Math.min(image.height - height, Math.max(0, cy * image.height - height / 2)));
  return { x, y, width, height };
};
/** The copy's size: the crop, at most `maxWidth` wide and MAX_EDGE on its longest side, ratio kept. */
export const outputSize = (rect: CropRect, maxWidth?: number) => {
  const scale = Math.min(1, (maxWidth ?? rect.width) / rect.width, MAX_EDGE / Math.max(rect.width, rect.height));
  return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
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

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export type PickerOptions = {
  doc: Document;
  api: Client;
  media: BootMedia;
  prepare: Prepare;
  /** Upload with the browser's fetch (raw bytes). */
  upload: (prepared: PreparedImage) => Promise<{ ok: true; image: LibraryImage } | { ok: false; message: string }>;
  current?: string;
  onPick: (image: LibraryImage) => void;
  /** P12f: crop / resize an image into a new copy (needs uploads). Without them there is no "Crop / resize". */
  adjust?: Adjust;
  measure?: Measure;
};

/** Open the sheet; returns a function that closes it. */
export const openImagePicker = (options: PickerOptions) => {
  const { doc, api, media } = options;
  const opener = doc.activeElement as HTMLElement | null;
  const status = h(doc, "p", { class: "vc-picker-status", role: "status", "aria-live": "polite" });
  const grid = h(doc, "div", { class: "vc-picker-grid", role: "list" });
  const search = h(doc, "input", { type: "search", class: "vc-input vc-search", placeholder: "Search images", "aria-label": "Search images" });
  let images: LibraryImage[] = [];

  const close = () => { doc.removeEventListener("keydown", onKey, true); overlay.remove(); opener?.focus?.(); };
  const pick = (image: LibraryImage) => { close(); options.onPick(image); };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };

  const render = () => {
    clear(grid);
    const query = search.value.trim().toLowerCase();
    const shown = images.filter((image) => !query || image.src.toLowerCase().includes(query) || (image.name ?? "").toLowerCase().includes(query));
    for (const image of shown) {
      const label = image.name || image.src.split("/").pop() || image.src;
      grid.append(h(doc, "div", { role: "listitem" }, h(doc, "button", { type: "button", class: `vc-tile${image.src === options.current ? " vc-tile-current" : ""}`, "data-src": image.src, "aria-label": `Use ${label}`, onclick: () => pick(image) },
        h(doc, "img", { src: image.src, alt: "", loading: "lazy", decoding: "async" }),
        h(doc, "span", { class: "vc-tile-name" }, label),
        h(doc, "span", { class: "vc-tile-meta" }, [image.width && image.height ? `${image.width}×${image.height}` : "", sizeText(image.bytes)].filter(Boolean).join(" · ")),
        image.source === "upload" ? h(doc, "span", { class: "vc-tile-badge" }, "Uploaded") : null),
        canAdjust ? h(doc, "button", { type: "button", class: "vc-button vc-quiet vc-tile-adjust", "aria-label": `Crop or resize ${label}`, onclick: () => openAdjust(image, label) }, "Crop / resize") : null));
    }
    if (!shown.length) grid.append(h(doc, "p", { class: "vc-note" }, images.length ? "No image matches." : "No images yet."));
  };
  search.addEventListener("input", render);

  // ---- P12f: crop / resize → a new copy (the original is never changed; nothing is chosen until the copy is uploaded)
  const canAdjust = Boolean(media.uploads && options.adjust && options.measure);
  const library = h(doc, "div", { class: "vc-picker-library" });
  const adjustBox = h(doc, "div", { class: "vc-adjust", hidden: true });
  const openAdjust = async (image: LibraryImage, label: string) => {
    let natural = image.width && image.height ? { width: image.width, height: image.height } : undefined;
    if (!natural) {
      status.textContent = "Loading the image…";
      try { natural = await options.measure!(image.src); } catch (error) { status.textContent = (error as Error).message; return; }
      status.textContent = "";
    }
    const size = natural;
    let preset = CROP_PRESETS[0]; let zoom = 1; let cx = 0.5; let cy = 0.5; let maxWidth: number | undefined;
    const frame = h(doc, "div", { class: "vc-adjust-frame", tabindex: "0", role: "group", "aria-label": "Crop area — drag it, or use the arrow keys" });
    const picture = h(doc, "div", { class: "vc-adjust-picture" }, h(doc, "img", { src: image.src, alt: "", draggable: "false" }), frame);
    const info = h(doc, "p", { class: "vc-note", "aria-live": "polite" });
    const presets = h(doc, "div", { class: "vc-adjust-presets", role: "group", "aria-label": "Shape" });
    const zoomInput = h(doc, "input", { type: "range", min: "20", max: "100", value: "100", class: "vc-adjust-zoom", "aria-label": "Crop size" });
    const widthSelect = h(doc, "select", { class: "vc-input vc-adjust-width", "aria-label": "Width of the new image" });
    const save = h(doc, "button", { type: "button", class: "vc-button vc-primary" }, "Save as a new image");
    const back = h(doc, "button", { type: "button", class: "vc-button" }, "Back to the images");
    const rect = () => cropRect(size, preset.ratio, zoom, cx, cy);
    const draw = () => {
      const r = rect();
      Object.assign(frame.style, { left: `${(r.x / size.width) * 100}%`, top: `${(r.y / size.height) * 100}%`, width: `${(r.width / size.width) * 100}%`, height: `${(r.height / size.height) * 100}%` });
      const chosen = maxWidth;
      clear(widthSelect);
      widthSelect.append(h(doc, "option", { value: "" }, `Full size (${outputSize(r).width} px wide)`));
      for (const width of RESIZE_WIDTHS) if (width < outputSize(r).width) widthSelect.append(h(doc, "option", { value: String(width) }, `${width} px wide`));
      widthSelect.value = chosen && chosen < outputSize(r).width ? String(chosen) : "";
      maxWidth = widthSelect.value ? Number(widthSelect.value) : undefined;
      const out = outputSize(r, maxWidth);
      info.textContent = `Makes a new image of ${out.width} × ${out.height} px. The original stays as it is.`;
      for (const button of presets.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset.preset === preset.key));
    };
    for (const entry of CROP_PRESETS) presets.append(h(doc, "button", { type: "button", class: "vc-button vc-quiet", "data-preset": entry.key, "aria-pressed": "false", onclick: () => { preset = entry; draw(); } }, entry.label));
    zoomInput.addEventListener("input", () => { zoom = Number(zoomInput.value) / 100; draw(); });
    widthSelect.addEventListener("change", () => { maxWidth = widthSelect.value ? Number(widthSelect.value) : undefined; draw(); });
    // Move the crop: drag it (pointer) or the arrow keys (2 % a press, 10 % with Shift).
    const moveTo = (x: number, y: number) => { const r = rect(); cx = Math.min(1 - r.width / size.width / 2, Math.max(r.width / size.width / 2, x)); cy = Math.min(1 - r.height / size.height / 2, Math.max(r.height / size.height / 2, y)); draw(); };
    frame.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (move) { event.preventDefault(); moveTo(cx + move[0], cy + move[1]); }
    });
    frame.addEventListener("pointerdown", (event) => {
      const box = picture.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const start = { x: event.clientX, y: event.clientY, cx, cy };
      const onMove = (move: PointerEvent) => moveTo(start.cx + (move.clientX - start.x) / box.width, start.cy + (move.clientY - start.y) / box.height);
      const onUp = () => { doc.removeEventListener("pointermove", onMove); doc.removeEventListener("pointerup", onUp); };
      doc.addEventListener("pointermove", onMove); doc.addEventListener("pointerup", onUp);
      event.preventDefault();
    });
    back.addEventListener("click", () => { adjustBox.hidden = true; library.hidden = false; clear(adjustBox); status.textContent = ""; search.focus(); });
    save.addEventListener("click", async () => {
      const r = rect(); const out = outputSize(r, maxWidth);
      const base = (image.name || image.src.split("/").pop() || "image").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/-[0-9a-f]{8}$/, "");
      save.disabled = true; status.textContent = "Making the new image…";
      try {
        const made = await options.adjust!(image.src, r, out, `${base}-${out.width}x${out.height}`);
        if (made.blob.size > media.maxBytes) throw new Error("too large");
        status.textContent = "Uploading the new image…";
        const result = await options.upload(made);
        if (!result.ok) throw new Error(result.message);
        status.textContent = "Saved as a new image.";
        pick(result.image);
      } catch {
        status.textContent = "Adjustment failed. Your original image is unchanged — try again.";
        save.disabled = false;
      }
    });
    clear(adjustBox);
    adjustBox.append(h(doc, "h3", { class: "vc-section-title" }, `Crop or resize · ${label}`), presets, picture, h(doc, "div", { class: "vc-adjust-controls" }, h(doc, "label", { class: "vc-note" }, "Crop size ", zoomInput), widthSelect), info, h(doc, "div", { class: "vc-adjust-actions" }, back, save));
    library.hidden = true; adjustBox.hidden = false;
    draw();
    frame.focus();
  };

  // ---- upload
  const fileInput = h(doc, "input", { type: "file", accept: ACCEPTED_TYPES.join(","), class: "vc-sr-only", id: "vc-picker-file" });
  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    status.textContent = "Preparing the image…";
    let prepared: PreparedImage;
    try { prepared = await options.prepare(file); } catch (error) { status.textContent = (error as Error).message; return; }
    if (prepared.blob.size > media.maxBytes) { status.textContent = `This image is still larger than ${sizeText(media.maxBytes)} after preparing it. Choose a smaller one.`; return; }
    status.textContent = "Uploading…";
    const result = await options.upload(prepared);
    if (!result.ok) { status.textContent = result.message; return; }
    status.textContent = "Uploaded.";
    pick(result.image);
  };
  fileInput.addEventListener("change", () => { void uploadFile(fileInput.files?.[0]); });
  const drop = h(doc, "label", { class: "vc-drop", for: "vc-picker-file" }, icon(doc, "plus"), h(doc, "span", {}, "Drop an image here, or ", h(doc, "u", {}, "choose a file")), h(doc, "span", { class: "vc-note" }, `JPEG, PNG, WebP or AVIF. Large photos are made smaller (${MAX_EDGE} px) before uploading.`));
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("vc-drop-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("vc-drop-over"));
  drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("vc-drop-over"); void uploadFile((event as DragEvent).dataTransfer?.files?.[0]); });

  const titleId = "vc-picker-title";
  const sheet = h(doc, "div", { class: "vc-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h(doc, "div", { class: "vc-sheet-head" }, h(doc, "h2", { id: titleId }, "Choose an image"), h(doc, "button", { type: "button", class: "vc-icon-button", "aria-label": "Close", onclick: close }, icon(doc, "remove"))),
    media.uploads ? h(doc, "div", { class: "vc-sheet-upload" }, fileInput, drop) : h(doc, "p", { class: "vc-note" }, "Uploading is not set up on this site (its image storage is missing); you can use images that are already on the website."),
    status,
    library,
    adjustBox);
  library.append(h(doc, "div", { class: "vc-toolbar" }, search), grid);
  const overlay = h(doc, "div", { class: "vc-overlay", onclick: (event: Event) => { if (event.target === overlay) close(); } }, sheet);
  doc.body.append(overlay);
  doc.addEventListener("keydown", onKey, true);
  search.focus();

  status.textContent = "Loading images…";
  void (async () => {
    const result = await api.get<{ uploads: LibraryImage[]; site: LibraryImage[] }>("/api/cms/media");
    if (!result.ok) { status.textContent = result.message; return; }
    const uploaded = new Set(result.data.uploads.map((image) => image.src));
    images = [...result.data.uploads.map((image) => ({ ...image, source: "upload" as const })), ...result.data.site.filter((image) => !uploaded.has(image.src)).map((image) => ({ ...image, source: "site" as const }))];
    status.textContent = "";
    render();
  })();
  return close;
};
