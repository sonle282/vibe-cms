/**
 * P7: the editing form, generated from a file's / collection's fields in cms.config — every field type: text (single /
 * multiline, maxLength), richText (P8d: the visual editor, src/admin/rich-editor.ts), image (address + alt + mobile), select, hours, object, list (ordered, min /
 * max, nested), reference (one / many, ordered), dotted keys ("seo.title"), sections.
 *
 * The form edits a copy of the content: keys it does not know (and keys nobody touched) stay exactly as they were, so
 * "no change" saves the same value and the writer keeps the file byte for byte. Fields locked for the owner are shown
 * to editors but cannot be changed (the server refuses anyway, P4): their inputs are disabled, a locked list / object
 * is disabled as a whole, and an editor cannot remove a list item that holds owner-only values (DESIGN §C.1).
 */
import type { Field, ImageField, ListField, ObjectField, ReferenceField, Section } from "../config/index.js";
import { isAdminOnly } from "../config/roles.js";
import type { Role } from "../locks/index.js";
import { clear, h, icon, uid, type Child } from "./dom.js";
import { createRichEditor, type RichEditor, type RichEditorOptions } from "./rich-editor.js";
import { clone, emptyValue, getAt, holdsLockedValue, isRecord, keyPath, parsePathText, pathText, setAt, slugify, type Path } from "./value.js";
import { fieldAt } from "./bridge.js";
import { pickPlace, type PickChoices } from "../check/picks.js";
import { formatPhone, linkOpensText, phoneProblem, type LinkPage } from "../check/link.js";
import { priceNote, priceShown, priceValue, sameAsNote } from "./blocks.js";
import { pluginProblem, type pluginControls } from "./plugins.js";
import { createLinkControl, invalidLinks } from "./link.js";
import { createImageCard, type ImageSlot, type PickRequest } from "./image-card.js";
import type { LibraryImage } from "./media.js";

export type ReferenceOption = { id: string; label: string };
export type ReferenceTarget = { label: string; itemLabel: string; items: ReferenceOption[] };
export type Problem = { path: string; message: string; hint?: string };

export type FormOptions = {
  doc: Document;
  fields: Record<string, Field>;
  sections?: Section[];
  /** The content to edit (copied; the caller's object is never changed). */
  value: unknown;
  role: Role;
  /** Records of the collections that reference fields point to, by collection key. */
  references?: Record<string, ReferenceTarget>;
  /** Top-level keys shown but not editable, with the reason shown under them (e.g. a published record's id). */
  readOnly?: Record<string, string>;
  /** After every change, with the whole current value. */
  onChange?: (value: Record<string, unknown>, path: Path) => void;
  /** P10: open the image picker for an image field; `done` receives the chosen image. Without it, only the address. */
  pickImage?: (current: string, done: (image: { src: string; width?: number; height?: number }) => void, label?: string, more?: { context?: string; select?: LibraryImage }) => void;
  /** M5: upload a file dropped on an image card (prepared in the browser first); `onProgress` gets 0–1. */
  uploadFile?: (file: File, onProgress: (fraction: number) => void) => Promise<{ ok: true; image: LibraryImage } | { ok: false; message: string }>;
  /** M5: the largest file an upload may be (the card refuses bigger files before uploading). */
  maxBytes?: number;
  /** M5: Adjust — a new copy of an image for its area; `created` gets the copy. */
  adjustImage?: (src: string, created: (image: LibraryImage) => void) => void;
  canAdjust?: (src: string) => boolean;
  /** M5: what the library knows about an image (its file size for the card). */
  imageInfo?: (src: string) => { bytes?: number; width?: number; height?: number; name?: string } | undefined;
  /** M5: where an image area is, for the image sheet ("Homepage › Showroom"). */
  imageContext?: (path: Path) => string | undefined;
  /** U3: a short message for the person (a toast), with at most one action (e.g. Undo after replacing an image). */
  notify?: (text: string, action?: { label: string; run: () => void }) => void;
  /** P12g: the choices of the pick fields, by place ("highlights[].of"), as the server computed them from the content. */
  choices?: PickChoices;
  /** P8d: top-level keys whose rich text is Markdown (a Markdown record's body); the rest is HTML. */
  markdown?: string[];
  /** P8d tests: how the visual editor loads its Markdown converter. */
  loadMarkdown?: RichEditorOptions["loadMarkdown"];
  /** M3: ask before deleting a list item ("Delete banner\n\nDelete banner 2?"); without it, items go at once. */
  confirm?: (message: string, options?: { confirm?: string; danger?: boolean }) => boolean | Promise<boolean>;
  /** M3: a list item's card was clicked (outside its controls): show it on the page. */
  onItem?: (path: Path) => void;
  /** M3: go to a field (the validation summary's buttons); focus by default. */
  reveal?: (path: string) => void;
  /** M4: what Link fields offer and show — the site's pages, its host ("Opens: mysalon.example/about"), site.phone.country. */
  links?: { pages: readonly LinkPage[]; host: string; country?: string };
  /** M14: the admin plugins' controls, by name (a field with `control: "<name>"`). */
  controls?: ReturnType<typeof pluginControls>;
  /** M4: the page is on the canvas — a Link field says its destination is not visible there (as the Mr Spa CMS does). */
  previewNotes?: boolean;
  /**
   * M7: the area's on / off toggle (its path, "popup.enabled"), shown as the Mr Spa CMS's switch with what visitors see;
   * `live` = whether it is on on the website now; `noun` = the area ("popup").
   */
  switchField?: { path: string; noun: string; live: boolean | undefined };
};

export type Form = {
  element: HTMLElement;
  /** The current content (a copy). */
  value(): Record<string, unknown>;
  /** Change one value from outside (e.g. a new record's id filled from its name) and show it. */
  setValue(path: Path, value: unknown): void;
  /** Show problems next to their fields (paths as the value checker writes them); returns how many found a field. */
  showErrors(problems: Problem[]): number;
  clearErrors(): void;
  /** Focus the first input of a field (by path text). */
  focus(path: string): boolean;
  /** M4: how many Link fields hold a value that cannot be saved (Save waits until they are fixed). */
  invalidLinks(): number;
  /** P8d: the visual editors on the form (rich text, Markdown body), by path text; `ready` once all show their value. */
  editors: Map<string, RichEditor>;
  ready: Promise<void>;
};

const DAYS: Array<[number, string, string]> = [[1, "Mon", "Monday"], [2, "Tue", "Tuesday"], [3, "Wed", "Wednesday"], [4, "Thu", "Thursday"], [5, "Fri", "Friday"], [6, "Sat", "Saturday"], [0, "Sun", "Sunday"]];
export const LOCK_HELP = "Only an admin can change this.";
/** M3c: the field key a section entry starts with ("services[0].card" → "services"), or undefined. */
export const topKeyOf = (fields: Record<string, Field>, entry: string) => {
  if (entry in fields) return entry;
  return Object.keys(fields).sort((a, b) => b.length - a.length).find((key) => entry.startsWith(`${key}.`) || entry.startsWith(`${key}[`));
};
export const OWNER_NOTE = "Editors see this but only an admin can change it.";
/** M7: the Mr Spa CMS's four sentences under an area's switch — on / off in the draft, against the website. */
export const switchStatus = (on: boolean, live: boolean, noun: string) => (on
  ? (live ? `On — visitors see this ${noun}.` : "On after you publish — visitors don’t see it yet.")
  : (live ? "Off after you publish — visitors still see it until then." : `Off — visitors don’t see a ${noun}.`));
/** M4 (Mr Spa): under a Link field while the page is on the canvas. */
export const LINK_PREVIEW_NOTE = "Link destination: not visible in the preview.";

export const createForm = (options: FormOptions): Form => {
  const { doc, role } = options;
  const owner = role === "owner";
  const state: Record<string, unknown> = isRecord(options.value) ? clone(options.value) : {};
  const references = options.references ?? {};
  /** M16: the image fields that are another image's phone version (shown on its card, not on their own). */
  const pairedMobile = new WeakSet<Field>();
  const pairUp = (fields: Record<string, Field>) => {
    for (const field of Object.values(fields)) {
      if (field.type === "image" && typeof field.mobile === "string" && fields[field.mobile]) pairedMobile.add(fields[field.mobile]);
      if (field.type === "object") pairUp(field.fields);
      if (field.type === "list" && field.of.type === "object") pairUp(field.of.fields);
    }
  };
  pairUp(options.fields);
  /** path text → the field's wrapper, error line and a way to show a new value. */
  const registry = new Map<string, { wrapper: HTMLElement; error: HTMLElement; inputs: () => HTMLElement[]; show?: (value: unknown) => void; label: string }>();
  const changed = (path: Path) => options.onChange?.(clone(state), path);
  // P16a: ids made from a name while the item is new — by the source field's place, what to fill and whether it still follows.
  const following = new Map<string, { target: Path; show: (value: unknown) => void; on: boolean }>();
  /** M13: fields that copy another (sameAs) — by the source's place, where the copy is and how it is shown. */
  const copies: Array<{ source: string; target: Path; show: () => void }> = [];
  const followCopies = (path: Path) => {
    const at = pathText(path);
    for (const copy of copies) {
      if (copy.source !== at && !at.startsWith(`${copy.source}.`) && !copy.source.startsWith(`${at}.`)) continue;
      const value = getAt(state, parsePathText(copy.source));
      setAt(state, copy.target, value === undefined ? undefined : clone(value));
      copy.show();
      changed(copy.target);
    }
  };
  const set = (path: Path, value: unknown) => {
    setAt(state, path, value);
    changed(path);
    followCopies(path);
    const follow = following.get(pathText(path));
    if (follow?.on && typeof value === "string") {
      // Unique among the other items of the same list ("classic-manicure-2").
      const key = follow.target[follow.target.length - 1];
      const list = getAt(state, follow.target.slice(0, -2));
      const index = follow.target[follow.target.length - 2];
      const taken = new Set(Array.isArray(list) ? list.filter((_, other) => other !== index).map((item) => (isRecord(item) ? item[String(key)] : undefined)).filter((id): id is string => typeof id === "string" && id !== "") : []);
      const base = slugify(value);
      let id = base; let suffix = 2;
      while (base && taken.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
      setAt(state, follow.target, id || undefined);
      follow.show(id);
      changed(follow.target);
    }
  };

  // ---------------------------------------------------------------- shared pieces

  const button = (label: string, name: string, onClick: () => void, disabled: boolean, extra: Record<string, string> = {}) =>
    h(doc, "button", { type: "button", class: `vc-icon-button vc-${name}`, "aria-label": label, "data-tooltip": label, disabled, onclick: (event: Event) => { event.preventDefault(); onClick(); }, ...extra }, icon(doc, name));

  const labelContent = (field: Field, locked: boolean, text = field.label): Child[] => [
    text,
    field.required ? h(doc, "span", { class: "vc-required", "aria-hidden": "true" }, " *") : null,
    field.required ? h(doc, "span", { class: "vc-sr-only" }, " (required)") : null,
    // M3b: an admin sees the lock with its note as the tooltip (not a line under every locked field).
    locked || (owner && isAdminOnly(field.locked)) ? h(doc, "span", { class: "vc-lock", "data-tooltip": locked ? LOCK_HELP : OWNER_NOTE }, icon(doc, "lock"), h(doc, "span", { class: "vc-sr-only" }, locked ? " (admin only)" : ` (admin only: ${OWNER_NOTE})`)) : null,
  ];

  type Wrap = { path: Path; field: Field; locked: boolean; reason?: string; group: boolean; control: HTMLElement; inputId?: string; hideLabel?: boolean; show?: (value: unknown) => void; extraHelp?: Child };
  const wrap = ({ path, field, locked, reason, group, control, inputId, hideLabel, show, extraHelp }: Wrap) => {
    const text = pathText(path);
    const helpId = uid("help");
    const errorId = uid("err");
    const notes = [field.help, locked ? LOCK_HELP : null, reason].filter(Boolean).join(" ");
    const help = notes || extraHelp ? h(doc, "p", { class: "vc-help", id: helpId }, notes, notes && extraHelp ? " " : null, extraHelp) : null;
    const error = h(doc, "p", { class: "vc-error", id: errorId, hidden: true });
    const label = group
      ? h(doc, "legend", { class: hideLabel ? "vc-label vc-sr-only" : "vc-label" }, ...labelContent(field, locked))
      : h(doc, "label", { class: hideLabel ? "vc-label vc-sr-only" : "vc-label", for: inputId, id: inputId ? `${inputId}-label` : undefined }, ...labelContent(field, locked));
    const wrapper = h(doc, group ? "fieldset" : "div", { class: `vc-field vc-field-${field.type}${locked || reason ? " vc-locked" : ""}`, "data-path": text, "data-type": field.type, ...(group && (locked || reason) ? { disabled: true } : {}) }, label, control, help, error);
    const described = [help ? helpId : null, errorId].filter(Boolean).join(" ");
    // The visible main control first (a visual editor's area or its source box), then everything else.
    const inputs = () => [...new Set([...wrapper.querySelectorAll<HTMLElement>("[data-vc-primary]:not([hidden])"), ...wrapper.querySelectorAll<HTMLElement>("input, select, textarea")])];
    for (const input of inputs()) if (!input.getAttribute("aria-describedby")) input.setAttribute("aria-describedby", described);
    // M16: a field shown elsewhere (a plugin's standardAt, a phone image on its desktop card) keeps that place.
    const hiddenHere = field.hidden === true || pairedMobile.has(field);
    if (hiddenHere) wrapper.hidden = true;
    const before = registry.get(text);
    if (!hiddenHere || !before || !before.wrapper.isConnected) registry.set(text, { wrapper, error, inputs, show, label: field.label });
    return wrapper;
  };

  // ---------------------------------------------------------------- field types

  const editors = new Map<string, RichEditor>();
  /** P8d: rich text (HTML) and a Markdown body get the visual editor. */
  const richInput = (field: Extract<Field, { type: "richText" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const markdown = path.length === 1 && Boolean(options.markdown?.includes(String(path[0])));
    const editor = createRichEditor({
      doc, id, label: field.label, format: markdown ? "markdown" : "html", disabled,
      value: typeof current === "string" ? current : current === undefined || current === null ? "" : String(current),
      onChange: (value) => set(path, value === "" && wasAbsent ? undefined : value),
      ...(options.pickImage ? { pickImage: options.pickImage } : {}),
      ...(options.loadMarkdown ? { loadMarkdown: options.loadMarkdown } : {}),
      ...(field.allow ? { allow: field.allow } : {}),
      // M10: Add link offers the site's pages.
      ...(options.links ? { pages: options.links.pages } : {}),
    });
    editor.area.setAttribute("aria-labelledby", `${id}-label`);
    editors.set(pathText(path), editor);
    return { control: editor.element, id, show: (value: unknown) => editor.setValue(typeof value === "string" ? value : "") };
  };

  /** M13 (Mr Spa): the price box — "$" in front, 1299 saved as "$1,299", other words kept; "Shoppers will see …". */
  const priceInput = (field: Extract<Field, { type: "text" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const input = h(doc, "input", { id, type: "text", class: "vc-input vc-price-input", disabled, autocomplete: "off", inputmode: "decimal", placeholder: "0.00", maxlength: String(field.maxLength ?? 500) });
    const note = h(doc, "p", { class: "vc-help vc-price-note", "aria-live": "polite" });
    const say = (saved: string) => { note.textContent = priceNote(saved); note.hidden = !note.textContent; };
    const show = (value: unknown) => { const saved = typeof value === "string" ? value : ""; input.value = priceShown(saved); say(saved); };
    show(current);
    input.addEventListener("input", () => { const value = priceValue(input.value); set(path, value === "" && wasAbsent ? undefined : value); say(value); });
    const control = h(doc, "div", { class: "vc-price" }, h(doc, "div", { class: "vc-price-box" }, h(doc, "span", { class: "vc-price-currency", "aria-hidden": "true" }, "$"), input), note);
    return { control, id, show };
  };

  const textInput = (field: Extract<Field, { type: "text" }>, path: Path, disabled: boolean) => {
    if (field.format === "price") return priceInput(field, path, disabled);
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const input = field.multiline
      ? h(doc, "textarea", { id, rows: 3, class: "vc-input", disabled, spellcheck: "true" })
      : h(doc, "input", { id, type: "text", class: "vc-input", disabled, autocomplete: "off" });
    input.value = typeof current === "string" ? current : current === undefined || current === null ? "" : String(current);
    // M3: no counter (the Mr Spa CMS has one only on the search description); the input holds at most maxLength.
    if (field.maxLength) input.setAttribute("maxlength", String(field.maxLength));
    const show = (value: unknown) => { input.value = typeof value === "string" ? value : ""; };
    // P16a: while this id is empty (a new item), it follows the field it is made from; typing in it stops that.
    const follow = field.from && !input.value ? { target: path, show, on: true } : undefined;
    if (follow && field.from) following.set(pathText([...path.slice(0, -1), ...keyPath(field.from)]), follow);
    input.addEventListener("input", () => { if (follow) follow.on = false; set(path, input.value === "" && wasAbsent ? undefined : input.value); });
    return { control: input, id, show };
  };

  const selectInput = (field: Extract<Field, { type: "select" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const select = h(doc, "select", { id, class: "vc-input", disabled });
    select.append(h(doc, "option", { value: "" }, field.required ? "Choose…" : "— None —"));
    for (const option of field.options) select.append(h(doc, "option", { value: option }, option));
    if (typeof current === "string" && current && !field.options.includes(current)) select.append(h(doc, "option", { value: current }, `${current} (not an option)`));
    select.value = typeof current === "string" ? current : "";
    select.addEventListener("change", () => set(path, select.value === "" && wasAbsent ? undefined : select.value));
    return { control: select, id, show: (value: unknown) => { select.value = typeof value === "string" ? value : ""; } };
  };

  // P12g: pick — one of the choices the site lists from this content (grouped); a value no longer listed is kept and says so.
  const pickInput = (field: Extract<Field, { type: "pick" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const place = pickPlace(options.fields, path);
    const choices = (place && options.choices?.[place]) || [];
    const select = h(doc, "select", { id, class: "vc-input", disabled });
    select.append(h(doc, "option", { value: "" }, field.required ? "Choose…" : "— None —"));
    const groups = new Map<string, HTMLElement>();
    for (const choice of choices) {
      const option = h(doc, "option", { value: choice.value }, choice.label);
      if (!choice.group) { select.append(option); continue; }
      if (!groups.has(choice.group)) { const group = h(doc, "optgroup", { label: choice.group }); groups.set(choice.group, group); select.append(group); }
      groups.get(choice.group)!.append(option);
    }
    if (typeof current === "string" && current && !choices.some((choice) => choice.value === current)) select.append(h(doc, "option", { value: current }, `${current} (not in the list)`));
    select.value = typeof current === "string" ? current : "";
    select.addEventListener("change", () => set(path, select.value === "" && wasAbsent ? undefined : select.value));
    return { control: select, id, show: (value: unknown) => { select.value = typeof value === "string" ? value : ""; } };
  };

  // P16a: number — a number input; empty = no value (left out).
  const numberInput = (field: Extract<Field, { type: "number" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const input = h(doc, "input", { id, type: "number", class: "vc-input vc-number", disabled, inputmode: field.integer ? "numeric" : "decimal", step: field.integer ? "1" : "any", ...(field.min !== undefined ? { min: String(field.min) } : {}), ...(field.max !== undefined ? { max: String(field.max) } : {}) });
    input.value = typeof current === "number" ? String(current) : current === undefined || current === null ? "" : String(current);
    input.addEventListener("input", () => { const text = input.value.trim(); set(path, text === "" ? undefined : Number.isFinite(Number(text)) ? Number(text) : text); });
    return { control: input, id, show: (value: unknown) => { input.value = typeof value === "number" ? String(value) : ""; } };
  };

  // M4: link — Page · Web address · Phone · Email (src/admin/link.ts); only a value that can be saved is written.
  const linkInput = (field: Extract<Field, { type: "link" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const links = options.links ?? { pages: [], host: "" };
    const control = createLinkControl({
      doc, id, href: typeof current === "string" ? current : "", pages: links.pages, host: links.host, country: links.country,
      label: field.label, required: field.required, disabled, onChange: (href) => set(path, href === "" && wasAbsent ? undefined : href),
    });
    return { control: control.element, id, show: (value: unknown) => control.show(typeof value === "string" ? value : ""), inputs: control.inputs, describedBy: control.describedBy };
  };

  // M4: phone — a tel input; a number that can be used is written the way people read it once the person leaves it.
  const phoneInput = (path: Path, disabled: boolean) => {
    const id = uid("f");
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const country = options.links?.country;
    const input = h(doc, "input", { id, type: "tel", class: "vc-input vc-phone", disabled, autocomplete: "off", inputmode: "tel", placeholder: country === "US" || country === "CA" ? "(215) 772-1111" : "+44 20 7946 0958" });
    input.value = typeof current === "string" ? current : current === undefined || current === null ? "" : String(current);
    input.addEventListener("input", () => set(path, input.value === "" && wasAbsent ? undefined : input.value));
    input.addEventListener("change", () => {
      if (phoneProblem(input.value, country)) return;
      const shown = formatPhone(input.value, country);
      if (shown !== input.value) { input.value = shown; set(path, shown); }
    });
    return { control: input, id, show: (value: unknown) => { input.value = typeof value === "string" ? value : ""; } };
  };

  // M7 (Mr Spa): the area's switch — "Show on website" and one sentence on what visitors see, the draft against the website.
  const switchInput = (field: Extract<Field, { type: "toggle" }>, path: Path, disabled: boolean, about: { noun: string; live: boolean | undefined }) => {
    const id = uid("f");
    const wasAbsent = getAt(state, path) === undefined;
    const box = h(doc, "input", { id, type: "checkbox", role: "switch", class: "vc-switch-box", disabled, "aria-describedby": `${id}-status` });
    const status = h(doc, "span", { id: `${id}-status` });
    const say = () => { status.textContent = switchStatus(box.checked, about.live ?? box.checked, about.noun); };
    box.checked = getAt(state, path) === true;
    say();
    box.addEventListener("change", () => { set(path, box.checked ? true : wasAbsent ? undefined : false); say(); });
    return { control: h(doc, "label", { class: "vc-switch", for: id }, h(doc, "span", { class: "vc-switch-text" }, h(doc, "strong", {}, field.label), status), box), id, show: (value: unknown) => { box.checked = value === true; say(); } };
  };

  // P12g: toggle — a checkbox; unticking a value that was never set leaves it out again.
  const toggleInput = (field: Extract<Field, { type: "toggle" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const wasAbsent = getAt(state, path) === undefined;
    const box = h(doc, "input", { id, type: "checkbox", class: "vc-toggle-box", disabled });
    box.checked = getAt(state, path) === true;
    box.addEventListener("change", () => set(path, box.checked ? true : wasAbsent ? undefined : false));
    return { control: h(doc, "span", { class: "vc-check" }, box, h(doc, "label", { for: id }, field.help ?? "Yes")), id, show: (value: unknown) => { box.checked = value === true; } };
  };

  // M5: the image card of the Mr Spa CMS (src/admin/image-card.ts). Under it only the image description, when the
  // field keeps one (alt) — the address, the phone image and the alt are no longer boxes under the card.
  const imageInput = (field: ImageField, path: Path, disabled: boolean, label: string, setMain?: () => void) => {
    const wasAbsent = getAt(state, path) === undefined;
    const read = () => getAt(state, path);
    // M16: the phone version in a sibling field (Mr Spa: image + mobileImage, plain addresses).
    const siblingPath = typeof field.mobile === "string" ? [...path.slice(0, -1), field.mobile] : undefined;
    const get = (slot: ImageSlot) => {
      const value = read();
      if (slot === "desktop") return typeof value === "string" ? value : isRecord(value) && typeof value.src === "string" ? value.src : "";
      if (siblingPath) { const phone = getAt(state, siblingPath); return typeof phone === "string" ? phone : isRecord(phone) && typeof phone.src === "string" ? phone.src : ""; }
      return isRecord(value) && typeof value.mobile === "string" ? value.mobile : "";
    };
    const write = (slot: ImageSlot, src: string) => {
      if (slot === "mobile" && siblingPath) {
        const phone = getAt(state, siblingPath);
        set(siblingPath, isRecord(phone) ? { ...phone, src } : src);
        registry.get(pathText(siblingPath))?.show?.(getAt(state, siblingPath));
        return;
      }
      const now = read();
      let next: unknown;
      if (slot === "desktop" && !isRecord(now)) next = src === "" && wasAbsent ? undefined : src;
      else {
        const object: Record<string, unknown> = isRecord(now) ? { ...now } : { src: typeof now === "string" ? now : "" };
        if (slot === "desktop") object.src = src; else if (src || "mobile" in object) object.mobile = src;
        next = object;
      }
      set(path, next);
    };
    const start = read();
    const pick = options.pickImage;
    const card = createImageCard({
      doc, label, key: pathText(path), disabled,
      mobile: Boolean(field.mobile) || (isRecord(start) && typeof start.mobile === "string"),
      ...(siblingPath ? { onSlot: (slot: ImageSlot) => onSlot(slot) } : {}),
      // Mr Spa: a required image and an image of a list (the list has its own ×) have no Remove.
      removable: !field.required && typeof path[path.length - 1] !== "number",
      get, set: write,
      ...(pick ? { pick: (request: PickRequest, done: (image: LibraryImage) => void) => pick(request.current, (image) => done(image as LibraryImage), request.label, { context: options.imageContext?.(path), ...(request.select ? { select: request.select } : {}) }) } : {}),
      ...(options.uploadFile ? { upload: options.uploadFile, maxBytes: options.maxBytes } : {}),
      ...(options.adjustImage ? { adjust: options.adjustImage, canAdjust: options.canAdjust } : {}),
      ...(options.imageInfo ? { info: options.imageInfo } : {}),
      ...(setMain ? { setMain } : {}),
      ...(options.notify ? { notify: options.notify } : {}),
    });
    const record = isRecord(start) ? start : {};
    let alt: HTMLInputElement | undefined;
    const altPart = field.alt || typeof record.alt === "string" ? (() => {
      const id = uid("f");
      const helpId = uid("help");
      alt = h(doc, "input", { id, type: "text", class: "vc-input", disabled, autocomplete: "off", "aria-describedby": helpId });
      alt.value = typeof record.alt === "string" ? record.alt : "";
      alt.addEventListener("input", () => {
        const now = read();
        const object: Record<string, unknown> = isRecord(now) ? { ...now } : { src: typeof now === "string" ? now : "" };
        object.alt = alt!.value;
        set(path, object);
      });
      return h(doc, "div", { class: "vc-subfield vc-image-alt" }, h(doc, "label", { for: id, class: "vc-sublabel" }, "Image description"), h(doc, "p", { class: "vc-help", id: helpId }, "Describe the image for people using a screen reader."), alt);
    })() : null;
    // P20: a caption under the image (Mr Spa's project gallery).
    let caption: HTMLInputElement | undefined;
    const captionPart = field.caption ? (() => {
      const id = uid("f");
      caption = h(doc, "input", { id, type: "text", class: "vc-input", disabled, autocomplete: "off" });
      caption.value = typeof record.caption === "string" ? record.caption : "";
      caption.addEventListener("input", () => {
        const now = read();
        const object: Record<string, unknown> = isRecord(now) ? { ...now } : { src: typeof now === "string" ? now : "" };
        object.caption = caption!.value;
        set(path, object);
      });
      return h(doc, "div", { class: "vc-subfield vc-image-caption" }, h(doc, "label", { for: id, class: "vc-sublabel" }, "Caption"), caption);
    })() : null;
    const show = () => {
      card.refresh();
      const value = read();
      if (alt) alt.value = isRecord(value) && typeof value.alt === "string" ? value.alt : "";
      if (caption) caption.value = isRecord(value) && typeof value.caption === "string" ? value.caption : "";
    };
    // M16: with the phone version beside it, the help under the card is the shown version's (the Mr Spa CMS).
    let onSlot = (_slot: ImageSlot) => {};
    const control = h(doc, "div", { class: "vc-image" }, card.element, altPart, captionPart);
    if (siblingPath) {
      const phoneHelp = fieldAt(options.fields, siblingPath)?.field.help;
      onSlot = (slot) => {
        const help = control.closest(".vc-field")?.querySelector<HTMLElement>(":scope > .vc-help");
        if (help && (field.help || phoneHelp)) help.textContent = (slot === "mobile" ? phoneHelp : field.help) ?? field.help ?? "";
      };
    }
    return { control, show };
  };

  const hoursInput = (path: Path, disabled: boolean) => {
    const rowsBox = h(doc, "div", { class: "vc-hours-rows" });
    const rows = () => (Array.isArray(getAt(state, path)) ? (getAt(state, path) as Array<Record<string, unknown>>) : []);
    const writeRows = (next: Array<Record<string, unknown>>, rerender: boolean) => { set(path, next); if (rerender) render(); };
    const render = () => {
      clear(rowsBox);
      const list = rows();
      list.forEach((row, index) => {
        const rowPath = [...path, index];
        const edit = (change: (copy: Record<string, unknown>) => void, rerender = false) => { const next = clone(rows()); const copy = isRecord(next[index]) ? next[index] : (next[index] = {}); change(copy); writeRows(next, rerender); };
        const days = Array.isArray(row.days) ? (row.days as number[]) : [];
        const closed = row.closed === true;
        const dayBoxes = DAYS.map(([day, short, long]) => {
          const id = uid("day");
          const box = h(doc, "input", { id, type: "checkbox", disabled, "aria-label": long });
          box.checked = days.includes(day);
          box.addEventListener("change", () => edit((copy) => { const chosen = new Set(Array.isArray(copy.days) ? (copy.days as number[]) : []); if (box.checked) chosen.add(day); else chosen.delete(day); copy.days = [...chosen].sort((a, b) => a - b); }));
          return h(doc, "label", { class: "vc-day", for: id }, box, h(doc, "span", { "aria-hidden": "true" }, short));
        });
        const time = (name: "open" | "close", label: string) => {
          const id = uid("t");
          const input = h(doc, "input", { id, type: "time", class: "vc-input vc-time", disabled: disabled || closed, step: "60" });
          input.value = typeof row[name] === "string" ? (row[name] as string) : "";
          input.addEventListener("change", () => edit((copy) => { copy[name] = input.value; }));
          return h(doc, "label", { class: "vc-sublabel", for: id }, label, input);
        };
        const closedId = uid("c");
        const closedBox = h(doc, "input", { id: closedId, type: "checkbox", disabled });
        closedBox.checked = closed;
        closedBox.addEventListener("change", () => edit((copy) => {
          if (closedBox.checked) { delete copy.open; delete copy.close; copy.closed = true; } else { delete copy.closed; copy.open = typeof copy.open === "string" ? copy.open : "09:00"; copy.close = typeof copy.close === "string" ? copy.close : "17:00"; }
        }, true));
        const labelId = uid("l");
        const labelInput = h(doc, "input", { id: labelId, type: "text", class: "vc-input", disabled, placeholder: "e.g. Monday – Friday", autocomplete: "off" });
        labelInput.value = typeof row.label === "string" ? row.label : "";
        const hadLabel = "label" in row;
        labelInput.addEventListener("input", () => edit((copy) => { if (labelInput.value || hadLabel) copy.label = labelInput.value; else delete copy.label; }));
        const summary = closed ? "closed" : `${row.open ?? "?"}–${row.close ?? "?"}`;
        const name = `Row ${index + 1}`;
        const element = h(doc, "div", { class: "vc-hours-row", role: "group", "aria-label": `${name}: ${days.map((day) => DAYS.find((entry) => entry[0] === day)?.[1]).join(" ")} ${summary}`, "data-path": pathText(rowPath) },
          h(doc, "div", { class: "vc-days", role: "group", "aria-label": "Days" }, dayBoxes),
          h(doc, "div", { class: "vc-hours-times" },
            h(doc, "label", { class: "vc-check", for: closedId }, closedBox, " Closed"),
            time("open", "Opens"), time("close", "Closes"),
            h(doc, "label", { class: "vc-sublabel", for: labelId }, "Label (optional)", labelInput)),
          h(doc, "div", { class: "vc-item-actions" },
            button(`Move ${name} up`, "up", () => { const next = clone(rows()); [next[index - 1], next[index]] = [next[index], next[index - 1]]; writeRows(next, true); }, disabled || index === 0),
            button(`Move ${name} down`, "down", () => { const next = clone(rows()); [next[index + 1], next[index]] = [next[index], next[index + 1]]; writeRows(next, true); }, disabled || index === list.length - 1),
            button(`Delete ${name}`, "remove", () => { const next = clone(rows()); next.splice(index, 1); writeRows(next, true); }, disabled)));
        const error = h(doc, "p", { class: "vc-error", hidden: true });
        element.append(error);
        registry.set(pathText(rowPath), { wrapper: element, error, inputs: () => [...element.querySelectorAll<HTMLElement>("input")], label: name });
        for (const key of ["days", "open", "close", "label", "closed"]) registry.set(pathText([...rowPath, key]), { wrapper: element, error, inputs: () => [...element.querySelectorAll<HTMLElement>("input")], label: name });
        rowsBox.append(element);
      });
    };
    render();
    const add = h(doc, "button", { type: "button", class: "vc-button vc-add", disabled, onclick: () => { const next = clone(rows()); next.push({ days: [], open: "09:00", close: "17:00" }); writeRows(next, true); (rowsBox.lastElementChild?.querySelector("input") as HTMLInputElement | null)?.focus(); } }, icon(doc, "plus"), " Add a row");
    return { control: h(doc, "div", { class: "vc-hours" }, rowsBox, add) };
  };

  const summaryOf = (field: Field, value: unknown): string => {
    if (typeof value === "string") return value.replace(/<[^>]*>/g, "").slice(0, 60);
    if (field.type === "object" && isRecord(value)) {
      for (const [key, child] of Object.entries(field.fields)) {
        const inner = getAt(value, keyPath(key));
        if ((child.type === "text" || child.type === "select") && typeof inner === "string" && inner) return inner.slice(0, 60);
      }
    }
    return "";
  };

  /** M3: the ↑ ↓ × text buttons of a list item (the Mr Spa CMS's repeatable editor). */
  const glyph = (label: string, name: string, text: string, onClick: () => void, disabled: boolean) =>
    h(doc, "button", { type: "button", class: `vc-glyph vc-${name}`, "aria-label": label, "data-tooltip": label, disabled, onclick: (event: Event) => { event.preventDefault(); event.stopPropagation(); onClick(); } }, text);

  /** M13: which card of each menu is open (one at a time; kept while the list redraws). */
  const menuOpen = new Map<string, number>();
  /**
   * M13 (the Mr Spa CMS's menu cards): closed, a card is its label and "Opens: …" (a dropdown: "Dropdown · 3 links");
   * open, "Editing link 2 of 4" (a click closes it), ↑ ↓, ⋯ Remove, and the item's fields. "+ Add link" at the end.
   */
  const menuInput = (field: ListField, path: Path, locked: boolean) => {
    const of = field.of as ObjectField;
    const keys = Object.keys(of.fields);
    const labelKey = keys.find((key) => of.fields[key].type === "text") ?? keys[0];
    const linkKey = keys.find((key) => of.fields[key].type === "link");
    const childKey = keys.find((key) => { const inner = of.fields[key]; return inner.type === "list" && Boolean(inner.menu); });
    const itemLabel = field.itemLabel ?? of.label;
    const noun = itemLabel.toLowerCase();
    const many = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;
    const key = pathText(path);
    const cards = h(doc, "ol", { class: "vc-menu-cards" });
    const add = h(doc, "button", { type: "button", class: "vc-button vc-menu-add" }, `+ Add ${noun}`);
    const list = () => (Array.isArray(getAt(state, path)) ? (getAt(state, path) as unknown[]) : []);
    const titleOf = (value: unknown) => { const text = isRecord(value) ? value[labelKey] : undefined; return typeof text === "string" && text.trim() ? text.trim() : "Untitled"; };
    const metaOf = (value: unknown) => {
      const children = childKey && isRecord(value) && Array.isArray(value[childKey]) ? value[childKey] as unknown[] : undefined;
      if (children?.length) { const inner = of.fields[childKey!] as ListField; return `Dropdown · ${many(children.length, (inner.itemLabel ?? inner.of.label).toLowerCase())}`; }
      return linkKey && isRecord(value) ? linkOpensText(String(value[linkKey] ?? ""), options.links?.host ?? "", options.links?.country) : "";
    };
    const focusCard = (index: number, part: "heading" | "summary" | "up" | "down" | "label") => {
      const card = cards.children[index] as HTMLElement | undefined;
      const target = part === "label" ? card?.querySelector<HTMLElement>(".vc-menu-card-body input, .vc-menu-card-body textarea")
        : part === "up" || part === "down" ? card?.querySelector<HTMLElement>(`.vc-menu-card-${part}:not([disabled])`) ?? card?.querySelector<HTMLElement>(".vc-menu-card-heading")
        : card?.querySelector<HTMLElement>(part === "heading" ? ".vc-menu-card-heading" : ".vc-menu-card-summary");
      target?.focus();
    };
    const write = (next: unknown[], open: number) => { set(path, next); menuOpen.set(key, open); render(); };
    const iconButton = (name: "up" | "down", label: string, tip: string, run: () => void, disabled: boolean) =>
      h(doc, "button", { type: "button", class: `vc-icon-button vc-menu-card-action vc-menu-card-${name}`, "aria-label": label, "data-tooltip": tip, disabled, onclick: (event: Event) => { event.preventDefault(); run(); } }, icon(doc, name));
    /** ⋯ → Remove (red); at the list's minimum it is off, with why. No question first (Mr Spa). */
    const moreMenu = (title: string, atMin: boolean, remove: () => void) => {
      const reason = `This list keeps at least ${many(field.min ?? 0, noun)}.`;
      const menu = h(doc, "div", { class: "vc-row-menu-list", role: "menu", hidden: true },
        atMin ? h(doc, "p", { class: "vc-menu-card-reason" }, reason) : null,
        h(doc, "button", { type: "button", class: "vc-row-menu-item is-danger", role: "menuitem", disabled: atMin, ...(atMin ? { title: reason } : {}), onclick: () => { close(); remove(); } }, "Remove"));
      const button = h(doc, "button", { type: "button", class: "vc-row-menu-button", "aria-label": `More actions for ${title}`, "data-tooltip": "More", "aria-haspopup": "menu", "aria-expanded": "false" }, "⋯");
      const close = () => { menu.hidden = true; button.setAttribute("aria-expanded", "false"); };
      button.addEventListener("click", (event) => { event.preventDefault(); menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLElement>(".vc-row-menu-item:not([disabled])")?.focus(); });
      menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); button.focus(); } });
      // Cards are redrawn often: a menu that is gone stops listening.
      const outside = (event: Event) => {
        if (!menu.isConnected) { doc.removeEventListener("pointerdown", outside); return; }
        if (!menu.hidden && !menu.contains(event.target as Node) && event.target !== button) close();
      };
      doc.addEventListener("pointerdown", outside);
      return h(doc, "div", { class: "vc-row-menu" }, button, menu);
    };
    const render = () => {
      clear(cards);
      const values = list();
      const open = menuOpen.get(key) ?? -1;
      values.forEach((value, index) => {
        const title = titleOf(value);
        const place = pathText([...path, index]);
        if (index !== open) {
          cards.append(h(doc, "li", { class: "vc-menu-card", "data-item": place },
            h(doc, "button", { type: "button", class: "vc-menu-card-summary", "aria-expanded": "false", onclick: () => { menuOpen.set(key, index); render(); focusCard(index, "heading"); } },
              h(doc, "span", { class: "vc-menu-card-title" }, title), h(doc, "span", { class: "vc-menu-card-meta" }, metaOf(value)), icon(doc, "chevron"))));
          return;
        }
        const named = title === "Untitled" ? "item" : title;
        const move = (to: number) => { const next = clone(values); [next[to], next[index]] = [next[index], next[to]]; write(next, to); focusCard(to, to < index ? "up" : "down"); };
        const body = h(doc, "div", { class: "vc-menu-card-body" });
        renderFields(of.fields, [...path, index], locked, body);
        cards.append(h(doc, "li", { class: "vc-menu-card is-open", "data-item": place },
          h(doc, "div", { class: "vc-menu-card-head" },
            h(doc, "button", { type: "button", class: "vc-menu-card-heading", "aria-expanded": "true", title: "Close", onclick: () => { menuOpen.set(key, -1); render(); focusCard(index, "summary"); } }, `Editing ${noun} ${index + 1} of ${values.length}`),
            field.fixed ? null : iconButton("up", `Move ${named} up`, "Move up", () => move(index - 1), locked || index === 0),
            field.fixed ? null : iconButton("down", `Move ${named} down`, "Move down", () => move(index + 1), locked || index === values.length - 1),
            field.fixed || locked ? null : moreMenu(title, values.length <= (field.min ?? 0), () => {
              const next = clone(values); next.splice(index, 1);
              write(next, -1);
              if (next.length) focusCard(Math.min(index, next.length - 1), "summary"); else add.focus();
            })),
          body));
      });
      const full = field.max !== undefined && values.length >= field.max;
      add.disabled = locked || full;
      if (full) add.title = `This list holds at most ${many(field.max!, noun)}.`; else add.removeAttribute("title");
    };
    add.addEventListener("click", () => {
      const item = emptyValue(of) as Record<string, unknown>;
      item[labelKey] = `New ${noun}`;
      if (linkKey) item[linkKey] = "/";
      const next = [...clone(list()), item];
      write(next, next.length - 1);
      focusCard(next.length - 1, "label");
    });
    render();
    return { control: h(doc, "div", { class: "vc-menu-list" }, cards, field.fixed ? null : add) };
  };

  /** M13 (Mr Spa): a field that copies another — its value, "<label> comes from <section> › <field>", Edit. */
  const sameAsCard = (field: Field, path: Path) => {
    const source = field.sameAs!;
    const sourcePath = parsePathText(source);
    const sourceField = fieldAt(options.fields, sourcePath)?.field;
    const top = topKeyOf(options.fields, source);
    const section = options.sections?.find((entry) => entry.fields.some((key) => key === source || key === top || source.startsWith(`${key}.`)))?.label;
    const sourceLabel = sourceField?.label ?? source;
    const value = h(doc, "strong", { class: "vc-same-value" });
    const show = () => { const current = getAt(state, sourcePath); value.textContent = typeof current === "string" && current.trim() ? current : "Not set"; };
    show();
    copies.push({ source: pathText(sourcePath), target: path, show });
    const edit = h(doc, "button", { type: "button", class: "vc-same-edit", "aria-label": `Edit the ${sourceLabel.toLowerCase()}${section ? ` in ${section}` : ""}`, onclick: () => { if (options.reveal) options.reveal(source); else focusPath(source); } }, "Edit");
    return h(doc, "div", { class: "vc-same-card" }, h(doc, "div", { class: "vc-same-text" }, value, h(doc, "span", {}, sameAsNote(field.label, sourceLabel, section))), edit);
  };

  const listInput = (field: ListField, path: Path, locked: boolean) => {
    if (field.menu && field.of.type === "object") return menuInput(field, path, locked);
    const items = h(doc, "div", { class: "vc-items" });
    const note = h(doc, "p", { class: "vc-note vc-list-count" });
    const itemLabel = field.itemLabel ?? field.of.label;
    const list = () => (Array.isArray(getAt(state, path)) ? (getAt(state, path) as unknown[]) : []);
    const primitive = !["object", "list", "hours", "image", "tuple"].includes(field.of.type) && !(field.of.type === "reference" && field.of.multiple);
    // Mr Spa: "Add banner".
    const add = h(doc, "button", { type: "button", class: "vc-button vc-add" }, `Add ${itemLabel.toLowerCase()}`);
    const write = (next: unknown[], focus?: { index: number; action: string }) => {
      set(path, next);
      render();
      if (focus) {
        const card = items.children[focus.index] as HTMLElement | undefined;
        const target = focus.action === "add" ? card?.querySelector<HTMLElement>("input, select, textarea") : card?.querySelector<HTMLElement>(`.vc-${focus.action}:not([disabled])`) ?? card?.querySelector<HTMLElement>("button:not([disabled])");
        target?.focus();
      }
    };
    const render = () => {
      clear(items);
      const values = list();
      values.forEach((value, index) => {
        const name = `${itemLabel} ${index + 1}`;
        const keepsLocked = !owner && holdsLockedValue(field.of, value);
        const removeLabel = keepsLocked ? `Only an admin can delete ${name}: it holds admin-only values` : `Delete ${name}`;
        const remove = async () => {
          // Mr Spa: "Delete banner" / "Delete banner 2?" / Delete (red).
          const noun = itemLabel.toLowerCase();
          if (options.confirm && !(await options.confirm(`Delete ${noun}\n\nDelete ${noun} ${index + 1}?`, { confirm: "Delete", danger: true }))) return;
          const next = clone(list()); next.splice(index, 1);
          write(next, next.length ? { index: Math.min(index, next.length - 1), action: "remove" } : undefined);
          if (!next.length) add.focus();
        };
        const actions = h(doc, "div", { class: "vc-item-actions" },
          field.ordered && !field.fixed ? glyph(`Move ${name} up`, "up", "↑", () => { const next = clone(values); [next[index - 1], next[index]] = [next[index], next[index - 1]]; write(next, { index: index - 1, action: "up" }); }, locked || index === 0) : null,
          field.ordered && !field.fixed ? glyph(`Move ${name} down`, "down", "↓", () => { const next = clone(values); [next[index + 1], next[index]] = [next[index], next[index + 1]]; write(next, { index: index + 1, action: "down" }); }, locked || index === values.length - 1) : null,
          field.fixed ? null : glyph(removeLabel, "remove", "×", () => { void remove(); }, locked || keepsLocked || values.length <= (field.min ?? 0)));
        // The card already says "Banner 2": the item's own label is for screen readers only.
        // M5 (Mr Spa): an image of a list that is not the first can be made the main one (moved to the front).
        const setMain = field.of.type === "image" && field.ordered && !field.fixed && !locked && index > 0 ? () => {
          const before = clone(values);
          const next = clone(values); const [item] = next.splice(index, 1); next.unshift(item);
          write(next);
          (items.children[0] as HTMLElement | undefined)?.querySelector<HTMLElement>(".vc-image-replace, .vc-image-thumb")?.focus();
          options.notify?.("Main photo changed", { label: "Undo", run: () => write(before) });
        } : undefined;
        const body = renderField(field.of, [...path, index], locked, { hideLabel: true, label: name, ...(setMain ? { setMain } : {}) });
        const summary = summaryOf(field.of, value);
        const card = primitive
          ? h(doc, "div", { class: "vc-item vc-item-inline", role: "group", "aria-label": name, "data-item": pathText([...path, index]) }, body, actions)
          : h(doc, "div", { class: "vc-item", role: "group", "aria-label": summary ? `${name}: ${summary}` : name, "data-item": pathText([...path, index]) },
            // Mr Spa: "Banner 1" over the item's own words, or "Untitled".
            h(doc, "div", { class: "vc-item-head" }, h(doc, "span", { class: "vc-item-heading" }, h(doc, "span", { class: "vc-item-title" }, name), h(doc, "span", { class: "vc-item-summary" }, summary || "Untitled")), actions), body);
        // A click on the card (not on one of its controls) shows the item on the page.
        card.addEventListener("click", (event) => { const target = event.target as Element | null; if (target?.closest?.("input, select, textarea, button, a, [contenteditable]")) return; options.onItem?.([...path, index]); });
        items.append(card);
      });
      const count = values.length;
      // Mr Spa: "2 of 3 allowed." (a fixed set has no count).
      note.textContent = !field.fixed && field.max ? `${count} of ${field.max} allowed.` : "";
      note.hidden = !note.textContent;
      add.disabled = locked || (field.max !== undefined && count >= field.max);
    };
    add.addEventListener("click", () => { const next = clone(list()); next.push(emptyValue(field.of)); write(next, { index: next.length - 1, action: "add" }); });
    render();
    return { control: h(doc, "div", { class: "vc-list" }, note, items, field.fixed ? null : add) };
  };

  const referenceInput = (field: ReferenceField, path: Path, disabled: boolean) => {
    const target = references[field.to] ?? { label: field.to, itemLabel: field.to, items: [] };
    const labelOf = (id: string) => target.items.find((item) => item.id === id)?.label ?? `${id} (not found)`;
    if (!field.multiple) {
      const id = uid("f");
      const current = getAt(state, path);
      const wasAbsent = current === undefined;
      const select = h(doc, "select", { id, class: "vc-input", disabled });
      select.append(h(doc, "option", { value: "" }, `— No ${target.itemLabel.toLowerCase()} —`));
      for (const item of target.items) select.append(h(doc, "option", { value: item.id }, item.label));
      if (typeof current === "string" && current && !target.items.some((item) => item.id === current)) select.append(h(doc, "option", { value: current }, labelOf(current)));
      select.value = typeof current === "string" ? current : "";
      select.addEventListener("change", () => set(path, select.value === "" && wasAbsent ? undefined : select.value));
      return { control: select, id, group: false };
    }
    const chosen = h(doc, "ol", { class: "vc-chosen" });
    const picker = h(doc, "select", { class: "vc-input vc-picker", disabled, "aria-label": `Add ${target.itemLabel.toLowerCase()}` });
    const ids = () => (Array.isArray(getAt(state, path)) ? (getAt(state, path) as string[]) : []);
    const write = (next: string[], focus?: string) => { set(path, next); render(); if (focus) (chosen.querySelector<HTMLElement>(`.vc-${focus}:not([disabled])`) ?? picker).focus(); };
    const render = () => {
      clear(chosen);
      const values = ids();
      values.forEach((value, index) => {
        const name = labelOf(value);
        chosen.append(h(doc, "li", { class: "vc-chosen-item", "data-id": value },
          h(doc, "span", { class: "vc-chosen-label" }, name),
          h(doc, "div", { class: "vc-item-actions" },
            field.ordered ? button(`Move ${name} up`, "up", () => { const next = [...values]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; write(next, "up"); }, disabled || index === 0) : null,
            field.ordered ? button(`Move ${name} down`, "down", () => { const next = [...values]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; write(next, "down"); }, disabled || index === values.length - 1) : null,
            button(`Remove ${name}`, "remove", () => write(values.filter((_, at) => at !== index)), disabled))));
      });
      if (!values.length) chosen.append(h(doc, "li", { class: "vc-note" }, `No ${target.label.toLowerCase()} chosen.`));
      clear(picker);
      picker.append(h(doc, "option", { value: "" }, `Add ${target.itemLabel.toLowerCase()}…`));
      for (const item of target.items) if (!values.includes(item.id)) picker.append(h(doc, "option", { value: item.id }, item.label));
      picker.value = "";
      picker.disabled = disabled || picker.options.length <= 1;
    };
    picker.addEventListener("change", () => { if (picker.value) write([...ids(), picker.value]); picker.focus(); });
    render();
    return { control: h(doc, "div", { class: "vc-reference" }, chosen, picker), group: true };
  };

  // ---------------------------------------------------------------- dispatch

  function renderField(field: Field, path: Path, lockedAbove: boolean, extra: { hideLabel?: boolean; label?: string; setMain?: () => void } = {}): HTMLElement {
    const locked = lockedAbove || (isAdminOnly(field.locked) && !owner);
    const reason = path.length === 1 ? options.readOnly?.[String(path[0])] : undefined;
    const disabled = locked || Boolean(reason);
    // P12d: a text field says which {words} the website fills in and the format it needs.
    const hints = field.type === "text" ? [field.tokens?.length ? `Words the website fills in: ${field.tokens.map((token) => `{${token}}`).join(", ")}.` : "", field.patternHint ? `Format: ${field.patternHint}.` : ""].filter(Boolean).join(" ") : "";
    const withHints = hints ? { ...field, help: field.help ? `${field.help} ${hints}` : hints } : field;
    const shown = extra.label ? { ...withHints, label: extra.label } : withHints;
    const common = { path, field: shown, locked: locked && !lockedAbove, reason, hideLabel: extra.hideLabel };
    // M13: a copy of another field is that field's value and the way to it, not a box of its own.
    if (field.sameAs) return wrap({ ...common, field: { ...shown, help: undefined }, group: false, control: sameAsCard(field, path), hideLabel: true });
    // M14: a plugin's control instead of the standard box (which it may wrap: standard()).
    const plugged = field.control ? options.controls?.[field.control] : undefined;
    if (plugged) {
      const id = uid("f");
      let control: HTMLElement;
      let show: ((value: unknown) => void) | undefined;
      try {
        const made = plugged.make({
          doc, id, field, path, value: clone(getAt(state, path)), disabled,
          set: (value) => set(path, value),
          setAt: (other, value) => { set(other, value); registry.get(pathText(other))?.show?.(getAt(state, other)); },
          standardAt: (other) => {
            const found = fieldAt(options.fields, other);
            if (!found || found.rest.length) throw new Error(`${pathText(other)} is not a field of this record`);
            return renderField({ ...found.field, hidden: false, control: undefined } as Field, other, lockedAlong(other));
          },
          record: () => clone(state),
          standard: () => {
            const box = renderField({ ...field, control: undefined } as Field, path, lockedAbove, { ...extra, hideLabel: true });
            box.classList.add("vc-plugin-standard");
            // The field is the outer box (the plugin's): the standard one inside does not claim its place.
            box.removeAttribute("data-path");
            return { element: box, show: registry.get(pathText(path))?.show };
          },
        });
        control = made.element;
        show = made.show;
      } catch (error) { control = pluginProblem(doc, plugged.plugin, error); }
      return wrap({ ...common, group: false, control, inputId: id, show });
    }
    switch (field.type) {
      case "text": {
        const { control, id, show } = textInput(field, path, disabled);
        return wrap({ ...common, group: false, control, inputId: id, show });
      }
      case "richText": {
        const { control, id, show } = richInput(field, path, disabled);
        const wrapper = wrap({ ...common, group: false, control, inputId: id, show });
        // A label cannot point at an editable area: clicking it focuses the editor.
        wrapper.querySelector(".vc-label")?.addEventListener("click", () => (wrapper.querySelector<HTMLElement>("[data-vc-primary]:not([hidden])"))?.focus());
        return wrapper;
      }
      case "select": {
        const { control, id, show } = selectInput(field, path, disabled);
        return wrap({ ...common, group: false, control, inputId: id, show });
      }
      case "pick": {
        const { control, id, show } = pickInput(field, path, disabled);
        return wrap({ ...common, group: false, control, inputId: id, show });
      }
      case "number": {
        const { control, id, show } = numberInput(field, path, disabled);
        return wrap({ ...common, group: false, control, inputId: id, show });
      }
      case "link": {
        const { control, id, show, inputs, describedBy } = linkInput(field, path, disabled);
        const note = options.previewNotes ? h(doc, "span", { class: "vc-preview-only" }, LINK_PREVIEW_NOTE) : undefined;
        const wrapper = wrap({ ...common, group: false, control, inputId: id, show, extraHelp: note });
        // The page list and the address box (one on screen at a time) both read the help, "Opens: …" and the error.
        const described = [wrapper.querySelector(":scope > .vc-help")?.id, describedBy, wrapper.querySelector(":scope > .vc-error")?.id].filter(Boolean).join(" ");
        for (const input of inputs) input.setAttribute("aria-describedby", described);
        return wrapper;
      }
      case "phone": {
        const { control, id, show } = phoneInput(path, disabled);
        return wrap({ ...common, group: false, control, inputId: id, show });
      }
      case "toggle": {
        if (options.switchField && pathText(path) === options.switchField.path) {
          const { control, show } = switchInput(field, path, disabled, options.switchField);
          return wrap({ ...common, field: { ...shown, help: undefined }, group: false, control, show, hideLabel: true });
        }
        const { control, show } = toggleInput(field, path, disabled);
        return wrap({ ...common, field: { ...shown, help: undefined }, group: false, control, show });
      }
      case "image": { const { control, show } = imageInput(field, path, disabled, shown.label, extra.setMain); return wrap({ ...common, group: true, control, show }); }
      case "hours": return wrap({ ...common, group: true, control: hoursInput(path, disabled).control });
      case "object": {
        const box = h(doc, "div", { class: "vc-object" });
        renderFields(field.fields, path, locked || Boolean(reason), box);
        const wrapper = wrap({ ...common, group: true, control: box });
        // M3c: `flat` — in the inspector its fields are the section's own (CSS: .vc-inspector .vc-sole).
        if (field.flat) wrapper.classList.add("vc-sole");
        return wrapper;
      }
      case "list": return wrap({ ...common, group: true, control: listInput(field, path, disabled).control });
      case "tuple": {
        // P12d: one field per place of the stored list, side by side.
        const box = h(doc, "div", { class: "vc-object vc-tuple" });
        field.items.forEach((item, index) => box.append(renderField(item, [...path, index], locked || Boolean(reason))));
        return wrap({ ...common, group: true, control: box });
      }
      case "reference": {
        const { control, id, group } = referenceInput(field, path, disabled);
        return wrap({ ...common, group, control, inputId: id });
      }
    }
  }

  function renderFields(fields: Record<string, Field>, base: Path, locked: boolean, into: HTMLElement, only?: string[]) {
    for (const [key, field] of Object.entries(fields)) if (!only || only.includes(key)) into.append(renderField(field, [...base, ...keyPath(key)], locked));
  }

  const element = h(doc, "div", { class: "vc-form" });
  const general = h(doc, "div", { class: "vc-form-errors", role: "alert", hidden: true });
  element.append(general);
  const sections = options.sections?.filter((section) => section.fields.some((key) => topKeyOf(options.fields, key) !== undefined)) ?? [];
  if (sections.length) {
    // M3c: a field shown in parts (sections that point into it) is placed too.
    const placed = new Set(sections.flatMap((section) => section.fields.map((key) => topKeyOf(options.fields, key)).filter((key): key is string => Boolean(key))));
    const rest = Object.keys(options.fields).filter((key) => !placed.has(key));
    const groups = [...sections, ...(rest.length ? [{ key: "_other", label: "Other", fields: rest }] : [])];
    for (const section of groups) {
      const headingId = uid("s");
      const box = h(doc, "section", { class: "vc-section", "aria-labelledby": headingId, "data-section": section.key }, h(doc, "h2", { id: headingId, class: "vc-section-title" }, section.label));
      // Keep the config's field order inside a section, as the section lists them.
      for (const key of section.fields) {
        if (key in options.fields) { renderFields({ [key]: options.fields[key] }, [], false, box); continue; }
        // M3c: a path into a field — an object's field, an item of a fixed list.
        const path = parsePathText(key);
        const found = fieldAt(options.fields, path);
        if (found && !found.rest.length && getAt(state, path.slice(0, -1)) !== undefined) box.append(renderField(found.field, path, lockedAlong(path)));
      }
      markSole(box);
      element.append(box);
    }
  } else { renderFields(options.fields, [], false, element); markSole(element); }

  /** M3c: locked for this person by a field on the way to `path` (a locked list / object holds what is inside). */
  function lockedAlong(path: Path) {
    if (owner) return false;
    for (let length = 1; length < path.length; length += 1) {
      const found = fieldAt(options.fields, path.slice(0, length));
      if (found && !found.rest.length && isAdminOnly(found.field.locked)) return true;
    }
    return false;
  }

  /** M3b: a section that is one object shows that object's fields as its own (the Mr Spa CMS lists them flat). */
  function markSole(box: HTMLElement) {
    const children = [...box.children].filter((child) => child.classList.contains("vc-field"));
    if (children.length === 1 && children[0].classList.contains("vc-field-object")) children[0].classList.add("vc-sole");
  }

  function focusPath(path: string) { const target = registry.get(path)?.inputs().find((input) => !(input as HTMLInputElement).disabled); target?.focus(); return Boolean(target); }

  const clearErrors = () => {
    general.hidden = true;
    clear(general);
    for (const entry of registry.values()) {
      entry.error.hidden = true;
      entry.error.textContent = "";
      entry.wrapper.classList.remove("vc-invalid");
      for (const input of entry.inputs()) input.removeAttribute("aria-invalid");
    }
  };

  return {
    element,
    editors,
    ready: Promise.all([...editors.values()].map((editor) => editor.ready)).then(() => undefined),
    value: () => clone(state),
    setValue: (path, value) => { setAt(state, path, value); registry.get(pathText(path))?.show?.(value); changed(path); },
    clearErrors,
    showErrors: (problems) => {
      clearErrors();
      let placed = 0;
      const loose: Problem[] = [];
      for (const problem of problems) {
        let key = problem.path;
        // "footerLinks[0].links[1].href" → the closest field that is on screen.
        while (key && !registry.has(key)) key = /^(.*?)(\.[^.[\]]+|\[[^\]]*\])$/.exec(key)?.[1] ?? "";
        const entry = key ? registry.get(key) : undefined;
        if (!entry) { loose.push(problem); continue; }
        placed += 1;
        entry.error.hidden = false;
        entry.error.textContent = [entry.error.textContent, problem.message].filter(Boolean).join(" · ");
        entry.wrapper.classList.add("vc-invalid");
        for (const input of entry.inputs()) input.setAttribute("aria-invalid", "true");
      }
      // M3 (Mr Spa): the summary at the top — "1 validation error" / "N validation errors", one button per problem
      // ("Label: message") that goes to its field; a problem with no field on screen is named by its path.
      if (problems.length) {
        general.hidden = false;
        const entries = problems.map((problem) => {
          let key = problem.path;
          while (key && !registry.has(key)) key = /^(.*?)(\.[^.[\]]+|\[[^\]]*\])$/.exec(key)?.[1] ?? "";
          const entry = key ? registry.get(key) : undefined;
          const text = `${entry?.label ?? problem.path}: ${problem.message}`.replace(/^: /, "");
          return h(doc, "li", {}, entry
            ? h(doc, "button", { type: "button", class: "vc-link-button vc-error-link", onclick: () => { if (options.reveal) options.reveal(key); else focusPath(key); } }, text)
            : text);
        });
        general.append(h(doc, "strong", {}, problems.length === 1 ? "1 validation error" : `${problems.length} validation errors`), h(doc, "ul", {}, entries));
      }
      return placed;
    },
    focus: (path) => focusPath(path),
    invalidLinks: () => invalidLinks(element),
  };
};
