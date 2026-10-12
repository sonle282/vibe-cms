/**
 * P9: the preview — the real page in a same-origin <iframe> with the draft shown on it as it is typed
 * (src/admin/bridge.ts). The bridge is attached again after every page load (a link clicked in the preview).
 * M1, like the Mr Spa CMS: the page fills the canvas at the size of a Laptop (1280 × 800), a Tablet (768 × 1024) or
 * a Mobile (390 × 844), scaled down to fit inside the canvas's 24 px padding; the switch sits in the top bar and the
 * choice is remembered. No bar over the page: a page that cannot be shown says why in the middle of the canvas.
 */
import type { Field } from "../config/index.js";
import { attachBridge, type Bridge, type BridgeOptions, type PreviewOwner, type PreviewSelection } from "./bridge.js";
import { h, icon } from "./dom.js";
import type { Path } from "./value.js";

export const PREVIEW_DEVICES = {
  laptop: { label: "Laptop", icon: "monitor", width: 1280, height: 800 },
  tablet: { label: "Tablet", icon: "tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", icon: "phone", width: 390, height: 844 },
} as const;
export type PreviewDevice = keyof typeof PREVIEW_DEVICES;
const DEVICE_KEY = "vibe-cms:preview-device";
/** The canvas leaves 24 px on every side. */
const CANVAS_PADDING = 24;

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
  /** Where the chosen device is remembered (localStorage by default; null = nowhere). */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
};
export type Preview = {
  element: HTMLElement;
  /** Laptop / Tablet / Mobile, the switch the shell puts in the middle of the top bar. */
  devices: HTMLElement;
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
/** How much a device's page is scaled to fit the canvas (never enlarged). */
export const previewScale = (device: PreviewDevice, canvas: { width: number; height: number }) => {
  const size = PREVIEW_DEVICES[device];
  return Math.min(1, Math.max(1, canvas.width - CANVAS_PADDING * 2) / size.width, Math.max(1, canvas.height - CANVAS_PADDING * 2) / size.height);
};

export const createPreview = (options: PreviewOptions): Preview => {
  const { doc, win } = options;
  const storage = options.storage === undefined ? (() => { try { return win.localStorage; } catch { return null; } })() : options.storage;
  let owner = options.owner;
  let bridge: Bridge | undefined;
  const note = h(doc, "p", { class: "vc-preview-note", role: "status", "aria-live": "polite" });
  const frame = h(doc, "iframe", { class: "vc-preview-frame", title: `Preview: ${options.title}`, sandbox: "allow-same-origin allow-scripts", referrerpolicy: "same-origin" });
  const stage = h(doc, "div", { class: "vc-preview-stage" }, frame);
  const element = h(doc, "aside", { class: "vc-preview", "aria-label": "Preview" }, stage, note);

  let device: PreviewDevice = (() => { try { const saved = storage?.getItem(DEVICE_KEY); return saved && saved in PREVIEW_DEVICES ? (saved as PreviewDevice) : "laptop"; } catch { return "laptop"; } })();
  const fit = () => {
    const size = PREVIEW_DEVICES[device];
    const scale = previewScale(device, { width: element.clientWidth, height: element.clientHeight });
    element.dataset.device = device;
    stage.style.width = `${Math.round(size.width * scale)}px`;
    stage.style.height = `${Math.round(size.height * scale)}px`;
    frame.style.width = `${size.width}px`;
    frame.style.height = `${size.height}px`;
    frame.style.transform = scale === 1 ? "" : `scale(${scale})`;
    element.dataset.scale = scale.toFixed(3);
  };
  const buttons = (Object.keys(PREVIEW_DEVICES) as PreviewDevice[]).map((name) => h(doc, "button", {
    type: "button", class: "vc-segment-item", "data-device": name, "aria-pressed": String(name === device), "aria-label": `${PREVIEW_DEVICES[name].label} preview`, "data-tooltip": PREVIEW_DEVICES[name].label,
    onclick: () => {
      device = name;
      try { storage?.setItem(DEVICE_KEY, name); } catch { /* not remembered */ }
      for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.device === name));
      fit();
      win.requestAnimationFrame?.(() => bridge?.clearSelection());
    },
  }, icon(doc, PREVIEW_DEVICES[name].icon)));
  const devices = h(doc, "div", { class: "vc-segment vc-devices", role: "group", "aria-label": "Preview viewport" }, ...buttons);
  const ResizeObserverCtor = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(() => fit()) : undefined;
  observer?.observe(element);
  // Also when the window changes size and once the page has loaded (the canvas may settle after the first fit).
  const refit = () => fit();
  win.addEventListener("resize", refit);
  fit();

  const say = (state: "loading" | "ready" | "error" | "none", text: string) => { element.dataset.state = state; note.textContent = text; note.hidden = !text; };
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
      say("error", "This page can't be shown in the preview. It may be on another site, or refuse to be shown in a frame (the site must allow its own pages in a frame: X-Frame-Options SAMEORIGIN or frame-ancestors 'self').");
      return;
    }
    bridge = attachBridge({
      frame: page, doc, owner, value: options.value(), fields: options.fields, markdown: options.markdown, newItem: options.newItem, binds: options.binds,
      describe: options.describe, sectionOf: options.sectionOf, referenceLabel: options.referenceLabel, loadMarkdown: options.loadMarkdown,
      onSelect: (selection) => options.onSelect(selection),
    });
    // How many places on the page show what is edited (tests read it; the canvas says nothing).
    element.dataset.places = String(bridge.count());
    say("ready", "");
    fit();
  };
  frame.addEventListener("load", attach);

  // The page loads when the editor is shown.
  let started = false;
  const start = () => {
    if (started || !options.url) return;
    started = true;
    frame.setAttribute("src", framedUrl(options.url));
    fit();
  };
  if (options.url) say("loading", "");
  else {
    say("none", options.unavailable ?? "This content has no page to preview.");
    stage.hidden = true;
  }

  return {
    element, devices, frame, start,
    update: (value, path, nextOwner) => { if (nextOwner) owner = nextOwner; bridge?.update(value, path, nextOwner); updateStats(); },
    scrollTo: (path) => { bridge?.scrollTo(path); },
    bridge: () => bridge,
    destroy: () => { frame.removeEventListener("load", attach); win.removeEventListener("resize", refit); observer?.disconnect(); bridge?.detach(); bridge = undefined; },
  };

  // Measured while typing (tests read these): how long applying a change to the page took, at most.
  function updateStats() {
    const stats = bridge?.stats();
    if (!stats) return;
    element.dataset.updates = String(stats.updates);
    element.dataset.maxApplyMs = stats.maxMs.toFixed(2);
  }
};
