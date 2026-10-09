/**
 * P9: the preview bridge — shows the draft being edited on the real page, in a same-origin <iframe>, as it is typed.
 *
 * The page is the published one: nothing is added to the public HTML. The admin opens it in an iframe of the same
 * origin and this code (running in the admin) works on the iframe's document directly (DESIGN decision 7: no loader on
 * the public page). Because it is a direct call and not a script injected into the page, the site's Content Security
 * Policy cannot block it, and there is no message channel another window could speak on.
 *
 * Where content shows on the page, the template says so (DESIGN §D):
 *   data-cms-field="site.hero.title"              a file's field ("<file key>.<path>")
 *   data-cms-field-href / data-cms-field-alt      the link / alt text of an element comes from a field
 *   data-cms-item="services:spa-pedicure"         a collection record; data-cms-field inside it is the record's field
 *   data-cms-list="services"                      where a collection's records are listed (a new record is shown here)
 *   data-cms-list="site.footerLinks"              a list field; its items carry data-cms-item-index="0", "1"…, and
 *                                                 data-cms-field inside an item is relative to it (lists nest)
 *   data-cms-section="contact"                    the element of a file section (cms.config sections)
 * A field with `bind: "<css selector>"` in cms.config is bound by selector instead (old templates that must not change).
 *
 * Typing updates only the elements bound to the changed field (no reload, no re-render). Clicking a bound element in
 * the preview selects it and opens it in the form; focusing a field in the form scrolls the preview to it. Outlines:
 * the selected field (2 px, with a "Section · Field" chip), its section (1 px, light), the field under the pointer
 * (dashed). Links to other sites and form submissions do nothing in the preview.
 */
import type { Field } from "../config/index.js";
import { formatHours } from "./changes.js";
import { cleanRichDom, normalizeBlocks } from "./clean.js";
import { getAt, isRecord, keyPath, type Path } from "./value.js";

type MarkdownModule = typeof import("./markdown.js");

/** The record being edited, as the API names it: "file:site", "item:services:spa-pedicure". */
export type PreviewOwner = string;
export type PreviewSelection = { owner: PreviewOwner; path: Path; element: Element };
export type BridgeOptions = {
  /** The iframe's window (same origin). */
  frame: Window;
  /** The admin's document (inert parsing of rich text). */
  doc: Document;
  /** Who is being edited, and its current value (the form's). For a new record, `newItem` says where to show it. */
  owner: PreviewOwner;
  value: Record<string, unknown>;
  fields: Record<string, Field>;
  /** Top-level keys holding Markdown (a Markdown record's body). */
  markdown?: string[];
  newItem?: { collection: string };
  /** Selector bindings from cms.config (`bind`), for files: path text → selector. */
  binds?: Array<{ owner: PreviewOwner; path: Path; selector: string }>;
  /** "Contact & hours · Phone" for the chip. */
  describe: (owner: PreviewOwner, path: Path) => string;
  /** The section element of a path, when the template marks sections (data-cms-section). */
  sectionOf?: (owner: PreviewOwner, path: Path) => string | undefined;
  referenceLabel?: (to: string, id: string) => string;
  loadMarkdown?: () => Promise<MarkdownModule>;
  /** A bound element was clicked in the preview (never called for scrollTo). */
  onSelect: (selection: PreviewSelection) => void;
  now?: () => number;
};
export type Bridge = {
  /** The form changed at `path` (the whole value is given); `owner` when a new record's id changed. */
  update: (value: Record<string, unknown>, path: Path, owner?: PreviewOwner) => void;
  /** Show where a field is (scroll + outline), without reporting a selection back. Returns false if not on the page. */
  scrollTo: (path: Path) => boolean;
  clearSelection: () => void;
  /** How many places on the page show the record being edited. */
  count: () => number;
  stats: () => { updates: number; lastMs: number; maxMs: number };
  detach: () => void;
};

const ATTRIBUTES = ["data-cms-field", "data-cms-field-href", "data-cms-field-alt"] as const;
type Attribute = typeof ATTRIBUTES[number];
type Binding = { element: Element; attribute: Attribute; owner: PreviewOwner; path: Path };

/** "hero.title", "footerLinks.0.links[1].href" → steps (digits are list positions). */
export const bindingPath = (text: string): Path => {
  const out: Path = [];
  for (const match of text.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) out.push(match[1] !== undefined ? Number(match[1]) : /^\d+$/.test(match[2]) ? Number(match[2]) : match[2]);
  return out;
};

/** The field a path points into (dotted keys, objects, lists), and the steps left past it (e.g. an image's "alt"). */
export const fieldAt = (fields: Record<string, Field>, path: Path): { field: Field; rest: Path } | undefined => {
  let set: Record<string, Field> | undefined = fields;
  let field: Field | undefined;
  let index = 0;
  while (index < path.length) {
    if (set) {
      let found = false;
      for (let end = path.length; end > index; end -= 1) {
        const key = path.slice(index, end).join(".");
        if (key in set) { field = set[key]; index = end; found = true; break; }
      }
      if (!found) return field ? { field, rest: path.slice(index) } : undefined;
      set = undefined;
    }
    if (!field) return undefined;
    if (field.type === "object") { set = field.fields; if (index >= path.length) break; continue; }
    if (field.type === "list" && typeof path[index] === "number") { field = field.of; index += 1; if (field.type === "object") set = field.fields; continue; }
    break;
  }
  return field ? { field, rest: path.slice(index) } : undefined;
};

/** Walk up from `start` with a path relative to it, through list items and records, to who owns it. */
const resolveFrom = (start: Element | null, relative: Path): { owner: PreviewOwner; path: Path } | undefined => {
  let rel = relative;
  let node = start;
  while (node) {
    const item = node.getAttribute("data-cms-item");
    if (item) {
      const at = item.indexOf(":");
      return at > 0 ? { owner: `item:${item.slice(0, at)}:${item.slice(at + 1)}`, path: rel } : undefined;
    }
    const index = node.getAttribute("data-cms-item-index");
    if (index !== null && /^\d+$/.test(index)) {
      const list: Element | null | undefined = node.parentElement?.closest("[data-cms-list]");
      if (!list) return undefined;
      rel = [...bindingPath(list.getAttribute("data-cms-list") ?? ""), Number(index), ...rel];
      node = list.parentElement;
      continue;
    }
    node = node.parentElement;
  }
  // Not inside a record: "<file key>.<path>".
  return rel.length > 1 && typeof rel[0] === "string" ? { owner: `file:${rel[0]}`, path: rel.slice(1) } : undefined;
};

/** Whose field an element shows, and which: walks up through list items and records. */
export const resolveBinding = (element: Element, attribute: Attribute = "data-cms-field") => {
  const raw = element.getAttribute(attribute);
  return raw ? resolveFrom(element, bindingPath(raw)) : undefined;
};
/** Whose list a data-cms-list element of list items (data-cms-item-index) shows. */
export const resolveList = (list: Element) => resolveFrom(list.parentElement, bindingPath(list.getAttribute("data-cms-list") ?? ""));

const startsWith = (path: Path, prefix: Path) => prefix.length <= path.length && prefix.every((step, index) => step === path[index]);
const related = (a: Path, b: Path) => startsWith(a, b) || startsWith(b, a);

export const attachBridge = (options: BridgeOptions): Bridge => {
  const { frame, owner: initialOwner } = options;
  const page = frame.document;
  const now = options.now ?? (() => frame.performance?.now?.() ?? Date.now());
  let value = options.value;
  let owner = initialOwner;
  let md: MarkdownModule | undefined;
  const stats = { updates: 0, lastMs: 0, maxMs: 0 };
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof DocumentEventMap>(target: Document | Window, type: K, handler: (event: DocumentEventMap[K]) => void, capture = true) => {
    target.addEventListener(type, handler as EventListener, { capture, passive: false });
    cleanups.push(() => target.removeEventListener(type, handler as EventListener, { capture }));
  };

  // ---------------------------------------------------------------- bindings

  for (const bind of options.binds ?? []) {
    if (bind.owner !== owner || !bind.owner.startsWith("file:")) continue;
    let elements: Element[] = [];
    try { elements = [...page.querySelectorAll(bind.selector)]; } catch { elements = []; }
    for (const element of elements) if (!element.hasAttribute("data-cms-field")) element.setAttribute("data-cms-field", [bind.owner.slice(5), ...bind.path].join("."));
  }

  // A new record: show it where its collection is listed, as a copy of the first record there.
  let newElement: Element | undefined;
  if (options.newItem) {
    const list = page.querySelector(`[data-cms-list="${options.newItem.collection}"]`);
    const template = list?.querySelector("[data-cms-item]");
    if (list && template) {
      newElement = template.cloneNode(true) as Element;
      newElement.setAttribute("data-cms-preview-new", "");
      list.append(newElement);
    }
  }
  const syncNewItem = () => {
    if (!newElement || !options.newItem) return;
    newElement.setAttribute("data-cms-item", `${options.newItem.collection}:${owner.split(":").slice(2).join(":")}`);
  };
  syncNewItem();

  let bindings: Binding[] = [];
  const scan = () => {
    const out: Binding[] = [];
    for (const attribute of ATTRIBUTES) {
      for (const element of page.querySelectorAll(`[${attribute}]`)) {
        const resolved = resolveBinding(element, attribute);
        if (resolved && resolved.owner === owner) out.push({ element, attribute, ...resolved });
      }
    }
    bindings = out;
  };

  // ---------------------------------------------------------------- applying values

  const safeUrl = (raw: unknown, kind: "href" | "src") => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return undefined;
    if (text.startsWith("/") && !text.startsWith("//")) return text;
    if (text.startsWith("#") || text.startsWith("?")) return kind === "href" ? text : undefined;
    try {
      const url = new URL(text);
      return (kind === "href" ? ["http:", "https:", "mailto:", "tel:"] : ["http:", "https:"]).includes(url.protocol) ? text : undefined;
    } catch { return undefined; }
  };

  const setImage = (element: Element, raw: unknown) => {
    const image = (element.tagName === "IMG" ? element : element.querySelector("img")) as HTMLImageElement | null;
    if (!image) return;
    const src = safeUrl(typeof raw === "string" ? raw : isRecord(raw) ? raw.src : undefined, "src");
    if (src) { image.setAttribute("src", src); if (image.hasAttribute("srcset")) image.setAttribute("srcset", src); for (const source of image.parentElement?.tagName === "PICTURE" ? image.parentElement.querySelectorAll("source") : []) source.setAttribute("srcset", src); }
    if (isRecord(raw) && typeof raw.alt === "string") image.setAttribute("alt", raw.alt);
  };

  const setRich = (element: Element, html: string) => {
    const box = options.doc.implementation.createHTMLDocument("").createElement("div");
    box.innerHTML = html;
    normalizeBlocks(cleanRichDom(box, { markdown: true }));
    element.replaceChildren(...[...box.childNodes].map((node) => page.importNode(node, true)));
  };

  const setList = (element: Element, items: string[]) => {
    if (element.tagName === "UL" || element.tagName === "OL") element.replaceChildren(...items.map((text) => { const li = page.createElement("li"); li.textContent = text; return li; }));
    else element.textContent = items.join(", ");
  };

  const apply = (binding: Binding) => {
    const { element, attribute, path } = binding;
    const raw = getAt(value, path);
    // An item hidden because the list got shorter keeps what it showed (it comes back as it was if re-added).
    if (raw === undefined && element.closest("[hidden]")) return;
    if (attribute === "data-cms-field-href") { const href = safeUrl(raw, "href"); if (href) element.setAttribute("href", href); return; }
    if (attribute === "data-cms-field-alt") { element.setAttribute("alt", typeof raw === "string" ? raw : ""); return; }
    const found = fieldAt(options.fields, path);
    const field = found?.field;
    if (field?.type === "image" && !found?.rest.length) { setImage(element, raw); return; }
    if (field?.type === "image" && found?.rest[0] === "alt") { const image = element.tagName === "IMG" ? element : element.querySelector("img"); image?.setAttribute("alt", typeof raw === "string" ? raw : ""); return; }
    if (element.tagName === "IMG") { const src = safeUrl(raw, "src"); if (src) element.setAttribute("src", src); return; }
    if (field?.type === "richText") {
      const text = typeof raw === "string" ? raw : "";
      const markdown = path.length === 1 && options.markdown?.includes(String(path[0]));
      if (!markdown) { setRich(element, text); return; }
      if (md) { setRich(element, md.markdownToHtml(text)); return; }
      void (options.loadMarkdown ?? (() => import("./markdown.js")))().then((module) => { md = module; apply(binding); place(); }).catch(() => undefined);
      return;
    }
    if (field?.type === "hours") { const rows = formatHours(raw).split(" · ").filter(Boolean); if (element.tagName === "UL" || element.tagName === "OL") setList(element, rows); else element.textContent = rows.join(" · "); return; }
    if (field?.type === "reference") { const ids = Array.isArray(raw) ? raw : raw ? [raw] : []; setList(element, ids.map((id) => options.referenceLabel?.(field.to, String(id)) ?? String(id))); return; }
    if (field?.type === "list" && Array.isArray(raw) && raw.every((item) => typeof item !== "object" || item === null)) { setList(element, raw.map((item) => String(item ?? ""))); return; }
    if (raw !== null && typeof raw === "object") return;
    element.textContent = raw === undefined || raw === null ? "" : String(raw);
  };

  /** A list field shown item by item: as many items as the value has (copies of the first; extra ones hidden). */
  const syncLists = (changed: Path) => {
    // A copied item brings copies of its own lists: go again until nothing moves (lists nest a few levels at most).
    for (let round = 0; round < 6 && syncListsOnce(changed); round += 1) scan();
  };
  const syncListsOnce = (changed: Path) => {
    let structure = false;
    for (const list of page.querySelectorAll("[data-cms-list]")) {
      const children = [...list.children].filter((child) => child.hasAttribute("data-cms-item-index"));
      if (!children.length) continue;
      const resolved = resolveList(list);
      if (!resolved || resolved.owner !== owner) continue;
      const listPath = resolved.path;
      if (!related(changed, listPath)) continue;
      const items = getAt(value, listPath);
      if (!Array.isArray(items)) continue;
      for (let index = 0; index < Math.max(items.length, children.length); index += 1) {
        let child = children[index];
        if (!child && index < items.length) {
          child = children[0].cloneNode(true) as Element;
          child.setAttribute("data-cms-preview-new", "");
          list.append(child);
          structure = true;
        }
        if (!child) continue;
        child.setAttribute("data-cms-item-index", String(index));
        const hidden = index >= items.length;
        if ((child as HTMLElement).hidden !== hidden) { (child as HTMLElement).hidden = hidden; structure = true; }
      }
    }
    return structure;
  };

  const applyAll = (changed?: Path) => {
    const start = now();
    if (changed) syncLists(changed);
    for (const binding of bindings) if (!changed || related(binding.path, changed)) apply(binding);
    const took = now() - start;
    stats.updates += 1; stats.lastMs = took; stats.maxMs = Math.max(stats.maxMs, took);
    place();
  };

  // ---------------------------------------------------------------- outlines

  const layer = page.createElement("div");
  layer.setAttribute("data-vibe-cms-preview", "");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
  const box = (border: string) => {
    const element = page.createElement("div");
    Object.assign(element.style, { position: "fixed", display: "none", boxSizing: "border-box", border, borderRadius: "3px", pointerEvents: "none" });
    layer.append(element);
    return element;
  };
  const sectionBox = box("1px solid rgba(0, 113, 227, 0.35)");
  const hoverBox = box("1px dashed rgba(0, 113, 227, 0.7)");
  const selectedBox = box("2px solid #0071e3");
  const chip = page.createElement("span");
  Object.assign(chip.style, { position: "absolute", left: "-2px", bottom: "100%", padding: "2px 6px", font: "500 11px/1.4 system-ui, sans-serif", color: "#fff", background: "#0071e3", borderRadius: "3px 3px 0 0", whiteSpace: "nowrap" });
  selectedBox.append(chip);
  page.body?.append(layer);
  cleanups.push(() => layer.remove());

  let selected: Element | undefined;
  let hovered: Element | undefined;
  let sectionElement: Element | undefined;
  const show = (target: HTMLElement, element: Element | undefined) => {
    if (!element || !element.isConnected || (element as HTMLElement).hidden) { target.style.display = "none"; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(target.style, { display: "block", left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
  };
  function place() { show(selectedBox, selected); show(hoverBox, hovered && hovered !== selected ? hovered : undefined); show(sectionBox, sectionElement); }
  let frameRequest = 0;
  const schedule = () => { if (!frameRequest) frameRequest = frame.requestAnimationFrame?.(() => { frameRequest = 0; place(); }) ?? 0; };
  listen(frame, "scroll" as keyof DocumentEventMap, schedule);
  listen(frame, "resize" as keyof DocumentEventMap, schedule);

  const sectionFor = (target: { owner: PreviewOwner; path: Path }, element: Element) => {
    const key = options.sectionOf?.(target.owner, target.path);
    return (key ? page.querySelector(`[data-cms-section="${key}"]`) : null) ?? element.closest("[data-cms-section]") ?? element.closest("[data-cms-item]") ?? undefined;
  };
  const selectElement = (element: Element, target: { owner: PreviewOwner; path: Path }) => {
    selected = element;
    chip.textContent = options.describe(target.owner, target.path);
    const section = sectionFor(target, element);
    sectionElement = section && section !== element ? section : undefined;
    place();
  };
  const clearSelection = () => { selected = undefined; sectionElement = undefined; place(); };

  // ---------------------------------------------------------------- pointer in the preview

  const boundAt = (node: EventTarget | null) => {
    // The iframe has its own Element class: test the node type, not instanceof.
    const start = node as Node | null;
    let element: Element | null = !start ? null : start.nodeType === 1 ? (start as Element) : start.parentElement;
    while (element) {
      for (const attribute of ATTRIBUTES) {
        if (element.hasAttribute(attribute)) {
          const resolved = resolveBinding(element, attribute);
          if (resolved) return { element, ...resolved };
        }
      }
      element = element.parentElement;
    }
    return undefined;
  };
  listen(page, "click", (event) => {
    const hit = boundAt(event.target);
    if (hit) {
      event.preventDefault();
      event.stopPropagation();
      selectElement(hit.element, hit);
      options.onSelect({ owner: hit.owner, path: hit.path, element: hit.element });
      return;
    }
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (link) {
      let external = true;
      try { external = new URL(link.href, frame.location.href).origin !== frame.location.origin || link.target === "_blank"; } catch { external = true; }
      if (external) event.preventDefault();
    }
  });
  listen(page, "submit", (event) => event.preventDefault());
  const canHover = frame.matchMedia?.("(hover: hover)")?.matches ?? true;
  if (canHover) {
    listen(page, "mouseover", (event) => { const hit = boundAt(event.target); hovered = hit?.element; place(); });
    listen(page, "mouseleave" as keyof DocumentEventMap, () => { hovered = undefined; place(); });
  }
  listen(page, "keydown", (event) => { if ((event as KeyboardEvent).key === "Escape") clearSelection(); });

  // ---------------------------------------------------------------- start

  scan();
  applyAll();

  return {
    update: (next, path, nextOwner) => {
      value = next;
      // A new record's id is typed (or filled from its name): it is still the same record on the page.
      if (nextOwner && nextOwner !== owner) { owner = nextOwner; syncNewItem(); scan(); applyAll(); return; }
      applyAll(path);
    },
    scrollTo: (path) => {
      const binding = bindings.find((entry) => startsWith(entry.path, path) && !(entry.element as HTMLElement).hidden) ?? bindings.find((entry) => startsWith(path, entry.path) && !(entry.element as HTMLElement).hidden);
      if (!binding) { clearSelection(); return false; }
      const reduce = frame.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      binding.element.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
      selectElement(binding.element, binding);
      return true;
    },
    clearSelection,
    count: () => bindings.length,
    stats: () => ({ ...stats }),
    detach: () => { for (const cleanup of cleanups.splice(0)) cleanup(); newElement?.remove(); },
  };
};

/** The bindings a cms.config `bind` selector gives a file's fields (any depth, not inside lists). */
export const configBinds = (fileKey: string, fields: Record<string, Field>, base: Path = []): Array<{ owner: PreviewOwner; path: Path; selector: string }> => {
  const out: Array<{ owner: PreviewOwner; path: Path; selector: string }> = [];
  for (const [key, field] of Object.entries(fields)) {
    const path = [...base, ...keyPath(key)];
    if (field.bind) out.push({ owner: `file:${fileKey}`, path, selector: field.bind });
    if (field.type === "object") out.push(...configBinds(fileKey, field.fields, path));
  }
  return out;
};
