/**
 * M4: the Link field on screen, as in the Mr Spa CMS (its link-control.ts) — Page · Web address · Phone · Email, the
 * value field of that kind ("Find a page" above the page list when there are more than 8), one 12 px line
 * "Opens: <where it really goes>", and a plain-words error under it.
 *
 * `value` is the saved href; `onChange` runs only when that href changes. A value that cannot be saved (a wrong web
 * address, a phone number without its area code…) is never written: the field says why, marks itself
 * `data-link-invalid="true"` (Save waits until it is fixed — see invalidLinks) and the content keeps the last good
 * link. Switching kind keeps what was typed in each kind, and Page ↔ Web address carry the same address, so going back
 * gives the exact old href ("No changes").
 */
import { formatPhone, LINK_KINDS, linkOpensText, linkProblem, parseHref, phoneProblem, toHref, type LinkKind, type LinkPage } from "../check/link.js";
import { h } from "./dom.js";

export type LinkControlOptions = {
  doc: Document;
  id: string;
  href: string;
  /** The site's pages: [path, name]. */
  pages: readonly LinkPage[];
  /** The site's host, for "Opens: mysalon.example/about". */
  host: string;
  /** site.phone.country. */
  country?: string;
  /** The field's name for screen readers. */
  label: string;
  /** Not required: an empty link is allowed ("No link"). */
  required?: boolean;
  disabled?: boolean;
  onChange: (href: string) => void;
};

/** `inputs`: the page list and the address box (one is on screen at a time), for aria-describedby. */
export type LinkControl = { element: HTMLElement; inputs: HTMLElement[]; describedBy: string; show(href: string): void };

/** M4: Link fields on screen that hold a value that cannot be saved (Save is off while there is one). */
export const invalidLinks = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-link-invalid="true"]')].filter((field) => field.isConnected && !field.closest("[hidden]")).length;
export const INVALID_LINK_REASON = "Fix the link marked in red before saving.";
/** The event a Link field fires (bubbling) when it becomes valid or invalid. */
export const LINK_VALIDITY = "vc-link-validity";

export const createLinkControl = ({ doc, id, href, pages, host, country, label, required = false, disabled = false, onChange }: LinkControlOptions): LinkControl => {
  const root = h(doc, "div", { class: "vc-link-control", role: "group", "aria-label": label });
  const kinds = h(doc, "div", { class: "vc-link-kinds", role: "radiogroup", "aria-label": `${label}: what it opens` });
  const kindButtons = new Map<LinkKind, HTMLButtonElement>();
  for (const { kind, label: text } of LINK_KINDS) {
    const button = h(doc, "button", { type: "button", class: "vc-link-kind", role: "radio", "data-link-kind": kind, disabled }, text);
    kindButtons.set(kind, button);
    kinds.append(button);
  }
  const valueBox = h(doc, "div", { class: "vc-link-value" });
  const search = h(doc, "input", { type: "search", class: "vc-input vc-link-search", placeholder: "Find a page", "aria-label": `${label}: find a page`, autocomplete: "off", disabled });
  const select = h(doc, "select", { id, class: "vc-input vc-link-page", "aria-label": `${label}: page`, disabled });
  const text = h(doc, "input", { type: "text", class: "vc-input vc-link-text", "aria-label": `${label}: address`, autocomplete: "off", spellcheck: "false", disabled });
  const opens = h(doc, "p", { class: "vc-link-opens", id: `${id}-opens`, "aria-live": "polite" });
  const error = h(doc, "p", { class: "vc-link-error", id: `${id}-error`, role: "alert", hidden: true });
  root.append(kinds, valueBox, opens, error);

  // State: the saved href, the kind shown, and what was typed in each kind.
  let saved = "";
  let kind: LinkKind = "page";
  const typed: Record<LinkKind, string> = { page: "", url: "", phone: "", email: "" };

  const fillPages = (current: string) => {
    select.replaceChildren();
    const option = (value: string, name: string) => select.append(h(doc, "option", { value }, name));
    if (!required) option("", "No link");
    else if (!current) option("", "Choose a page");
    for (const [path, name] of pages) option(path, `${name} — ${path}`);
    select.value = current;
  };
  const placeholders: Record<Exclude<LinkKind, "page">, [string, string, string]> = {
    url: ["https://… or /page", "url", "text"],
    phone: [country === "US" || country === "CA" ? "(215) 772-1111" : "+44 20 7946 0958", "tel", "tel"],
    email: ["name@example.com", "email", "email"],
  };
  const render = () => {
    kindButtons.forEach((button, name) => { const on = name === kind; button.setAttribute("aria-checked", String(on)); button.tabIndex = on ? 0 : -1; });
    valueBox.replaceChildren();
    if (kind === "page") { fillPages(typed.page); if (pages.length > 8) valueBox.append(search); valueBox.append(select); }
    else {
      const [placeholder, mode, type] = placeholders[kind];
      text.type = type; text.inputMode = mode; text.placeholder = placeholder; text.value = typed[kind];
      text.id = id; select.removeAttribute("id");
      valueBox.append(text);
      return;
    }
    select.id = id; text.removeAttribute("id");
  };
  const showState = () => {
    const problem = linkProblem({ kind, value: typed[kind] }, { required, country });
    error.textContent = problem ?? "";
    error.hidden = !problem;
    if (problem) root.setAttribute("data-link-invalid", "true"); else root.removeAttribute("data-link-invalid");
    for (const control of [select, text]) { if (problem) control.setAttribute("aria-invalid", "true"); else control.removeAttribute("aria-invalid"); }
    opens.textContent = problem
      ? `Opens: ${saved ? linkOpensText(saved, host, country).slice("Opens: ".length) : "nothing (no link)"} — until this is fixed`
      : linkOpensText(toHref({ kind, value: typed[kind] }, country), host, country);
    const EventOf = (doc.defaultView as (Window & typeof globalThis) | null)?.Event ?? Event;
    root.dispatchEvent(new EventOf(LINK_VALIDITY, { bubbles: true }));
    return problem;
  };
  /** Write the value shown when it can be saved and differs from the saved href. */
  const commit = () => {
    if (showState()) return;
    const next = toHref({ kind, value: typed[kind] }, country);
    if (next === saved) return;
    saved = next;
    onChange(saved);
  };
  const load = (value: string) => {
    saved = String(value ?? "");
    const parsed = parseHref(saved, pages);
    kind = parsed.kind;
    for (const name of Object.keys(typed) as LinkKind[]) typed[name] = "";
    typed[kind] = kind === "phone" ? formatPhone(parsed.value, country) : parsed.value;
    search.value = "";
    render(); showState();
  };

  // Switching kind: Page ↔ Web address carry the same address; Phone / Email keep what was typed there.
  const switchTo = (next: LinkKind) => {
    if (next === kind || disabled) return;
    const current = toHref({ kind, value: typed[kind] }, country);
    if (next === "url" && !typed.url && kind === "page" && typed.page) typed.url = typed.page;
    if (next === "page" && pages.some(([path]) => path === (typed.url || current))) typed.page = typed.url || current;
    kind = next; render(); commit();
    (kind === "page" ? select : text).focus();
  };
  kinds.addEventListener("click", (event) => {
    const next = (event.target as Element | null)?.closest?.("button")?.getAttribute("data-link-kind") as LinkKind | null;
    if (next) switchTo(next);
  });
  kinds.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const order = LINK_KINDS.map((item) => item.kind);
    const index = order.indexOf(kind);
    switchTo(order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length]);
    kindButtons.get(kind)?.focus();
  });
  select.addEventListener("change", () => { typed.page = select.value; commit(); });
  text.addEventListener("input", () => { typed[kind] = text.value; commit(); });
  // A phone number that can be used is shown the way people read it ("(215) 772-1111") once the person leaves it.
  text.addEventListener("change", () => {
    if (kind !== "phone" || phoneProblem(text.value, country)) return;
    text.value = formatPhone(text.value, country);
    typed.phone = text.value;
  });
  search.addEventListener("input", () => {
    const words = search.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for (const option of select.options) option.hidden = Boolean(option.value) && !words.every((word) => option.text.toLocaleLowerCase().includes(word));
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = [...select.options].find((option) => option.value && !option.hidden);
    if (first) { select.value = first.value; typed.page = first.value; commit(); select.focus(); }
  });

  load(href);
  return { element: root, inputs: [select, text], describedBy: `${opens.id} ${error.id}`, show: (value) => { if (String(value ?? "") !== saved) load(String(value ?? "")); } };
};
