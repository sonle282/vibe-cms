/**
 * U3: the dialog of the Mr Spa CMS (docs/design-004 · 03, 23) — instead of the browser's confirm(). A centred card
 * (radius 16) over a dimmed page; Escape, Cancel or a click outside closes it and changes nothing; Tab stays inside;
 * focus goes back to what opened it. One primary button; a destructive one is red.
 */
import { h, type Child } from "./dom.js";

export type DialogButton = { label: string; kind?: "primary" | "danger" | "plain"; value: string };
export type DialogOptions = {
  title: string;
  text?: string;
  /** More content under the text (a list of changes…). */
  body?: Child[];
  buttons: DialogButton[];
  /** The value when it is closed without a button (Escape, outside). */
  dismiss?: string;
  /** Called on a button before closing; returning false keeps the dialog open (e.g. while publishing). */
  onButton?: (value: string, dialog: OpenDialog) => boolean | void | Promise<boolean | void>;
};
export type OpenDialog = { element: HTMLElement; body: HTMLElement; close: (value: string) => void; done: Promise<string>; busy: (on: boolean) => void };

let count = 0;
export const openDialog = (doc: Document, options: DialogOptions): OpenDialog => {
  const opener = doc.activeElement as HTMLElement | null;
  const id = `vc-dialog-${(count += 1)}`;
  const dismiss = options.dismiss ?? "cancel";
  let resolve: (value: string) => void = () => {};
  const done = new Promise<string>((ok) => { resolve = ok; });
  const body = h(doc, "div", { class: "vc-dialog-body" }, ...(options.body ?? []));
  const buttons = options.buttons.map((button) => h(doc, "button", { type: "button", class: `vc-button${button.kind === "primary" ? " vc-primary" : button.kind === "danger" ? " vc-danger-fill" : ""}`, "data-value": button.value }, button.label));
  const card = h(doc, "div", { class: "vc-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": `${id}-title`, ...(options.text ? { "aria-describedby": `${id}-text` } : {}) },
    h(doc, "h2", { class: "vc-dialog-title", id: `${id}-title` }, options.title),
    options.text ? h(doc, "p", { class: "vc-dialog-text", id: `${id}-text` }, options.text) : null,
    body,
    h(doc, "div", { class: "vc-dialog-actions" }, ...buttons));
  const overlay = h(doc, "div", { class: "vc-overlay vc-overlay-modal" }, card);
  let closed = false;
  let busy = false;
  const close = (value: string) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("keydown", onKey, true);
    overlay.remove();
    opener?.focus?.();
    resolve(value);
  };
  const dialog: OpenDialog = { element: card, body, close, done, busy: (on) => { busy = on; for (const button of buttons) button.disabled = on; } };
  const choose = async (value: string) => {
    if (busy) return;
    const keep = await options.onButton?.(value, dialog);
    if (keep === false) return;
    close(value);
  };
  for (const button of buttons) button.addEventListener("click", () => { void choose(button.dataset.value ?? ""); });
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay && !busy) close(dismiss); });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) close(dismiss); return; }
    if (event.key !== "Tab") return;
    const focusable = [...card.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  doc.addEventListener("keydown", onKey, true);
  doc.body.append(overlay);
  // Focus the safe choice first: the plain button (Cancel / Keep editing), else the first one.
  (buttons.find((_, index) => (options.buttons[index].kind ?? "plain") === "plain") ?? buttons[0])?.focus();
  return dialog;
};

export type ConfirmOptions = { confirm?: string; cancel?: string; danger?: boolean };
/** "Title\n\nWhat happens." → a dialog; resolves true for the confirm button. */
export const confirmDialog = (doc: Document, message: string, options: ConfirmOptions = {}) => {
  const [title, ...rest] = message.split("\n\n");
  return openDialog(doc, {
    title, text: rest.join("\n\n") || undefined,
    buttons: [{ label: options.cancel ?? "Cancel", value: "cancel" }, { label: options.confirm ?? "OK", kind: options.danger ? "danger" : "primary", value: "ok" }],
  }).done.then((value) => value === "ok");
};
