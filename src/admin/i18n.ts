/**
 * F5: the admin in the site's language (site.locale). The screens are written in English; a dictionary turns the
 * words on screen into the site's language as they appear — text, button names, tooltips, placeholders — without
 * touching what people type or the site's own content (inputs, the rich text editor, anything inside
 * [data-no-translate]). A string the dictionary does not know stays in English.
 */

/** Exact strings, then patterns tried in order (anchored; `$1`… are the captured parts, themselves translated). */
export type Dictionary = { exact: Record<string, string>; patterns: Array<[RegExp, string]> };

const ATTRIBUTES = ["aria-label", "data-tooltip", "placeholder", "title"];
// What people typed and the site's own content: never translated (record names, values in the review, list cells).
const SKIP = [
  "textarea", "input", "select option", "[contenteditable]", "[data-no-translate]", ".vc-rich-editor", ".ProseMirror", "script", "style",
  ".vc-change-what ins", ".vc-change-what del", ".vc-review-values", ".vc-list-name-words", ".vc-list-name-detail", ".vc-list-secondary", ".vc-draft-label",
].join(", ");

/** One string in the dictionary's language (unknown → unchanged). Spaces around it are kept. */
export const translate = (dictionary: Dictionary, text: string, depth = 0): string => {
  const core = text.trim();
  if (!core || !/[A-Za-z]/.test(core)) return text;
  const lead = text.slice(0, text.indexOf(core));
  const tail = text.slice(lead.length + core.length);
  const exact = dictionary.exact[core];
  if (exact !== undefined) return lead + exact + tail;
  if (depth < 3) {
    for (const [pattern, replacement] of dictionary.patterns) {
      const match = pattern.exec(core);
      if (!match) continue;
      const out = replacement.replace(/\$(\d)/g, (_, index: string) => translate(dictionary, match[Number(index)] ?? "", depth + 1));
      return lead + out + tail;
    }
  }
  return text;
};

const skipped = (element: Element | null) => Boolean(element?.closest(SKIP));

/** Translate everything under `root` once. */
export const localize = (dictionary: Dictionary, root: Node) => {
  const doc = root.ownerDocument ?? (root as Document);
  const element = root.nodeType === 1 ? (root as Element) : root.parentElement;
  if (root.nodeType === 3) {
    if (!skipped(root.parentElement)) { const next = translate(dictionary, root.nodeValue ?? ""); if (next !== root.nodeValue) root.nodeValue = next; }
    return;
  }
  if (!element || skipped(element)) return;
  const walker = doc.createTreeWalker(root, 1 | 4);
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (skipped(node.parentElement)) continue;
      const next = translate(dictionary, node.nodeValue ?? "");
      if (next !== node.nodeValue) node.nodeValue = next;
    } else if (node.nodeType === 1) {
      const el = node as Element;
      if (skipped(el)) continue;
      for (const name of ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value) { const next = translate(dictionary, value); if (next !== value) el.setAttribute(name, next); }
      }
    }
  }
};

/** Keep `root` (and dialogs / toasts added to the body) translated as screens change. Returns stop(). */
export const watchLocale = (dictionary: Dictionary, doc: Document, root: Element) => {
  // The body holds the dialogs and toasts; when it also holds the admin, watching it is enough.
  const targets = doc.body && doc.body.contains(root) ? [doc.body] : [root, ...(doc.body ? [doc.body] : [])];
  for (const target of targets) localize(dictionary, target);
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.type === "childList") for (const node of record.addedNodes) localize(dictionary, node);
      else if (record.type === "characterData") localize(dictionary, record.target);
      else if (record.type === "attributes" && record.target.nodeType === 1 && !skipped(record.target as Element)) {
        const el = record.target as Element;
        const value = el.getAttribute(record.attributeName!);
        if (value) { const next = translate(dictionary, value); if (next !== value) el.setAttribute(record.attributeName!, next); }
      }
    }
  });
  for (const target of targets) observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  return () => observer.disconnect();
};
