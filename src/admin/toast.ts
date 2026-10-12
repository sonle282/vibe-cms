/**
 * U3 / M1: the toast of the Mr Spa CMS — a short message at the bottom centre, dark, for 4 seconds, with at most one
 * action ("Undo"); no icon. A new message replaces the one shown. Screen readers hear it (role="status"). Like the
 * Mr Spa CMS it is for image and media actions; saving and publishing speak through the top bar's save state.
 */
import { clear, h } from "./dom.js";

/** Kept for callers; the toast looks the same for every tone (as in the Mr Spa CMS). */
export type Tone = "info" | "success" | "error";
export type ToastAction = { label: string; run: () => void };

export const createToast = (doc: Document, ms = 4000) => {
  const element = h(doc, "div", { class: "vc-toast", role: "status", "aria-live": "polite", "aria-atomic": "true", hidden: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { if (timer) clearTimeout(timer); timer = undefined; element.hidden = true; };
  const say = (text: string, tone: Tone = "info", action?: ToastAction) => {
    clear(element);
    element.dataset.tone = tone;
    element.append(h(doc, "p", { class: "vc-toast-text" }, text));
    if (action) element.append(h(doc, "button", { type: "button", class: "vc-toast-action", onclick: () => { hide(); action.run(); } }, action.label));
    element.hidden = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, ms);
  };
  return { element, say, hide };
};
