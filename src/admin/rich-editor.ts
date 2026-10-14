/**
 * P8d: the visual editor for rich text and Markdown bodies — what the CMS the package grew out of had (a toolbar over
 * an editable area, paste keeps only the text), plus images: insert one from the image sheet (P10), click it to set
 * its alt text, replace or remove it, and resize it by dragging its corner (or typing a width) — the ratio is always
 * kept: only `width` is written, the height follows.
 *
 * Values: rich text stays HTML; a Markdown body stays Markdown (src/admin/markdown.ts, loaded only when needed). An
 * untouched field is never re-written: the value changes only after an edit. A Markdown post that the editor could not
 * show without changing it opens as Markdown, with a note.
 *
 * M10: the toolbar is the Mr Spa CMS's — Paragraph · Heading 2 · Heading 3 · B · I · Bulleted list · Numbered list ·
 * Add link · Insert image, plain text buttons; Quote only when the field's `allow` asks for blockquote. Add link opens
 * the Mr Spa dialog ("Choose a page" / "Or enter a secure HTTPS URL").
 *
 * The editor uses the browser's editing commands (execCommand) so Ctrl+Z / Ctrl+Y keep working; what they write is
 * cleaned (src/admin/clean.ts) before it becomes the value, and the server cleans again (P8c).
 */
import { cleanRichDom, isEmptyRich, normalizeBlocks } from "./clean.js";
import { openDialog } from "./dialog.js";
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
  /** P12d: the tags this field may hold; tools that need other tags are not shown. */
  allow?: readonly string[];
  /** M10: the site's pages for Add link ([path, name]). */
  pages?: ReadonlyArray<readonly [string, string]>;
};

export type RichEditor = {
  element: HTMLElement;
  /** The editable area (visual mode). */
  area: HTMLElement;
  /** The source box (HTML / Markdown). */
  source: HTMLTextAreaElement;
  /** M10: the formatting bar (the document layout puts it on top of the paper). */
  toolbar: HTMLElement;
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

/** M10 (Mr Spa): Add link takes a page of the site or a secure (https) address; the problem, in its words. */
export const linkProblem = (page: string, url: string) => {
  if (page) return null;
  const typed = url.trim();
  if (!typed) return "Choose a page or enter an HTTPS URL.";
  try { return new URL(typed).protocol === "https:" ? null : "Use a valid HTTPS URL."; } catch { return "Use a valid HTTPS URL."; }
};

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
    return cleanRichDom(box, { markdown, allow: options.allow });
  };
  const toHtml = (value: string) => (markdown && md ? md.markdownToHtml(value) : value);

  const serialize = () => {
    const copy = area.cloneNode(true) as HTMLElement;
    normalizeBlocks(cleanRichDom(copy, { markdown, allow: options.allow }), { wrapLoose: (markdown || paragraphs) && (!options.allow || options.allow.includes("p")) });
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

  const tool = (name: string, text: string | Node, run: () => void, extra: Record<string, string> = {}) => {
    const button = h(doc, "button", { type: "button", class: `vc-tool vc-tool-${name}`, disabled, "data-command": name, ...extra }, text);
    // Keep the selection in the editor while the button is pressed.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => { if (mode === "visual") run(); });
    return button;
  };
  const block = (tag: string) => () => exec("formatBlock", `<${tag}>`);
  // Mr Spa: B and I are bold / italic letters named "Bold" / "Italic"; the others say what they do.
  const bold = tool("bold", h(doc, "strong", {}, "B"), () => exec("bold"), { "aria-label": "Bold" });
  const italic = tool("italic", h(doc, "em", {}, "I"), () => exec("italic"), { "aria-label": "Italic" });
  /** P12d: the tags each tool writes — a tool is shown only when the field allows all of them. */
  const NEEDS: Record<string, string[]> = { paragraph: ["p"], heading: ["h2"], subheading: ["h3"], bold: ["strong"], italic: ["em"], bullets: ["ul", "li"], numbers: ["ol", "li"], quote: ["blockquote"], link: ["a"], image: ["img"] };
  const allowed = (button: HTMLButtonElement) => !options.allow || (NEEDS[button.dataset.command ?? ""] ?? []).every((tag) => options.allow!.includes(tag));
  const formatting = [
    tool("paragraph", "Paragraph", block("p")),
    tool("heading", "Heading 2", block("h2")),
    tool("subheading", "Heading 3", block("h3")),
    bold, italic,
    tool("bullets", "Bulleted list", () => exec("insertUnorderedList")),
    tool("numbers", "Numbered list", () => exec("insertOrderedList")),
    // Not in the Mr Spa set: only for a field whose `allow` asks for quotes.
    ...(options.allow?.includes("blockquote") ? [tool("quote", "Quote", () => exec("formatBlock", closest("blockquote") ? "<p>" : "<blockquote>"))] : []),
    tool("link", "Add link", () => openLink()),
    ...(options.pickImage ? [tool("image", "Insert image", () => insertImage())] : []),
  ].filter(allowed);
  const toolbar = h(doc, "div", { class: "vc-rich-toolbar", role: "toolbar", "aria-label": `${label} formatting`, "aria-controls": id }, ...formatting);

  const closest = (tag: string) => {
    const node = win?.getSelection?.()?.anchorNode;
    let element = (node && node.nodeType === 1 ? node : node?.parentNode) as Element | null | undefined;
    while (element && element !== area) { if (element.tagName?.toLowerCase() === tag) return element; element = element.parentElement; }
    return undefined;
  };
  /** M10: Mr Spa's toolbar has no on / off states. */
  const refreshState = () => {};

  // ---------------------------------------------------------------- links (M10: the Mr Spa CMS's Add link dialog)

  const insertLink = (href: string) => {
    restore();
    const selection = win?.getSelection?.();
    if (selection && selection.rangeCount && selection.getRangeAt(0).collapsed) {
      const a = doc.createElement("a");
      a.setAttribute("href", href);
      a.textContent = href;
      if (!exec("insertHTML", a.outerHTML)) { savedRange?.insertNode(a); changed(); }
    } else if (!exec("createLink", href)) changed();
    return [...area.querySelectorAll("a")].some((link) => link.getAttribute("href") === href);
  };
  const openLink = () => {
    remember();
    if (!savedRange || !inArea(savedRange.commonAncestorContainer)) { status.textContent = "Select the words to link first."; return; }
    status.textContent = "";
    const pageId = `${id}-link-page`; const urlId = `${id}-link-url`;
    const select = h(doc, "select", { id: pageId, class: "vc-input" }, h(doc, "option", { value: "" }, "Choose a page…"), ...(options.pages ?? []).map(([path, name]) => h(doc, "option", { value: path }, name)));
    const url = h(doc, "input", { id: urlId, class: "vc-input", type: "url", inputmode: "url", placeholder: "https://example.com/page", autocomplete: "off" });
    const problem = h(doc, "p", { class: "vc-link-dialog-status", role: "status", "aria-live": "polite" });
    // Mr Spa: choosing a page puts its address in the box.
    select.addEventListener("change", () => { if (select.value) url.value = select.value; problem.textContent = ""; });
    url.addEventListener("input", () => { problem.textContent = ""; });
    const dialog = openDialog(doc, {
      title: "Add link",
      body: [h(doc, "div", { class: "vc-link-dialog" },
        h(doc, "label", { for: pageId, class: "vc-label" }, "Choose a page"), select,
        h(doc, "label", { for: urlId, class: "vc-label" }, "Or enter a secure HTTPS URL"), url,
        h(doc, "p", { class: "vc-help" }, "Select the words to link first. Internal pages are safer and easier to maintain."), problem)],
      buttons: [{ label: "Cancel", value: "cancel", kind: "plain" }, { label: "Insert link", value: "insert", kind: "primary" }],
      dismiss: "cancel",
      onButton: (value) => {
        if (value !== "insert") return;
        const wrong = linkProblem(select.value, url.value);
        if (wrong) { problem.textContent = wrong; (select.value || !url.value.trim() ? select : url).focus(); return false; }
        if (!insertLink(select.value || url.value.trim())) { problem.textContent = "The link could not be inserted."; return false; }
      },
    });
    select.focus();
    void dialog.done.then((value) => { if (value !== "insert") restore(); });
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
    if (next !== "visual") deselect();
  };
  const visualSafe = (value: string) => !markdown || (md ? md.canEditVisually(value, (html) => inert(html)) : false);
  /** Only when the visual editor cannot show the value (M10: no "Edit HTML / Markdown" button, as in Mr Spa). */
  const toSource = () => {
    source.value = current;
    status.textContent = "";
    setMode("source");
  };

  const element = h(doc, "div", { class: `vc-rich-editor${disabled ? " vc-rich-disabled" : ""}`, "data-format": format }, toolbar, imageBar, area, source, frame, handle, status);
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
    element, area, source, toolbar, ready,
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
