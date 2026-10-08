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
        image.source === "upload" ? h(doc, "span", { class: "vc-tile-badge" }, "Uploaded") : null)));
    }
    if (!shown.length) grid.append(h(doc, "p", { class: "vc-note" }, images.length ? "No image matches." : "No images yet."));
  };
  search.addEventListener("input", render);

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
    h(doc, "div", { class: "vc-toolbar" }, search),
    grid);
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
