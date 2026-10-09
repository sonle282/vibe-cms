/**
 * P8d: the visual editor for rich text and Markdown bodies — what the CMS the package grew out of had (a toolbar over
 * an editable area, paste keeps only the text), plus images: insert one from the image sheet (P10), click it to set
 * its alt text, replace or remove it, and resize it by dragging its corner (or typing a width) — the ratio is always
 * kept: only `width` is written, the height follows.
 *
 * Values: rich text stays HTML; a Markdown body stays Markdown (src/admin/markdown.ts, loaded only when needed). An
 * untouched field is never re-written: the value changes only after an edit. A Markdown post that the editor could not
 * show without changing it opens as Markdown, with a note. "Edit HTML" / "Edit Markdown" shows the source either way.
 *
 * The editor uses the browser's editing commands (execCommand) so Ctrl+Z / Ctrl+Y keep working; what they write is
 * cleaned (src/admin/clean.ts) before it becomes the value, and the server cleans again (P8c).
 */
import { cleanRichDom, isEmptyRich, normalizeBlocks } from "./clean.js";
import { h } from "./dom.js";

type MarkdownModule = typeof import("./markdown.js");
export type PickedImage = { src: string; width?: number; height?: number };

export type RichEditorOptions = {
  doc: Document;
  id: string;
  /** The field's name, for the toolbar's and the source box's labels. */
  label: string;
  value: string;
  format: "html" | "markdown";
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The image sheet (P10); without it there is no Image button. */
  pickImage?: (current: string, done: (image: PickedImage) => void) => void;
  /** Tests: how the Markdown converter is loaded (dynamic import by default). */
  loadMarkdown?: () => Promise<MarkdownModule>;
};

export type RichEditor = {
  element: HTMLElement;
  /** The editable area (visual mode). */
  area: HTMLElement;
  /** The source box (HTML / Markdown). */
  source: HTMLTextAreaElement;
  /** Resolves once the editor shows the value (Markdown: after the converter loaded). */
  ready: Promise<void>;
  mode: () => "loading" | "visual" | "source";
  /** Show a value set from outside (e.g. what the server stored); does not call onChange. */
  setValue: (value: string) => void;
  /** The image currently selected in the editor, if any. */
  selectedImage: () => HTMLImageElement | undefined;
};

const MIN_WIDTH = 40;
const MAX_WIDTH = 4000;
const LINK = /^(https?:\/\/|mailto:|tel:|\/|#|\?)/i;

export const createRichEditor = (options: RichEditorOptions): RichEditor => {
  const { doc, id, label, format } = options;
  const markdown = format === "markdown";
  const disabled = Boolean(options.disabled);
  let md: MarkdownModule | undefined;
  let style: ReturnType<MarkdownModule["markdownStyle"]> | undefined;
  let current = options.value;
  /** HTML made of blocks (or new) stays in paragraphs; a plain inline value ("Some text") stays inline. */
  const blocky = (value: string) => value.trim() === "" || /<(p|h[1-6]|ul|ol|blockquote|div|figure|pre|table)\b/i.test(value);
  let paragraphs = blocky(options.value);
  let mode: "loading" | "visual" | "source" = markdown ? "loading" : "visual";
  let savedRange: Range | undefined;
  let selected: HTMLImageElement | undefined;

  const area = h(doc, "div", { id, class: "vc-rich-area", role: "textbox", "aria-multiline": "true", contenteditable: disabled ? "false" : "true", spellcheck: "true", "data-vc-primary": "" });
  const sourceName = markdown ? "Markdown" : "HTML";
  const source = h(doc, "textarea", { id: `${id}-source`, class: "vc-input vc-rich-source", rows: 12, spellcheck: "false", disabled, hidden: true, "aria-label": `${label} (${sourceName})`, "data-vc-primary": "" });
  const status = h(doc, "p", { class: "vc-rich-status", role: "status", "aria-live": "polite" });
  const win = doc.defaultView;

  // ---------------------------------------------------------------- value

  /** A detached element in an inert document: nothing in it loads or runs. */
  const inert = (html: string) => {
    const box = doc.implementation.createHTMLDocument("").createElement("div");
    box.innerHTML = html;
    return cleanRichDom(box, { markdown });
  };
  const toHtml = (value: string) => (markdown && md ? md.markdownToHtml(value) : value);

  const serialize = () => {
    const copy = area.cloneNode(true) as HTMLElement;
    normalizeBlocks(cleanRichDom(copy, { markdown }), { wrapLoose: markdown || paragraphs });
    if (isEmptyRich(copy)) return "";
    if (markdown) return md && style ? md.htmlToMarkdown(copy, style) : current;
    return copy.innerHTML;
  };

  const emit = (value: string) => {
    if (value === current) return;
    current = value;
    options.onChange(value);
  };
  const changed = () => { if (mode === "visual") emit(serialize()); };

  const render = (value: string) => {
    deselect();
    const box = inert(toHtml(value));
    area.replaceChildren(...[...box.childNodes].map((node) => doc.importNode(node, true)));
  };

  // ---------------------------------------------------------------- selection + commands

  const inArea = (node: Node | null | undefined) => Boolean(node && (node === area || area.contains(node)));
  const remember = () => {
    const selection = win?.getSelection?.();
    if (selection && selection.rangeCount && inArea(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    area.focus();
    const selection = win?.getSelection?.();
    if (!selection) return;
    let range = savedRange && inArea(savedRange.commonAncestorContainer) ? savedRange : undefined;
    if (!range) { range = doc.createRange(); range.selectNodeContents(area); range.collapse(false); }
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const exec = (command: string, value?: string) => {
    restore();
    let ok = false;
    try { ok = typeof doc.execCommand === "function" && doc.execCommand(command, false, value); } catch { ok = false; }
    remember();
    changed();
    refreshState();
    return ok;
  };
  /** Start typing in an empty editor inside a paragraph (not a bare text node). */
  const ensureParagraph = () => {
    if (area.childNodes.length) return;
    const p = doc.createElement("p");
    p.append(doc.createElement("br"));
    area.append(p);
    const range = doc.createRange();
    range.setStart(p, 0);
    range.collapse(true);
    const selection = win?.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  // ---------------------------------------------------------------- toolbar

  const tool = (name: string, text: string, title: string, run: () => void, extra: Record<string, string> = {}) => {
    const button = h(doc, "button", { type: "button", class: `vc-tool vc-tool-${name}`, "aria-label": title, title, disabled, "data-command": name, ...extra }, text);
    // Keep the selection in the editor while the button is pressed.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => { if (mode === "visual") run(); });
    return button;
  };
  const block = (tag: string) => () => exec("formatBlock", `<${tag}>`);
  const bold = tool("bold", "B", "Bold", () => exec("bold"), { "aria-pressed": "false" });
  const italic = tool("italic", "I", "Italic", () => exec("italic"), { "aria-pressed": "false" });
  const formatting = [
    tool("paragraph", "¶", "Paragraph", block("p")),
    tool("heading", "H2", "Heading", block("h2")),
    tool("subheading", "H3", "Subheading", block("h3")),
    bold, italic,
    tool("bullets", "• List", "Bulleted list", () => exec("insertUnorderedList")),
    tool("numbers", "1. List", "Numbered list", () => exec("insertOrderedList")),
    tool("quote", "“ ”", "Quote", () => exec("formatBlock", closest("blockquote") ? "<p>" : "<blockquote>")),
    tool("link", "Link", "Add a link", () => openLink()),
    tool("unlink", "Unlink", "Remove the link", () => exec("unlink")),
    ...(options.pickImage ? [tool("image", "Image", "Insert an image", () => insertImage())] : []),
  ];
  const toggle = h(doc, "button", { type: "button", class: "vc-tool vc-tool-source", "aria-pressed": "false", disabled, onclick: () => (mode === "source" ? toVisual() : toSource()) }, `Edit ${sourceName}`);
  const toolbar = h(doc, "div", { class: "vc-rich-toolbar", role: "toolbar", "aria-label": `${label}: formatting`, "aria-controls": id }, ...formatting, h(doc, "span", { class: "vc-tool-gap" }), toggle);

  const closest = (tag: string) => {
    const node = win?.getSelection?.()?.anchorNode;
    let element = (node && node.nodeType === 1 ? node : node?.parentNode) as Element | null | undefined;
    while (element && element !== area) { if (element.tagName?.toLowerCase() === tag) return element; element = element.parentElement; }
    return undefined;
  };
  const refreshState = () => {
    for (const [button, command] of [[bold, "bold"], [italic, "italic"]] as const) {
      let on = false;
      try { on = typeof doc.queryCommandState === "function" && doc.queryCommandState(command); } catch { on = false; }
      button.setAttribute("aria-pressed", String(on));
    }
  };

  // ---------------------------------------------------------------- links

  const linkInput = h(doc, "input", { type: "text", class: "vc-input", id: `${id}-link`, placeholder: "https://… or /page", autocomplete: "off" });
  const linkNote = h(doc, "span", { class: "vc-rich-bar-note" });
  const applyLink = () => {
    const href = linkInput.value.trim();
    if (!LINK.test(href)) { linkNote.textContent = "Use an address starting with https://, /, mailto: or tel:."; linkInput.focus(); return; }
    linkBar.hidden = true;
    restore();
    const selection = win?.getSelection?.();
    if (selection && selection.rangeCount && selection.getRangeAt(0).collapsed) {
      const a = doc.createElement("a");
      a.setAttribute("href", href);
      a.textContent = href;
      if (!exec("insertHTML", a.outerHTML)) { savedRange?.insertNode(a); changed(); }
    } else if (!exec("createLink", href)) changed();
  };
  const linkBar = h(doc, "div", { class: "vc-rich-bar", hidden: true, role: "group", "aria-label": "Link" },
    h(doc, "label", { for: `${id}-link`, class: "vc-sublabel" }, "Link address"), linkInput,
    h(doc, "button", { type: "button", class: "vc-button", onclick: applyLink }, "Apply"),
    h(doc, "button", { type: "button", class: "vc-button vc-quiet", onclick: () => { linkBar.hidden = true; restore(); } }, "Cancel"),
    linkNote);
  linkInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") { event.preventDefault(); linkBar.hidden = true; restore(); } });
  const openLink = () => {
    remember();
    const existing = closest("a");
    linkInput.value = existing?.getAttribute("href") ?? "";
    linkNote.textContent = "";
    linkBar.hidden = false;
    linkInput.focus();
  };

  // ---------------------------------------------------------------- images

  const frame = h(doc, "div", { class: "vc-rich-frame", hidden: true, "aria-hidden": "true" });
  const handle = h(doc, "button", { type: "button", class: "vc-rich-handle", hidden: true, "aria-label": "Resize image (arrow keys)", title: "Drag to resize — the ratio is kept" });
  const altInput = h(doc, "input", { type: "text", class: "vc-input", id: `${id}-alt`, placeholder: "Describe the image", autocomplete: "off" });
  const widthInput = h(doc, "input", { type: "number", class: "vc-input vc-rich-width", id: `${id}-width`, min: String(MIN_WIDTH), max: String(MAX_WIDTH), step: "1", inputmode: "numeric" });
  const imageBar = h(doc, "div", { class: "vc-rich-bar vc-rich-image-bar", hidden: true, role: "group", "aria-label": "Selected image" },
    h(doc, "label", { for: `${id}-alt`, class: "vc-sublabel" }, "Alt text"), altInput,
    h(doc, "label", { for: `${id}-width`, class: "vc-sublabel" }, "Width (px)"), widthInput,
    h(doc, "button", { type: "button", class: "vc-button vc-quiet", "data-image": "original", onclick: () => { if (selected) { selected.removeAttribute("width"); selected.removeAttribute("height"); afterResize(); } } }, "Original size"),
    ...(options.pickImage ? [h(doc, "button", { type: "button", class: "vc-button vc-quiet", "data-image": "replace", onclick: () => replaceImage() }, "Replace…")] : []),
    h(doc, "button", { type: "button", class: "vc-button vc-quiet vc-danger", "data-image": "remove", onclick: () => removeImage() }, "Remove image"));

  const place = () => {
    if (!selected || !selected.isConnected) { deselect(); return; }
    const box = element.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    const left = rect.left - box.left; const top = rect.top - box.top;
    Object.assign(frame.style, { left: `${left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    Object.assign(handle.style, { left: `${left + rect.width - 8}px`, top: `${top + rect.height - 8}px` });
  };
  const shownWidth = (image: HTMLImageElement) => Math.round(Number(image.getAttribute("width")) || image.getBoundingClientRect().width || image.naturalWidth || 0);
  const select = (image: HTMLImageElement) => {
    selected = image;
    altInput.value = image.getAttribute("alt") ?? "";
    widthInput.value = image.getAttribute("width") ?? "";
    widthInput.placeholder = String(shownWidth(image) || "");
    frame.hidden = false; handle.hidden = disabled; imageBar.hidden = disabled;
    place();
  };
  function deselect() { selected = undefined; frame.hidden = true; handle.hidden = true; imageBar.hidden = true; }
  const afterResize = () => { if (selected) widthInput.value = selected.getAttribute("width") ?? ""; place(); changed(); };
  const setWidth = (value: number) => {
    if (!selected || !Number.isFinite(value)) return;
    const limit = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, area.clientWidth || MAX_WIDTH));
    selected.setAttribute("width", String(Math.round(Math.max(MIN_WIDTH, Math.min(limit, value)))));
    // The ratio is kept by writing the width only; the height follows the picture.
    selected.removeAttribute("height");
  };
  altInput.addEventListener("input", () => { if (selected) { selected.setAttribute("alt", altInput.value); changed(); } });
  widthInput.addEventListener("change", () => {
    if (!selected) return;
    if (widthInput.value.trim() === "") { selected.removeAttribute("width"); selected.removeAttribute("height"); } else setWidth(Number(widthInput.value));
    afterResize();
  });

  let drag: { x: number; width: number; pointer: number } | undefined;
  handle.addEventListener("pointerdown", (event) => {
    if (!selected || disabled) return;
    event.preventDefault();
    drag = { x: event.clientX, width: selected.getBoundingClientRect().width || shownWidth(selected), pointer: event.pointerId };
    try { handle.setPointerCapture(event.pointerId); } catch { /* not supported */ }
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    setWidth(drag.width + (event.clientX - drag.x));
    widthInput.value = selected?.getAttribute("width") ?? "";
    place();
  });
  const endDrag = (event: PointerEvent) => { if (!drag || event.pointerId !== drag.pointer) return; drag = undefined; afterResize(); };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", (event) => {
    if (!selected || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = (event.shiftKey ? 50 : 10) * (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1);
    setWidth(shownWidth(selected) + step);
    afterResize();
  });

  const removeImage = () => {
    const image = selected;
    if (!image) return;
    deselect();
    const range = doc.createRange();
    range.selectNode(image);
    savedRange = range;
    exec("delete");
    if (image.isConnected) { image.remove(); changed(); }
    area.focus();
  };
  const insertImage = () => {
    remember();
    options.pickImage?.("", (picked) => {
      const image = doc.createElement("img");
      image.setAttribute("src", picked.src);
      image.setAttribute("alt", "");
      const before = new Set(area.querySelectorAll("img"));
      if (!exec("insertHTML", image.outerHTML)) {
        restore();
        const range = win?.getSelection?.()?.rangeCount ? win.getSelection()!.getRangeAt(0) : undefined;
        if (range) { range.deleteContents(); range.insertNode(image); } else area.append(image);
        changed();
      }
      const inserted = [...area.querySelectorAll("img")].find((entry) => !before.has(entry) && entry.getAttribute("src") === picked.src) as HTMLImageElement | undefined;
      if (inserted) { select(inserted); altInput.focus(); }
    });
  };
  const replaceImage = () => {
    const image = selected;
    if (!image) return;
    options.pickImage?.(image.getAttribute("src") ?? "", (picked) => { image.setAttribute("src", picked.src); select(image); changed(); });
  };

  // ---------------------------------------------------------------- area events

  area.addEventListener("input", () => { changed(); place(); });
  area.addEventListener("focus", () => { if (mode === "visual" && !disabled) { ensureParagraph(); try { doc.execCommand("defaultParagraphSeparator", false, "p"); doc.execCommand("styleWithCSS", false, "false"); } catch { /* old browsers */ } } });
  area.addEventListener("keyup", () => { remember(); refreshState(); });
  area.addEventListener("mouseup", () => { remember(); refreshState(); });
  area.addEventListener("click", (event) => {
    if (disabled) return;
    const target = event.target as Element;
    if (target?.tagName?.toLowerCase() === "img") select(target as HTMLImageElement);
    else deselect();
  });
  area.addEventListener("keydown", (event) => {
    if (!selected) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeImage(); }
    else if (event.key === "Escape") deselect();
  });
  // Paste keeps only the text (like the CMS this grew out of): no foreign styles, scripts or images.
  area.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
    if (text && !exec("insertText", text)) {
      remember();
      savedRange?.deleteContents();
      savedRange?.insertNode(doc.createTextNode(text));
      changed();
    }
  });
  // Dropped files or HTML would bypass the image sheet; images are added with the Image button.
  area.addEventListener("drop", (event) => event.preventDefault());
  area.addEventListener("scroll", place);
  // Page-wide listeners go away with the editor (the admin re-renders forms when the route changes).
  const onResize = () => { if (!element.isConnected) { win?.removeEventListener?.("resize", onResize); return; } place(); };
  const onSelection = () => {
    if (!element.isConnected) { doc.removeEventListener("selectionchange", onSelection); return; }
    if (inArea(win?.getSelection?.()?.anchorNode)) { remember(); refreshState(); }
  };
  win?.addEventListener?.("resize", onResize);
  doc.addEventListener("selectionchange", onSelection);

  source.addEventListener("input", () => emit(source.value));

  // ---------------------------------------------------------------- modes

  const setMode = (next: typeof mode) => {
    mode = next;
    element.dataset.mode = next;
    area.hidden = next !== "visual";
    source.hidden = next !== "source";
    for (const button of formatting) (button as HTMLButtonElement).disabled = disabled || next !== "visual";
    toggle.textContent = next === "source" ? "Visual editor" : `Edit ${sourceName}`;
    toggle.setAttribute("aria-pressed", String(next === "source"));
    (toggle as HTMLButtonElement).disabled = disabled || next === "loading";
    if (next !== "visual") { deselect(); linkBar.hidden = true; }
  };
  const visualSafe = (value: string) => !markdown || (md ? md.canEditVisually(value, (html) => inert(html)) : false);
  const toSource = () => {
    source.value = current;
    status.textContent = "";
    setMode("source");
    source.focus();
  };
  const toVisual = () => {
    if (!visualSafe(current)) {
      status.textContent = "This text uses formatting the visual editor can't keep (for example HTML blocks or footnotes), so it stays in Markdown.";
      return;
    }
    if (markdown && md) style = md.markdownStyle(current);
    paragraphs = blocky(current);
    status.textContent = "";
    render(current);
    setMode("visual");
    area.focus();
  };

  const element = h(doc, "div", { class: `vc-rich-editor${disabled ? " vc-rich-disabled" : ""}`, "data-format": format }, toolbar, linkBar, imageBar, area, source, frame, handle, status);
  setMode(mode);

  const ready = (async () => {
    if (!markdown) { render(current); return; }
    area.textContent = "Loading the editor…";
    try { md = await (options.loadMarkdown ?? (() => import("./markdown.js")))(); } catch { md = undefined; }
    if (!md) { toSource(); status.textContent = "The visual editor could not load; edit the Markdown below."; return; }
    style = md.markdownStyle(current);
    if (!visualSafe(current)) { toSource(); status.textContent = "This text uses formatting the visual editor can't keep (for example HTML blocks or footnotes), so it opens as Markdown."; return; }
    render(current);
    setMode("visual");
  })();

  return {
    element, area, source, ready,
    mode: () => mode,
    selectedImage: () => selected,
    setValue: (value: string) => {
      current = value;
      paragraphs = blocky(value);
      if (mode === "source" || mode === "loading") { source.value = value; return; }
      if (!visualSafe(value)) { toSource(); return; }
      if (markdown && md) style = md.markdownStyle(value);
      render(value);
    },
  };
};
