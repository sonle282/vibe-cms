/**
 * P7: a tiny element builder for the admin (no framework). Every function takes the Document, so tests run the same
 * code on a fake DOM (happy-dom) and the browser on the real one. Text always goes in as text, never as HTML.
 */

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
export type Child = Node | string | null | undefined | false;

export const h = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...children: Array<Child | Child[]>): HTMLElementTagNameMap[K] => {
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value as EventListener);
    else if (name === "class") element.className = String(value);
    else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  append(element, ...children);
  return element;
};

export const append = (parent: Node, ...children: Array<Child | Child[]>) => {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? (parent.ownerDocument ?? (parent as Document)).createTextNode(child) : child);
  }
  return parent;
};

export const clear = (element: Element) => { while (element.firstChild) element.removeChild(element.firstChild); return element; };

const SVG = "http://www.w3.org/2000/svg";
/** Small stroke icons (24 × 24 grid), drawn with paths only. */
const ICONS: Record<string, string[]> = {
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"],
  up: ["M12 19V5", "M5 12l7-7 7 7"],
  down: ["M12 5v14", "M19 12l-7 7-7-7"],
  remove: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
};
export const icon = (doc: Document, name: keyof typeof ICONS | string) => {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `vc-icon vc-icon-${name}`);
  for (const d of ICONS[name] ?? []) {
    const path = doc.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
};

let counter = 0;
/** A unique element id for label / aria wiring. */
export const uid = (prefix = "vc") => `${prefix}-${(counter += 1).toString(36)}`;
