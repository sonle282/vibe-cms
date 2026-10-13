/**
 * M6: "Review changes" of the Mr Spa CMS (its cms-change-summary.ts) — the changes of a record grouped by section,
 * "Changed: / Added: / Removed: {label}", before → after, the changed words marked (<mark>), images as 40 × 28 thumbnails.
 */
import type { Change } from "./changes.js";
import { h } from "./dom.js";

/** Texts up to this length are shown whole; longer ones keep CONTEXT characters around the change. */
export const SHORT_TEXT = 140;
export const CONTEXT = 48;
export const CHANGED_MAX = 240;

export type MarkedText = { prefix: string; changed: string; suffix: string };

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/**
 * The one changed span of two texts (the Mr Spa CMS's markTextChange — not a word diff): the common start and end are
 * kept, the cut points are widened to whole words, a long text keeps 48 characters of context on each side, and the
 * changed part is at most 240 characters.
 */
export const markTextChange = (before: string, after: string): { before: MarkedText; after: MarkedText } => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  // Whole words: a cut inside a word (on either text) moves back to the word's edge — the common parts only shrink.
  const inWord = (text: string, at: number) => at > 0 && at < text.length && !isSpace(text[at - 1]) && !isSpace(text[at]);
  while (start > 0 && (inWord(before, start) || inWord(after, start))) start -= 1;
  while (end > 0 && (inWord(before, before.length - end) || inWord(after, after.length - end))) end -= 1;
  const side = (text: string): MarkedText => {
    const stop = text.length - end;
    let prefix = text.slice(0, start);
    let changed = text.slice(start, stop);
    let suffix = text.slice(stop);
    if (text.length > SHORT_TEXT) {
      if (prefix.length > CONTEXT) { const cut = prefix.slice(-CONTEXT); const space = cut.search(/\s/); prefix = `…${space >= 0 ? cut.slice(space + 1) : cut}`; }
      if (suffix.length > CONTEXT) { const cut = suffix.slice(0, CONTEXT); const space = cut.lastIndexOf(" "); suffix = `${space > 0 ? cut.slice(0, space) : cut}…`; }
    }
    if (changed.length > CHANGED_MAX) changed = `${changed.slice(0, CHANGED_MAX - 1)}…`;
    return { prefix, changed, suffix };
  };
  return { before: side(before), after: side(after) };
};

const IMAGE = /^\/(?!\/)[^?#]+\.(?:webp|avif|png|jpe?g|gif|svg)(?:[?#].*)?$/i;
/** A value that is an image of the site (shown with its thumbnail and its file name). */
export const isImageValue = (value: string | undefined) => Boolean(value && IMAGE.test(value.trim()));
const fileName = (src: string) => decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() || src);

export type ReviewGroup = { label: string; changes: Change[] };

/** The words of a change's row: "Changed: Banner › Heading". */
export const reviewVerb = (change: Change) => (change.kind === "added" || change.kind === "created" ? "Added" : change.kind === "removed" ? "Removed" : "Changed");

/** The body of "Review changes" (also "Changes in this draft"): one section per group, one row per change. */
export const reviewSummary = (doc: Document, groups: ReviewGroup[]) => {
  const value = (text: string | undefined, which: "before" | "after", marked?: MarkedText) => {
    const shown = text ?? "";
    const image = isImageValue(shown);
    const words = image ? fileName(shown) : shown || "Empty";
    return h(doc, "span", { class: `vc-review-value is-${which}` },
      image ? h(doc, "img", { class: "vc-review-thumb", src: shown.trim(), alt: "", loading: "lazy" }) : null,
      h(doc, "span", { class: "vc-review-text" }, ...(marked && marked.changed
        ? [marked.prefix, h(doc, "mark", { class: "vc-review-mark" }, marked.changed), marked.suffix]
        : [words])));
  };
  const row = (change: Change) => {
    const verb = reviewVerb(change);
    const label = change.kind === "moved" ? `${change.label} — order` : change.label;
    const before = change.before ?? ""; const after = change.after ?? "";
    const markable = change.kind === "changed" && before && after && before !== after && !isImageValue(before) && !isImageValue(after);
    const marks = markable ? markTextChange(before, after) : undefined;
    const values = verb === "Changed" && change.kind !== "moved"
      ? [value(before, "before", marks?.before), h(doc, "span", { class: "vc-review-arrow", "aria-label": "changed to" }, "→"), value(after, "after", marks?.after)]
      : verb === "Removed" ? [value(before, "before")] : [value(after, "after")];
    return h(doc, "li", { "data-path": change.path }, h(doc, "strong", {}, `${verb}: ${label}`, change.locked ? " (admin only)" : ""), h(doc, "span", { class: "vc-review-values" }, ...values));
  };
  const shown = groups.filter((group) => group.changes.length);
  return h(doc, "div", { class: "vc-review-summary" },
    ...(shown.length ? shown.map((group) => h(doc, "section", { class: "vc-review-group" }, h(doc, "h3", {}, group.label), h(doc, "ul", {}, group.changes.map(row))))
      : [h(doc, "p", { class: "vc-review-empty" }, "There are no changes to publish.")]));
};
