/**
 * U3: the toast of the Mr Spa CMS (docs/design-004 · 23) — bottom centre, dark, 4 s; an icon for its tone (info,
 * success, error) and at most one action ("Undo", "Try again"). A new message replaces the one shown.
 */
import { clear, h } from "./dom.js";

export type Tone = "info" | "success" | "error";
export type ToastAction = { label: string; run: () => void };

export const createToast = (doc: Document, ms = 4000) => {
  const element = h(doc, "div", { class: "vc-toast", role: "status", "aria-live": "polite", "aria-atomic": "true", hidden: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { element.hidden = true; };
  const say = (text: string, tone: Tone = "info", action?: ToastAction) => {
    clear(element);
    element.dataset.tone = tone;
    // The tone's icon is drawn by CSS (data-tone), so the toast reads as just its words.
    element.append(h(doc, "span", { class: "vc-toast-text" }, text));
    if (action) element.append(h(doc, "button", { type: "button", class: "vc-toast-action", onclick: () => { hide(); action.run(); } }, action.label));
    element.hidden = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, action ? ms + 2000 : ms);
  };
  return { element, say, hide };
};
