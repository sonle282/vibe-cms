/**
 * M9: the Mr Spa CMS's record editor (Product / Project) — the sections on the left (168 px, they follow the scroll),
 * the form in cards (at most 680 px), and on the right (300 px):
 *
 * - "On the website": the pill Live / Draft / Archived, the record's address when it is live, and what that means now
 *   ("The website shows this version.", "You have a saved draft. …", "Not on the website yet. Publish adds it." …);
 * - "Ready to publish" / "Before you publish · N to do": what must be done, each a button to its field;
 * - Duplicate <item> and Hide from website / Show on website again (when the collection allows them).
 *
 * Below 1240 px the sections are a row above; below 1024 px the right column goes under the form (CSS).
 */
import { clear, h } from "./dom.js";

export type RecordSection = { key: string; label: string };
export type WebState = { status: "live" | "draft" | "archived"; isNew: boolean; dirty: boolean; hasDraft: boolean; link?: { href: string; text: string } };
export type ReadyItem = { label: string; done: boolean; go: () => void };

const STATUS_WORDS = { live: "Live", draft: "Draft", archived: "Archived" } as const;

/** The Mr Spa CMS's words for where the record stands on the website. */
export const webNote = (state: WebState) => {
  if (state.isNew) return "Not on the website yet. Publish adds it.";
  if (state.status === "archived") return "Hidden from the website. It is kept here; show it again any time.";
  if (state.status === "draft") return "Not shown on the website yet.";
  if (state.dirty) return "You have unsaved changes. The website still shows the last published version.";
  if (state.hasDraft) return "You have a saved draft. The website still shows the last published version.";
  return "The website shows this version.";
};
/** "Ready to publish" / "Before you publish · 2 to do". */
export const readyTitle = (items: ReadonlyArray<{ done: boolean }>) => {
  const left = items.filter((item) => !item.done).length;
  return left ? `Before you publish · ${left} to do` : "Ready to publish";
};

/** The sections on the left: a click scrolls to the card; the current one follows the scroll. */
export const createRecordToc = (doc: Document, sections: RecordSection[], cardOf: (key: string) => HTMLElement | null, scroller: () => HTMLElement | null, noun: string) => {
  const buttons = sections.map((section) => h(doc, "button", { type: "button", class: "vc-record-toc-link", "data-section": section.key }, section.label));
  const mark = (key: string) => { for (const button of buttons) if (button.dataset.section === key) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current"); };
  buttons.forEach((button) => button.addEventListener("click", () => {
    const card = cardOf(button.dataset.section ?? "");
    if (!card) return;
    const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    mark(button.dataset.section ?? "");
  }));
  if (sections[0]) mark(sections[0].key);
  /** Mr Spa: the current section is the last whose top is within 96 px of the top; at the very bottom, the last one. */
  const spy = () => {
    const box = scroller();
    if (!box) return;
    const top = box.getBoundingClientRect().top + 96;
    let current = sections[0]?.key;
    for (const section of sections) { const card = cardOf(section.key); if (card && card.getBoundingClientRect().top <= top) current = section.key; }
    if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) current = sections.at(-1)?.key ?? current;
    if (current) mark(current);
  };
  const element = h(doc, "div", { class: "vc-record-toc-host" }, h(doc, "nav", { class: "vc-record-toc", "aria-label": `${noun} sections` }, h(doc, "ol", { class: "vc-record-toc-list" }, ...buttons.map((button) => h(doc, "li", {}, button)))));
  return { element, spy };
};

/** The right column. `update` redraws it from the editor's state (after every change, save and publish). */
export const createRecordSide = (doc: Document, options: {
  noun: string; nounTitle: string;
  duplicate?: () => void;
  visibility?: (archive: boolean) => void;
  /** M10: cards between "On the website" and "Ready to publish" (Post details, In Google). */
  extra?: Node[];
  /** M14: the site's plugin panels, after "Ready to publish". */
  panels?: Node[];
  /** M10: the column's name ("Post details"); "<Item> status" by default. */
  label?: string;
}) => {
  const pill = h(doc, "span", { class: "vc-content-status" });
  const link = h(doc, "a", { class: "vc-record-side-url", target: "_blank", rel: "noopener", hidden: true });
  const note = h(doc, "p", { class: "vc-record-side-note" });
  const web = h(doc, "section", { class: "vc-record-side-card", "aria-label": "On the website" }, h(doc, "div", { class: "vc-record-side-head" }, h(doc, "h2", {}, "On the website"), pill), link, note);
  const readyHeading = h(doc, "h2", {});
  const readyList = h(doc, "ul", { class: "vc-record-ready-list" });
  const readyNote = h(doc, "p", { class: "vc-record-side-note", hidden: true });
  const ready = h(doc, "section", { class: "vc-record-side-card", "aria-label": "Before you publish" }, readyHeading, readyList, readyNote);
  const duplicate = options.duplicate ? h(doc, "button", { type: "button", class: "vc-record-side-action", onclick: () => options.duplicate?.() }, `Duplicate ${options.noun}`) : null;
  let archived = false;
  const visibility = options.visibility ? h(doc, "button", { type: "button", class: "vc-record-side-action is-danger", onclick: () => options.visibility?.(!archived) }, "Hide from website") : null;
  const visibilityNote = options.visibility ? h(doc, "p", { class: "vc-record-side-note" }, `Hiding keeps the ${options.noun} in the CMS as Archived. You can show it again any time.`) : null;
  const actions = h(doc, "div", { class: "vc-record-side-actions" }, duplicate, visibility, visibilityNote);
  const element = h(doc, "aside", { class: "vc-record-side", "aria-label": options.label ?? `${options.nounTitle} status` }, web, ...(options.extra ?? []), ready, ...(options.panels ?? []), actions);

  const update = (state: WebState, items: ReadyItem[], blocked: string | undefined) => {
    pill.className = `vc-content-status${state.isNew || state.status === "draft" ? " is-draft" : state.status === "archived" ? " is-archived" : ""}`;
    pill.textContent = state.isNew ? "Draft" : STATUS_WORDS[state.status];
    const showLink = !state.isNew && state.status === "live" && state.link;
    link.hidden = !showLink;
    if (showLink && state.link) { link.setAttribute("href", state.link.href); link.textContent = state.link.text; }
    note.textContent = webNote(state);
    readyHeading.textContent = readyTitle(items);
    clear(readyList);
    for (const item of items) {
      readyList.append(h(doc, "li", {}, h(doc, "button", { type: "button", class: "vc-publish-check", ...(item.done ? { "data-done": "" } : {}), onclick: () => item.go() },
        h(doc, "span", { class: "vc-publish-check-mark", "aria-hidden": "true" }, item.done ? "✓" : ""), item.label, h(doc, "span", { class: "vc-sr-only" }, item.done ? " (done)" : " (needed)"))));
    }
    // Mr Spa: everything is done but Publish is still off — say why under the list.
    const allDone = items.every((item) => item.done);
    readyNote.hidden = !(allDone && blocked);
    readyNote.textContent = allDone && blocked ? blocked : "";
    archived = state.status === "archived";
    for (const node of [duplicate, visibility]) if (node) node.hidden = state.isNew;
    if (visibility) visibility.textContent = archived ? "Show on website again" : "Hide from website";
    if (visibilityNote) visibilityNote.hidden = state.isNew || archived;
  };
  return { element, update };
};
