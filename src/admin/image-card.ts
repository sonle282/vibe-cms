/**
 * M5: the image card of the Mr Spa CMS (its image-field.ts, layout "outline") — the picture as it is (contain, on
 * #F5F5F7), Desktop | Mobile when the image has a phone version, on hover Replace · Adjust · "or drop an image here",
 * a file dropped on it is uploaded ("Uploading… 42%"), the meta line "name · W × H · KB  Replace", and ⋯ = Set as
 * main · Copy image link · Remove image (no Remove for a required image or an item of a list). An empty slot is the
 * dashed "Choose image" button.
 *
 * The card reads and writes through `get` / `set`; it never touches the content itself. After a pick or a drop:
 * "Image replaced" / "Image added" with Undo.
 */
import { clear, h, icon } from "./dom.js";
import { cardBytes, imageDetails, imageFileProblem, imageName, middleTruncate, type LibraryImage } from "./media.js";

export type ImageSlot = "desktop" | "mobile";
export type PickRequest = { current: string; label: string; select?: LibraryImage };
export type ImageCardOptions = {
  doc: Document;
  /** The image area's name ("Hero image"); with a phone version "Hero image (desktop)" / "(mobile)". */
  label: string;
  /** Remembers which version is shown (Desktop / Mobile) while the editor is open. */
  key: string;
  mobile: boolean;
  /** No Remove (the Mr Spa CMS: a required image, an item of a list). */
  removable: boolean;
  disabled: boolean;
  get: (slot: ImageSlot) => string;
  set: (slot: ImageSlot, src: string) => void;
  /** Open the image sheet for this area; `done` gets the chosen image. */
  pick?: (request: PickRequest, done: (image: LibraryImage) => void) => void;
  /** Upload a file dropped on the card. */
  upload?: (file: File, onProgress: (fraction: number) => void) => Promise<{ ok: true; image: LibraryImage } | { ok: false; message: string }>;
  maxBytes?: number;
  /** Adjust this image (a new copy); `created` gets the copy, which is then offered in the sheet. */
  adjust?: (src: string, created: (image: LibraryImage) => void) => void;
  canAdjust?: (src: string) => boolean;
  /** What the library knows about an image (its file size). */
  info?: (src: string) => { bytes?: number; width?: number; height?: number; name?: string } | undefined;
  /** "Set as main" (an image of a list that is not the first). */
  setMain?: () => void;
  notify?: (text: string, action?: { label: string; run: () => void }) => void;
  /** M16: the version shown changed (the Mr Spa CMS swaps the help under the card). */
  onSlot?: (slot: ImageSlot) => void;
};
export type ImageCard = { element: HTMLElement; refresh(): void };

const shownSlot = new Map<string, ImageSlot>();
const NO_MOBILE = "No mobile image — the desktop image is used";
const PICTURE = ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M9 8.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z", "M4 17l5-5 4 4 3-3 4 4"];

export const createImageCard = (options: ImageCardOptions): ImageCard => {
  const { doc } = options;
  const win = doc.defaultView;
  const root = h(doc, "div", { class: `vc-image-card${options.mobile ? " has-devices" : ""}` });
  let slot: ImageSlot = (options.mobile && shownSlot.get(options.key)) || "desktop";
  let uploading: number | undefined;
  let dropError = "";
  let statusTimer: number | undefined;
  let fileDepth = 0;
  const nameOf = () => (options.mobile ? `${options.label} (${slot})` : options.label);
  const canPick = () => Boolean(options.pick) && !options.disabled;
  const canDrop = () => Boolean(options.upload) && !options.disabled;
  const status = h(doc, "span", { class: "vc-image-status", role: "status" });

  /** Put a chosen image in the shown slot, with the toast and its Undo. */
  const apply = (image: LibraryImage, note?: string) => {
    const which = slot;
    const before = options.get(which);
    options.set(which, image.src);
    render("replace");
    options.notify?.(`${before ? "Image replaced" : "Image added"}${note ? `. ${note}` : ""}`, { label: "Undo", run: () => { options.set(which, before); render(); } });
  };
  const choose = (select?: LibraryImage) => {
    if (!canPick()) return;
    options.pick!({ current: options.get(slot), label: nameOf(), ...(select ? { select } : {}) }, (image) => apply(image));
  };
  const remove = () => {
    options.set(slot, "");
    render("empty");
  };
  const copy = async () => {
    const src = options.get(slot);
    let ok = false;
    try { await win?.navigator.clipboard.writeText(new URL(src, win.location.href).href); ok = true; } catch { ok = false; }
    status.textContent = ok ? "Image link copied." : "The image link could not be copied.";
    if (statusTimer) win?.clearTimeout(statusTimer);
    statusTimer = win?.setTimeout(() => { status.textContent = ""; }, 2500);
  };
  const dropFile = async (files: File[]) => {
    const file = files[0];
    if (!file || !options.upload) return;
    const problem = imageFileProblem(file, options.maxBytes ?? 10 * 1024 * 1024);
    if (problem) { dropError = problem; render(); return; }
    dropError = ""; uploading = 0; render();
    const result = await options.upload(file, (fraction) => { uploading = Math.round(fraction * 90); showProgress(); });
    uploading = undefined;
    if (!result.ok) { dropError = result.message || "The image could not be uploaded. Please try again."; render(); return; }
    apply(result.image, files.length > 1 ? "Only one image can go here, so the first file was used." : undefined);
  };

  // ---- the ⋯ menu
  let menu: HTMLElement | undefined;
  let more: HTMLButtonElement | undefined;
  const closeMenu = (focusMore = false) => {
    if (!menu || menu.hidden) return;
    menu.hidden = true; more?.setAttribute("aria-expanded", "false"); root.classList.remove("is-menu-open");
    if (focusMore) more?.focus();
  };
  const openMenu = (last = false) => {
    if (!menu || !more) return;
    menu.hidden = false; more.setAttribute("aria-expanded", "true"); root.classList.add("is-menu-open");
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    (last ? items[items.length - 1] : items[0])?.focus();
  };
  doc.addEventListener("pointerdown", (event) => { if (menu && !menu.hidden && !menu.contains(event.target as Node) && event.target !== more && !more?.contains(event.target as Node)) closeMenu(); });

  let progressCard: HTMLElement | undefined;
  const showProgress = () => {
    if (!progressCard || uploading === undefined) return;
    progressCard.querySelector(".vc-image-progress-text")!.textContent = `Uploading… ${uploading}%`;
    (progressCard.querySelector(".vc-image-progress-bar") as HTMLElement).style.width = `${uploading}%`;
    progressCard.setAttribute("aria-valuenow", String(uploading));
  };

  const render = (focus?: "replace" | "empty" | "more") => {
    clear(root);
    const src = options.get(slot);
    const name = nameOf();
    const busy = uploading !== undefined;
    root.classList.toggle("is-empty", !src);
    root.classList.toggle("is-uploading", busy);
    if (options.mobile) {
      const devices = h(doc, "div", { class: "vc-image-devices", role: "radiogroup", "aria-label": `${options.label}: version` },
        ...(["desktop", "mobile"] as const).map((which) => h(doc, "button", { type: "button", class: "vc-image-device", role: "radio", "aria-checked": String(which === slot), tabindex: which === slot ? "0" : "-1", "data-device": which, onclick: () => { slot = which; shownSlot.set(options.key, which); options.onSlot?.(which); render(); root.querySelector<HTMLElement>(`[data-device="${which}"]`)?.focus(); } }, which === "desktop" ? "Desktop" : "Mobile")));
      devices.addEventListener("keydown", (event) => {
        const to = event.key === "Home" ? "desktop" : event.key === "End" ? "mobile" : event.key.startsWith("Arrow") ? (slot === "desktop" ? "mobile" : "desktop") : undefined;
        if (!to) return;
        event.preventDefault(); slot = to; shownSlot.set(options.key, to); options.onSlot?.(to); render(); root.querySelector<HTMLElement>(`[data-device="${to}"]`)?.focus();
      });
      root.append(devices);
    }
    const frame = h(doc, "div", { class: "vc-image-frame" });
    if (canDrop()) frame.append(h(doc, "span", { class: "vc-image-drop-hint", "aria-hidden": "true" }, src ? "Drop to replace" : "Drop to add"));
    progressCard = busy ? h(doc, "span", { class: "vc-image-progress", role: "progressbar", "aria-label": `Uploading ${name}`, "aria-valuemin": "0", "aria-valuemax": "100" }, h(doc, "span", { class: "vc-image-progress-text" }), h(doc, "span", { class: "vc-image-progress-bar" })) : undefined;
    if (progressCard) frame.append(progressCard);
    if (src) {
      const known = options.info?.(src);
      const picture = h(doc, "img", { src, alt: "", loading: "lazy", draggable: "false" });
      const details = h(doc, "span", { class: "vc-image-details" }, imageDetails(known?.width, known?.height, known?.bytes ? cardBytes(known.bytes) : undefined));
      if (known?.width && known.height) frame.style.aspectRatio = `${known.width} / ${known.height}`;
      picture.addEventListener("load", () => {
        if (!picture.naturalWidth) return;
        if (!known?.width) frame.style.aspectRatio = `${picture.naturalWidth} / ${picture.naturalHeight}`;
        if (!known?.width) details.textContent = imageDetails(picture.naturalWidth, picture.naturalHeight, known?.bytes ? cardBytes(known.bytes) : undefined);
        details.hidden = !details.textContent;
      });
      details.hidden = !details.textContent;
      const off = !canPick() || busy;
      frame.append(
        h(doc, "button", { type: "button", class: "vc-image-thumb", "aria-label": `Replace ${name}`, disabled: off, onclick: () => choose() }, picture),
        off ? h(doc, "span", { hidden: true }) : h(doc, "div", { class: "vc-image-overlay" },
          h(doc, "button", { type: "button", class: "vc-image-overlay-button", tabindex: "-1", "aria-hidden": "true", onclick: () => choose() }, "Replace"),
          options.adjust && !options.disabled && (options.canAdjust?.(src) ?? true) ? h(doc, "button", { type: "button", class: "vc-image-overlay-button", "aria-label": `Adjust ${name}`, "data-image-action": "adjust", onclick: () => options.adjust!(src, (created) => choose(created)) }, "Adjust") : null,
          canDrop() ? h(doc, "span", { class: "vc-image-overlay-hint" }, "or drop an image here") : null));
      // ⋯ — Set as main (Desktop only) · Copy image link · Remove image.
      const items: Array<[string, () => void, boolean?]> = [
        ...(options.setMain && slot === "desktop" && !options.disabled ? [["Set as main", () => options.setMain!()] as [string, () => void]] : []),
        ["Copy image link", () => { void copy().then(() => more?.focus()); }],
        ...(options.removable && !options.disabled ? [["Remove image", remove, true] as [string, () => void, boolean]] : []),
      ];
      more = h(doc, "button", { type: "button", class: "vc-image-more", "aria-label": `More actions for ${name}`, "data-tooltip": "More actions", "aria-haspopup": "menu", "aria-expanded": "false", onclick: (event: Event) => { event.stopPropagation(); if (menu?.hidden) openMenu(); else closeMenu(); } }, h(doc, "span", { "aria-hidden": "true" }, "⋯"));
      more.addEventListener("keydown", (event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(event.key === "ArrowUp"); } });
      frame.append(more);
      menu = h(doc, "div", { class: "vc-image-menu", role: "menu", "aria-label": `Actions for ${name}`, hidden: true },
        ...items.map(([text, run, danger]) => h(doc, "button", { type: "button", class: `vc-image-menu-item${danger ? " is-danger" : ""}`, role: "menuitem", tabindex: "-1", onclick: () => { closeMenu(); run(); } }, text)));
      menu.addEventListener("keydown", (event) => {
        const list = [...menu!.querySelectorAll<HTMLElement>("[role=menuitem]")];
        const index = list.indexOf(doc.activeElement as HTMLElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
        if (event.key === "Tab") { closeMenu(); return; }
        const next = event.key === "ArrowDown" ? (index + 1) % list.length : event.key === "ArrowUp" ? (index - 1 + list.length) % list.length : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); list[next]?.focus();
      });
      const file = imageName(src, known?.name);
      root.append(frame,
        h(doc, "div", { class: "vc-image-meta" },
          h(doc, "span", { class: "vc-image-name", title: file }, middleTruncate(file, 22)), details,
          canPick() ? h(doc, "button", { type: "button", class: "vc-image-replace", "aria-label": `Replace ${name}`, disabled: busy, onclick: () => choose() }, "Replace") : null),
        menu);
    } else {
      const noteId = `vc-image-note-${Math.random().toString(36).slice(2, 8)}`;
      frame.append(h(doc, "button", { type: "button", class: "vc-image-empty", "aria-label": `Choose ${name}`, disabled: !canPick() || busy, ...(slot === "mobile" ? { "aria-describedby": noteId } : {}), onclick: () => choose() },
        h(doc, "span", { class: "vc-image-icon", "aria-hidden": "true" }, iconOf()),
        h(doc, "span", { class: "vc-image-empty-text" }, "Choose image"),
        slot === "mobile" ? h(doc, "span", { class: "vc-image-empty-note", id: noteId }, NO_MOBILE) : null));
      root.append(frame);
      menu = undefined; more = undefined;
    }
    if (dropError) root.append(h(doc, "p", { class: "vc-image-drop-error", role: "alert" }, dropError));
    root.append(status);
    showProgress();
    if (focus === "replace") (root.querySelector<HTMLElement>(".vc-image-replace:not([disabled])") ?? root.querySelector<HTMLElement>(".vc-image-thumb:not([disabled])") ?? root.querySelector<HTMLElement>(".vc-image-empty"))?.focus({ preventScroll: true });
    if (focus === "empty") root.querySelector<HTMLElement>(".vc-image-empty")?.focus({ preventScroll: true });
  };
  const iconOf = () => { const svg = icon(doc, "image"); svg.replaceChildren(...PICTURE.map((d) => { const path = doc.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); return path; })); return svg; };

  // A file dragged over the card: "Drop to replace" / "Drop to add"; dropped = uploaded and used.
  const isFileDrag = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  root.addEventListener("dragenter", (event) => { if (!canDrop() || !isFileDrag(event as DragEvent)) return; event.preventDefault(); fileDepth += 1; root.classList.add("is-file-over"); });
  root.addEventListener("dragover", (event) => { if (!canDrop() || !isFileDrag(event as DragEvent)) return; event.preventDefault(); const transfer = (event as DragEvent).dataTransfer; if (transfer) transfer.dropEffect = uploading === undefined ? "copy" : "none"; });
  root.addEventListener("dragleave", () => { fileDepth = Math.max(0, fileDepth - 1); if (!fileDepth) root.classList.remove("is-file-over"); });
  root.addEventListener("drop", (event) => {
    if (!canDrop() || !isFileDrag(event as DragEvent)) return;
    event.preventDefault(); fileDepth = 0; root.classList.remove("is-file-over");
    if (uploading !== undefined) return;
    void dropFile([...((event as DragEvent).dataTransfer?.files ?? [])]);
  });

  render();
  return { element: root, refresh: () => render() };
};
