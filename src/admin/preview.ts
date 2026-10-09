/**
 * P9: the preview pane next to the form — the real page in a same-origin <iframe> with the draft shown on it as it is
 * typed (src/admin/bridge.ts). The bridge is attached again after every page load (a link clicked in the preview).
 * Desktop / phone width, reload, and a plain status line: how many places on the page show what is being edited, or
 * why the page cannot be shown (another site, a page that refuses to be framed, a new record without its own page yet).
 */
import type { Field } from "../config/index.js";
import { attachBridge, type Bridge, type BridgeOptions, type PreviewOwner, type PreviewSelection } from "./bridge.js";
import { h } from "./dom.js";
import type { Path } from "./value.js";

export type PreviewOptions = {
  doc: Document;
  win: Window;
  /** The page to show (a site path), or undefined with `unavailable` saying why. */
  url: string | undefined;
  unavailable?: string;
  title: string;
  owner: PreviewOwner;
  value: () => Record<string, unknown>;
  fields: Record<string, Field>;
  markdown?: string[];
  newItem?: BridgeOptions["newItem"];
  binds?: BridgeOptions["binds"];
  describe: BridgeOptions["describe"];
  sectionOf?: BridgeOptions["sectionOf"];
  referenceLabel?: BridgeOptions["referenceLabel"];
  loadMarkdown?: BridgeOptions["loadMarkdown"];
  onSelect: (selection: PreviewSelection) => void;
};
export type Preview = {
  element: HTMLElement;
  /** Load the page (once). */
  start: () => void;
  frame: HTMLIFrameElement;
  update: (value: Record<string, unknown>, path: Path, owner?: PreviewOwner) => void;
  scrollTo: (path: Path) => void;
  bridge: () => Bridge | undefined;
  destroy: () => void;
};

/** "/blog/{slug}/" with the record's values (each encoded); undefined when a value is missing. */
export const previewUrl = (pattern: string | undefined, value: Record<string, unknown>) => {
  if (!pattern) return undefined;
  let missing = false;
  const path = pattern.replace(/\{([^}]+)\}/g, (_match, key: string) => { const text = value[key]; if (typeof text !== "string" || !text) { missing = true; return ""; } return encodeURIComponent(text); });
  return missing ? undefined : path;
};
/** The address the iframe opens: the page plus cmsPreview=1 (a site's own scripts may skip analytics on it). */
export const framedUrl = (path: string) => `${path}${path.includes("?") ? "&" : "?"}cmsPreview=1`;

export const createPreview = (options: PreviewOptions): Preview => {
  const { doc, win } = options;
  let owner = options.owner;
  let bridge: Bridge | undefined;
  const status = h(doc, "p", { class: "vc-preview-status", role: "status", "aria-live": "polite" });
  const frame = h(doc, "iframe", { class: "vc-preview-frame", title: `Preview: ${options.title}`, sandbox: "allow-same-origin allow-scripts", referrerpolicy: "same-origin" });
  const stage = h(doc, "div", { class: "vc-preview-stage", "data-device": "desktop" }, frame);
  const device = (name: "desktop" | "phone", label: string) => h(doc, "button", { type: "button", class: "vc-tool", "data-device": name, "aria-pressed": String(name === "desktop"), onclick: () => {
    stage.dataset.device = name;
    for (const button of devices) button.setAttribute("aria-pressed", String(button.dataset.device === name));
    win.requestAnimationFrame?.(() => bridge?.clearSelection());
  } }, label);
  const devices = [device("desktop", "Desktop"), device("phone", "Phone")];
  const reload = h(doc, "button", { type: "button", class: "vc-tool", onclick: () => { status.textContent = "Loading the page…"; try { frame.contentWindow?.location.reload(); } catch { if (options.url) frame.setAttribute("src", framedUrl(options.url)); } } }, "Reload");
  const live = options.url ? h(doc, "a", { class: "vc-tool vc-preview-open", href: options.url, target: "_blank", rel: "noopener" }, "Open live page") : null;
  const element = h(doc, "aside", { class: "vc-preview", "aria-label": "Preview" },
    h(doc, "div", { class: "vc-preview-bar", role: "toolbar", "aria-label": "Preview" },
      h(doc, "span", { class: "vc-preview-title" }, "Preview"), ...devices, reload, live ?? h(doc, "span")),
    status, stage);

  const attach = () => {
    bridge?.detach();
    bridge = undefined;
    let page: Window | null = null;
    try {
      page = frame.contentWindow;
      // Reading location throws for another origin; an error page (refused to be framed) is about:blank-like.
      if (!page || page.location.origin !== win.location.origin || !page.document.body) page = null;
    } catch { page = null; }
    if (!page) {
      status.textContent = "This page can't be shown in the preview. It may be on another site, or refuse to be shown in a frame (the site must allow its own pages in a frame: X-Frame-Options SAMEORIGIN or frame-ancestors 'self').";
      element.dataset.state = "error";
      return;
    }
    bridge = attachBridge({
      frame: page, doc, owner, value: options.value(), fields: options.fields, markdown: options.markdown, newItem: options.newItem, binds: options.binds,
      describe: options.describe, sectionOf: options.sectionOf, referenceLabel: options.referenceLabel, loadMarkdown: options.loadMarkdown,
      onSelect: (selection) => options.onSelect(selection),
    });
    const count = bridge.count();
    element.dataset.state = "ready";
    status.textContent = count
      ? `Showing your changes on the page (${count === 1 ? "1 place" : `${count} places`}). Click something on the page to edit it.`
      : "Nothing on this page shows what you are editing. Your changes still save; open the page where this content appears.";
  };
  frame.addEventListener("load", attach);

  // The page loads the first time the pane is shown (not for people who keep the preview closed).
  let started = false;
  const start = () => {
    if (started || !options.url) return;
    started = true;
    frame.setAttribute("src", framedUrl(options.url));
  };
  if (options.url) {
    status.textContent = "Loading the page…";
    element.dataset.state = "loading";
  } else {
    status.textContent = options.unavailable ?? "This content has no page to preview.";
    element.dataset.state = "none";
    stage.hidden = true;
  }

  return {
    element, frame, start,
    update: (value, path, nextOwner) => { if (nextOwner) owner = nextOwner; bridge?.update(value, path, nextOwner); updateStats(); },
    scrollTo: (path) => { bridge?.scrollTo(path); },
    bridge: () => bridge,
    destroy: () => { frame.removeEventListener("load", attach); bridge?.detach(); bridge = undefined; },
  };

  // Measured while typing (tests read these): how long applying a change to the page took, at most.
  function updateStats() {
    const stats = bridge?.stats();
    if (!stats) return;
    element.dataset.updates = String(stats.updates);
    element.dataset.maxApplyMs = stats.maxMs.toFixed(2);
  }
};
