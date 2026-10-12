/**
 * M1: the CMS's one tooltip, as in the Mr Spa CMS (its tooltip.ts). Hovering a control shows its tooltip after 400 ms
 * and leaving hides it at once (moving across several controls shows nothing, so nothing flickers); keyboard focus
 * shows it at once; Esc, a click, scrolling or leaving hides it. It serves every `[data-tooltip]` and every button
 * with a `title` (the title moves into the tooltip, so the browser's own never shows a second copy).
 */

export const TOOLTIP_DELAY_MS = 400;

type Timer = { set: (run: () => void, ms: number) => number; clear: (id: number) => void };

/** The timing rules, without the DOM (tests drive it with fake timers). */
export const createTooltipScheduler = <T>({ show, hide, timer, delay = TOOLTIP_DELAY_MS }: { show: (target: T) => void; hide: () => void; timer: Timer; delay?: number }) => {
  let pending: number | null = null;
  let pendingFor: T | null = null;
  let shown: T | null = null;
  const cancel = () => { if (pending !== null) timer.clear(pending); pending = null; pendingFor = null; };
  const close = () => { cancel(); if (shown !== null) { shown = null; hide(); } };
  return {
    /** Pointer enters a control: show after the delay (a tooltip already open for another control closes now). */
    enter: (target: T) => { if (shown === target || pendingFor === target) return; close(); pendingFor = target; pending = timer.set(() => { pending = null; pendingFor = null; shown = target; show(target); }, delay); },
    /** Pointer leaves it: hide at once, and forget a tooltip that was about to show. */
    leave: (target: T) => { if (shown === target || pending !== null) close(); },
    /** Keyboard focus: show at once. */
    focus: (target: T) => { cancel(); if (shown !== target) { shown = target; show(target); } },
    close,
    shown: () => shown,
    isPending: () => pending !== null,
  };
};

/** The name a screen reader reads without `title`: aria-labelledby, aria-label, or the element's own text. */
export const accessibleName = (element: Element) => {
  const by = element.getAttribute("aria-labelledby");
  if (by) { const doc = element.ownerDocument; const text = by.split(/\s+/).map((id) => doc?.getElementById(id)?.textContent ?? "").join(" ").trim(); if (text) return text; }
  return (element.getAttribute("aria-label") ?? "").trim() || (element.textContent ?? "").replace(/\s+/g, " ").trim();
};

/** The text of an element's tooltip, adopting a button's `title` (moved into data-tooltip, so only one tooltip shows). */
export const tooltipText = (element: Element) => {
  const title = element.getAttribute("title");
  if (element.tagName === "BUTTON" && title) {
    if (!accessibleName(element)) element.setAttribute("aria-label", title);
    element.setAttribute("data-tooltip", title);
    element.removeAttribute("title");
  }
  return (element.getAttribute("data-tooltip") ?? "").trim();
};

const SELECTOR = "[data-tooltip], button[title]";

/** The control whose tooltip applies to this event target, or null (an open ⋯ panel shows its labels as text already). */
export const tooltipTarget = (target: EventTarget | null) => {
  const element = target && typeof (target as Element).closest === "function" ? (target as Element).closest(SELECTOR) : null;
  if (!element || element.closest(".vc-top-more.vc-open")) return null;
  return element;
};

export const installTooltips = (doc: Document) => {
  const win = doc.defaultView;
  if (!win || doc.querySelector(".vc-tooltip")) return null;
  const tip = doc.createElement("div");
  tip.className = "vc-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.id = "vc-tooltip";
  tip.hidden = true;
  doc.body.appendChild(tip);
  const place = (target: Element) => {
    const rect = target.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const gap = 8;
    const edge = 8;
    let top: number;
    let left: number;
    if (target.closest(".vc-rail")) { left = rect.right + gap; top = rect.top + rect.height / 2 - box.height / 2; }
    else {
      top = rect.bottom + gap;
      left = rect.right - box.width;
      if (top + box.height > win.innerHeight - edge) top = rect.top - gap - box.height;
    }
    tip.style.left = `${Math.round(Math.min(Math.max(edge, left), win.innerWidth - box.width - edge))}px`;
    tip.style.top = `${Math.round(Math.min(Math.max(edge, top), win.innerHeight - box.height - edge))}px`;
  };
  const scheduler = createTooltipScheduler<Element>({
    timer: { set: (run, ms) => win.setTimeout(run, ms), clear: (id) => win.clearTimeout(id) },
    show: (target) => { const text = tooltipText(target); if (!text || !target.isConnected) { scheduler.close(); return; } tip.textContent = text; tip.hidden = false; place(target); },
    hide: () => { tip.hidden = true; },
  });
  doc.addEventListener("pointerover", (event) => { const target = tooltipTarget(event.target); if (target) { tooltipText(target); scheduler.enter(target); } });
  doc.addEventListener("pointerout", (event) => {
    const target = tooltipTarget(event.target);
    if (!target) return;
    const next = event.relatedTarget as Node | null;
    if (next && target.contains(next)) return;
    scheduler.leave(target);
  });
  doc.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event.target);
    if (!target) return;
    let keyboard = true;
    try { keyboard = target.matches(":focus-visible"); } catch { /* older browsers: treat as keyboard */ }
    if (keyboard) scheduler.focus(target);
  });
  doc.addEventListener("focusout", () => scheduler.close());
  doc.addEventListener("keydown", (event) => { if (event.key === "Escape") scheduler.close(); });
  doc.addEventListener("pointerdown", () => scheduler.close(), true);
  win.addEventListener("scroll", () => scheduler.close(), { capture: true, passive: true });
  win.addEventListener("resize", () => scheduler.close());
  return scheduler;
};
