/**
 * M3: the page inspector of the Mr Spa CMS (360 px, right of the canvas) — two levels.
 *   Level 1: the tip "Click any part of the page, or pick a section below." (hideable) and the sections in the order
 *            the page shows them — each row: its name, one line of what it holds, an orange dot when it has unsaved
 *            changes, "›". The head: crumb "Pages" (or the collection), title = the page.
 *   Level 2: one section's fields. The head: ← ("Close section"), crumb = the page, title = the section. Esc goes back
 *            (unless typing or a dialog is open), focus returns to the section's row; 220 ms slide between levels;
 *            the open section is remembered for the session.
 * A page with one section (or none declared) opens straight at level 2, without ←. The form keeps every section in
 * the DOM (errors, focus, values); the inspector only shows one of them.
 */
import type { Field } from "../config/index.js";
import { clear, h, icon } from "./dom.js";
import type { Form } from "./form.js";
import { getAt, keyPath, pathText, type Path } from "./value.js";

export type InspectorSection = { key: string; label: string; fields: string[] };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SECTION_LIST_HINT = "Click any part of the page, or pick a section below.";
const TIP_KEY = "vibe-cms:tip-hidden:page-sections";

/** The sections the form shows: the config's (those with fields), then "Other" for fields in none; one when none declared. */
export const inspectorSections = (fields: Record<string, Field>, sections: Array<{ key: string; label: string; fields: string[] }> | undefined, pageLabel: string): InspectorSection[] => {
  const declared = (sections ?? []).map((section) => ({ ...section, fields: section.fields.filter((key) => key in fields) })).filter((section) => section.fields.length);
  if (!declared.length) return [{ key: "_all", label: pageLabel, fields: Object.keys(fields) }];
  const placed = new Set(declared.flatMap((section) => section.fields));
  const rest = Object.keys(fields).filter((key) => !placed.has(key));
  return [...declared, ...(rest.length ? [{ key: "_other", label: "Other", fields: rest }] : [])];
};

/** Mr Spa: sections in page order — by the first of their fields on the page; the others keep their order, after. */
export const orderSectionsByPage = (sections: InspectorSection[], order: string[]) => {
  const position = (section: InspectorSection) => {
    const indexes = order.map((text, index) => (section.fields.some((key) => text === key || text.startsWith(`${key}.`) || text.startsWith(`${key}[`)) ? index : -1)).filter((index) => index >= 0);
    return indexes.length ? Math.min(...indexes) : Number.POSITIVE_INFINITY;
  };
  return sections.map((section, index) => ({ section, index, at: position(section) })).sort((a, b) => a.at - b.at || a.index - b.index).map(({ section }) => section);
};

const plain = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
/** "2 banners", "1 category card" (Mr Spa). */
export const countItems = (count: number, itemLabel = "item") => {
  const noun = itemLabel.charAt(0).toLowerCase() + itemLabel.slice(1);
  return `${count} ${count === 1 ? noun : /(?:s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`}`;
};

/**
 * One line under a section's name (Mr Spa): its title / heading text, otherwise its first filled text, otherwise what
 * its lists hold ("2 banners"), otherwise how many fields it has. Cut to 120 characters (CSS adds … when narrower).
 */
export const sectionSummary = (section: InspectorSection, fields: Record<string, Field>, value: Record<string, unknown>, maxLength = 120) => {
  const texts = section.fields.filter((key) => fields[key]?.type === "text");
  const titled = texts.filter((key) => /(?:^|\.)(?:title|heading)$/i.test(key));
  for (const key of [...titled, ...texts]) {
    const text = plain(getAt(value, keyPath(key)));
    if (text) return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  const lists = section.fields.flatMap((key) => {
    const field = fields[key];
    const items = getAt(value, keyPath(key));
    return field?.type === "list" && Array.isArray(items) ? [countItems(items.length, field.itemLabel ?? field.of.label)] : [];
  });
  if (lists.length) return lists.join(" · ");
  return `${section.fields.length} editable field${section.fields.length === 1 ? "" : "s"}`;
};

/** The section holding a field (by its path text: "phone", "address.street", "footerLinks[0].title"). */
export const sectionOfPath = (sections: InspectorSection[], text: string) =>
  sections.find((section) => section.fields.some((key) => text === key || text.startsWith(`${key}.`) || text.startsWith(`${key}[`)));

export type InspectorOptions = {
  doc: Document;
  form: Form;
  fields: Record<string, Field>;
  sections: InspectorSection[];
  /** Level 1's crumb ("Pages", the collection's name). */
  crumb: string;
  /** The page's name (level 1's title, level 2's crumb). */
  title: string;
  value: () => Record<string, unknown>;
  saved: () => Record<string, unknown>;
  /** Shown between the head and the content (e.g. the editor's banner). */
  before?: Node[];
  /** Where the open section is remembered (per resource) and the hidden tip. */
  session?: Store | null;
  local?: Store | null;
  resource: string;
  /** A section was opened / closed by the person (not by a click on the page). */
  onEnter?: (section: InspectorSection) => void;
  onLeave?: () => void;
};

export type Inspector = {
  element: HTMLElement;
  /** The page's fields in page order (from the preview): the rows follow it. */
  setOrder: (order: Path[]) => void;
  /** Show the section of a field (level 2); false when the field is in none. */
  openFor: (text: string) => boolean;
  open: (key: string, how?: { quiet?: boolean }) => void;
  leave: () => void;
  /** Redraw the rows (summaries, unsaved dots) and the head. */
  refresh: () => void;
  setTitle: (title: string) => void;
  current: () => InspectorSection | null;
  destroy: () => void;
};

export const createInspector = (options: InspectorOptions): Inspector => {
  const { doc, form, fields } = options;
  let sections = options.sections;
  let title = options.title;
  const single = sections.length === 1;
  const memoryKey = `vibe-cms:section:${options.resource}`;
  const remembered = (() => { try { return options.session?.getItem(memoryKey) ?? null; } catch { return null; } })();
  let openKey: string | null = single ? sections[0].key : sections.some((section) => section.key === remembered) ? remembered : null;
  let level: 1 | 2 | null = null;

  const back = h(doc, "button", { type: "button", class: "vc-icon-button vc-top-icon vc-inspector-back", "aria-label": "Close section", "data-tooltip": "Close section", hidden: true, onclick: () => leave() }, icon(doc, "chevron-left"));
  const crumb = h(doc, "span", { class: "vc-inspector-crumb" });
  const heading = h(doc, "h1", { class: "vc-title vc-inspector-title", tabindex: "-1" });
  const head = h(doc, "div", { class: "vc-inspector-head" }, back, h(doc, "div", { class: "vc-inspector-heading" }, crumb, heading));
  const tipHidden = () => { try { return options.local?.getItem(TIP_KEY) === "1"; } catch { return false; } };
  const tip = h(doc, "p", { class: "vc-tip" }, h(doc, "span", { class: "vc-tip-text" }, SECTION_LIST_HINT),
    h(doc, "button", { type: "button", class: "vc-tip-hide", "aria-label": "Hide tip", "data-tooltip": "Hide tip", onclick: () => { try { options.local?.setItem(TIP_KEY, "1"); } catch { /* not remembered */ } tip.hidden = true; rows.querySelector<HTMLElement>("button")?.focus(); } }, "×"));
  tip.hidden = tipHidden();
  const rows = h(doc, "ul", { class: "vc-sections", "aria-label": `${title} sections` });
  const levelOne = h(doc, "div", { class: "vc-inspector-sections" }, tip, rows);
  const body = h(doc, "div", { class: "vc-inspector-body" }, levelOne, form.element);
  const element = h(doc, "div", { class: "vc-inspector" }, head, ...(options.before ?? []), body);

  const changedIn = (section: InspectorSection) => {
    const saved = options.saved();
    const current = options.value();
    return section.fields.some((key) => JSON.stringify(getAt(saved, keyPath(key)) ?? null) !== JSON.stringify(getAt(current, keyPath(key)) ?? null));
  };
  const drawRows = () => {
    clear(rows);
    const value = options.value();
    for (const section of sections) {
      const row = h(doc, "button", { type: "button", class: "vc-section-row", "data-section-key": section.key, onclick: () => open(section.key) },
        h(doc, "span", { class: "vc-section-text" }, h(doc, "strong", {}, section.label), h(doc, "span", { class: "vc-section-summary" }, sectionSummary(section, fields, value))),
        changedIn(section) ? h(doc, "span", { class: "vc-section-dot", "aria-hidden": "true" }) : null,
        changedIn(section) ? h(doc, "span", { class: "vc-sr-only" }, " (unsaved changes)") : null,
        h(doc, "span", { class: "vc-section-chevron", "aria-hidden": "true" }, "›"));
      rows.append(h(doc, "li", {}, row));
    }
  };
  const current = () => sections.find((section) => section.key === openKey) ?? null;
  const render = () => {
    const shown = current();
    const nextLevel = shown ? 2 : 1;
    back.hidden = !shown || single;
    // Mr Spa: a section open (also the only one of its page) = crumb the page, title the section; a page that declares
    // no sections at all is just itself.
    const whole = !shown || shown.key === "_all";
    crumb.textContent = whole ? options.crumb : title;
    heading.textContent = whole ? title : shown.label;
    levelOne.hidden = Boolean(shown);
    // Every section stays in the form; only the open one shows (all of them when there is a single one).
    for (const box of form.element.querySelectorAll<HTMLElement>(":scope > [data-section]")) box.hidden = !shown || (!single && box.dataset.section !== shown.key);
    if (!shown) drawRows();
    // Slide between levels (no motion with reduced motion: CSS); a redraw of the same level does not move.
    if (level !== null && level !== nextLevel) {
      body.classList.remove("vc-entering", "vc-leaving");
      void body.offsetWidth;
      body.classList.add(nextLevel === 2 ? "vc-entering" : "vc-leaving");
    }
    level = nextLevel;
  };
  const remember = () => { try { if (openKey && !single) options.session?.setItem(memoryKey, openKey); else options.session?.removeItem(memoryKey); } catch { /* not remembered */ } };
  const open = (key: string, how: { quiet?: boolean } = {}) => {
    const section = sections.find((entry) => entry.key === key);
    if (!section) return;
    openKey = key;
    remember();
    render();
    if (!how.quiet) { options.onEnter?.(section); if (!back.hidden) back.focus({ preventScroll: true }); }
  };
  const leave = () => {
    if (single || !openKey) return;
    const key = openKey;
    openKey = null;
    remember();
    render();
    options.onLeave?.();
    // Focus goes back to the row of the section just left.
    rows.querySelector<HTMLElement>(`[data-section-key="${key}"]`)?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !element.isConnected || back.hidden) return;
    const target = event.target as HTMLElement | null;
    const tag = String(target?.tagName ?? "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
    if (doc.querySelector(".vc-overlay")) return;
    event.preventDefault();
    leave();
  };
  doc.addEventListener("keydown", onKey);
  render();

  return {
    element,
    setOrder: (order) => {
      const next = orderSectionsByPage(sections, order.map((path) => pathText(path)));
      if (next.map((section) => section.key).join() === sections.map((section) => section.key).join()) return;
      sections = next;
      if (!current()) drawRows();
    },
    openFor: (text) => {
      const section = sectionOfPath(sections, text);
      if (!section) return false;
      if (section.key !== openKey) open(section.key, { quiet: true });
      return true;
    },
    open,
    leave,
    refresh: () => render(),
    setTitle: (next) => { title = next; render(); },
    current,
    destroy: () => doc.removeEventListener("keydown", onKey),
  };
};
