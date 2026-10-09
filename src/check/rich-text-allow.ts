/**
 * P8c / P8d: the rich-text allow-list, shared by the server sanitizer (src/check/rich-text.ts, hast) and the visual
 * editor's cleaner in the browser (src/admin/clean.ts, DOM) so the two can never disagree. Plain data, no imports.
 */
/** Tags kept (everything else is dropped, its text kept). */
export const RICH_TEXT_TAGS = ["a", "blockquote", "br", "code", "div", "em", "figcaption", "figure", "h2", "h3", "hr", "img", "li", "ol", "p", "pre", "strong", "u", "ul"];
/** Attributes kept, by tag ("*" = every tag). HTML names (class, not className). */
export const RICH_TEXT_ATTRIBUTES: Record<string, string[]> = {
  "*": ["class", "title"],
  a: ["href", "rel", "target"],
  img: ["alt", "height", "loading", "src", "width"],
};
/** Allowed URL schemes (relative addresses are always allowed). */
export const RICH_TEXT_PROTOCOLS: Record<"href" | "src", string[]> = { href: ["http", "https", "mailto", "tel"], src: ["http", "https"] };
/** Removed together with their content. */
export const RICH_TEXT_STRIP = ["script", "style", "noscript", "iframe", "object", "embed", "form"];
