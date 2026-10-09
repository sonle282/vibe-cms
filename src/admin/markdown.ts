/**
 * P8d: Markdown bodies in the visual editor. Markdown → HTML to show a post in the editor, and the editor's HTML →
 * Markdown when it changes, with the unified libraries (micromark / mdast / hast, GFM: tables, strikethrough, task
 * lists). Loaded only when a Markdown body is opened (dynamic import: the rest of the admin stays small).
 *
 * The Markdown written back follows the post's own habits (list marker, * or _ for italic, ** or __ for bold, the
 * thematic break) so an edit moves as few characters as possible. An image with a size is written as HTML
 * (`<img src alt width>`), because Markdown has no size; Astro renders HTML inside Markdown as is.
 *
 * `canEditVisually` says whether a post survives the round trip (Markdown → HTML → Markdown → HTML gives the same
 * HTML). When it does not (raw HTML blocks, footnotes, things the editor cannot show), the editor opens the Markdown
 * itself instead of silently re-writing the post.
 */
import { fromDom } from "hast-util-from-dom";
import { defaultHandlers, toMdast, type Handle } from "hast-util-to-mdast";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown, type Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

export type MarkdownStyle = Pick<ToMarkdownOptions, "bullet" | "emphasis" | "strong" | "rule" | "fence" | "listItemIndent"> & { finalNewline: boolean };

/** The writing habits of a post (defaults: "-", "*", "**", "---", ``` fences). */
export const markdownStyle = (source: string): MarkdownStyle => {
  // Code, inline code and thematic breaks ("***") say nothing about emphasis.
  const outsideCode = source.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  const prose = outsideCode.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "");
  const bullet = /^[ \t]{0,3}([-*+])[ \t]+\S/m.exec(outsideCode)?.[1] as "-" | "*" | "+" | undefined;
  const rule = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/m.exec(outsideCode)?.[1] as "-" | "*" | "_" | undefined;
  return {
    bullet: bullet ?? "-",
    // Bold first: "__x__" also looks like "_x_".
    strong: /(^|[^\w_])__\S/.test(prose) && !/\*\*\S/.test(prose) ? "_" : "*",
    emphasis: /(^|[^\w_])_[^_\s][^_\n]*_(?!\w)/.test(prose.replace(/__/g, "")) && !/(^|[^*\w])\*[^*\s][^*\n]*\*(?!\*)/.test(prose) ? "_" : "*",
    rule: rule === bullet ? (bullet === "-" ? "*" : "-") : rule ?? "-",
    fence: /^~~~/m.test(source) && !/^```/m.test(source) ? "~" : "`",
    listItemIndent: "one",
    finalNewline: source === "" || source.endsWith("\n"),
  };
};

/** Markdown → HTML (raw HTML inside the Markdown is kept as written; the editor cleans it before showing it). */
export const markdownToHtml = (markdown: string) => {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  return toHtml(toHast(tree, { allowDangerousHtml: true }), { allowDangerousHtml: true });
};

const attributes = ["src", "alt", "width", "height", "title"] as const;
/** An image with a size stays HTML (Markdown has no size). */
const img: Handle = (state, node) => {
  const props = node.properties ?? {};
  if (props.width === undefined && props.height === undefined) return defaultHandlers.img(state, node);
  const kept = Object.fromEntries(attributes.filter((name) => props[name] !== undefined && props[name] !== "").map((name) => [name, props[name]]));
  const value = toHtml({ type: "element", tagName: "img", properties: { ...kept, alt: props.alt ?? "" }, children: [] });
  const html = { type: "html" as const, value };
  state.patch(node, html);
  return html;
};

/** The editor's content (a DOM element) → Markdown, in the post's style. */
export const htmlToMarkdown = (root: Node, style: MarkdownStyle) => {
  const hast = fromDom(root);
  const mdast = toMdast(hast, { handlers: { img } });
  const { finalNewline, ...options } = style;
  const out = toMarkdown(mdast, { ...options, extensions: [gfmToMarkdown()] });
  if (!out.trim()) return "";
  return finalNewline ? out : out.replace(/\n+$/, "");
};

const normalHtml = (html: string) => html.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

/**
 * Can this post be edited in the visual editor without changing what it shows? `parse` turns HTML into a DOM element
 * in an inert document (the browser's DOMParser / createHTMLDocument; happy-dom in tests).
 */
export const canEditVisually = (markdown: string, parse: (html: string) => Node) => {
  try {
    const html = markdownToHtml(markdown);
    const again = markdownToHtml(htmlToMarkdown(parse(html), markdownStyle(markdown)));
    return normalHtml(again) === normalHtml(html);
  } catch {
    return false;
  }
};
