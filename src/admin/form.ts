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
import type { Field, ImageField, ListField, ReferenceField, Section } from "../config/index.js";
import { isAdminOnly } from "../config/roles.js";
import type { Role } from "../locks/index.js";
import { clear, h, icon, uid, type Child } from "./dom.js";
import { createRichEditor, type RichEditor, type RichEditorOptions } from "./rich-editor.js";
import { clone, emptyValue, getAt, holdsLockedValue, isRecord, keyPath, pathText, setAt, slugify, type Path } from "./value.js";
import { pickPlace, type PickChoices } from "../check/picks.js";

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
  pickImage?: (current: string, done: (image: { src: string; width?: number; height?: number }) => void, label?: string) => void;
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
  /** P8d: the visual editors on the form (rich text, Markdown body), by path text; `ready` once all show their value. */
  editors: Map<string, RichEditor>;
  ready: Promise<void>;
};

const DAYS: Array<[number, string, string]> = [[1, "Mon", "Monday"], [2, "Tue", "Tuesday"], [3, "Wed", "Wednesday"], [4, "Thu", "Thursday"], [5, "Fri", "Friday"], [6, "Sat", "Saturday"], [0, "Sun", "Sunday"]];
export const LOCK_HELP = "Only an admin can change this.";
export const OWNER_NOTE = "Editors see this but only an admin can change it.";

export const createForm = (options: FormOptions): Form => {
  const { doc, role } = options;
  const owner = role === "owner";
  const state: Record<string, unknown> = isRecord(options.value) ? clone(options.value) : {};
  const references = options.references ?? {};
  /** path text → the field's wrapper, error line and a way to show a new value. */
  const registry = new Map<string, { wrapper: HTMLElement; error: HTMLElement; inputs: () => HTMLElement[]; show?: (value: unknown) => void; label: string }>();
  const changed = (path: Path) => options.onChange?.(clone(state), path);
  // P16a: ids made from a name while the item is new — by the source field's place, what to fill and whether it still follows.
  const following = new Map<string, { target: Path; show: (value: unknown) => void; on: boolean }>();
  const set = (path: Path, value: unknown) => {
    setAt(state, path, value);
    changed(path);
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
    locked || (owner && isAdminOnly(field.locked)) ? h(doc, "span", { class: "vc-lock", title: LOCK_HELP }, icon(doc, "lock"), h(doc, "span", { class: "vc-sr-only" }, " (admin only)")) : null,
  ];

  type Wrap = { path: Path; field: Field; locked: boolean; reason?: string; group: boolean; control: HTMLElement; inputId?: string; hideLabel?: boolean; show?: (value: unknown) => void; extraHelp?: Child };
  const wrap = ({ path, field, locked, reason, group, control, inputId, hideLabel, show, extraHelp }: Wrap) => {
    const text = pathText(path);
    const helpId = uid("help");
    const errorId = uid("err");
    const ownerNote = owner && isAdminOnly(field.locked) ? OWNER_NOTE : null;
    const notes = [field.help, locked ? LOCK_HELP : null, ownerNote, reason].filter(Boolean).join(" ");
    const help = notes || extraHelp ? h(doc, "p", { class: "vc-help", id: helpId }, notes, extraHelp ? " " : null, extraHelp) : null;
    const error = h(doc, "p", { class: "vc-error", id: errorId, hidden: true });
    const label = group
      ? h(doc, "legend", { class: hideLabel ? "vc-label vc-sr-only" : "vc-label" }, ...labelContent(field, locked))
      : h(doc, "label", { class: hideLabel ? "vc-label vc-sr-only" : "vc-label", for: inputId, id: inputId ? `${inputId}-label` : undefined }, ...labelContent(field, locked));
    const wrapper = h(doc, group ? "fieldset" : "div", { class: `vc-field vc-field-${field.type}${locked || reason ? " vc-locked" : ""}`, "data-path": text, "data-type": field.type, ...(group && (locked || reason) ? { disabled: true } : {}) }, label, control, help, error);
    const described = [help ? helpId : null, errorId].filter(Boolean).join(" ");
    // The visible main control first (a visual editor's area or its source box), then everything else.
    const inputs = () => [...new Set([...wrapper.querySelectorAll<HTMLElement>("[data-vc-primary]:not([hidden])"), ...wrapper.querySelectorAll<HTMLElement>("input, select, textarea")])];
    for (const input of inputs()) if (!input.getAttribute("aria-describedby")) input.setAttribute("aria-describedby", described);
    registry.set(text, { wrapper, error, inputs, show, label: field.label });
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
    });
    editor.area.setAttribute("aria-labelledby", `${id}-label`);
    editors.set(pathText(path), editor);
    return { control: editor.element, id, show: (value: unknown) => editor.setValue(typeof value === "string" ? value : "") };
  };

  const textInput = (field: Extract<Field, { type: "text" }>, path: Path, disabled: boolean) => {
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

  // P12g: toggle — a checkbox; unticking a value that was never set leaves it out again.
  const toggleInput = (field: Extract<Field, { type: "toggle" }>, path: Path, disabled: boolean) => {
    const id = uid("f");
    const wasAbsent = getAt(state, path) === undefined;
    const box = h(doc, "input", { id, type: "checkbox", class: "vc-toggle-box", disabled });
    box.checked = getAt(state, path) === true;
    box.addEventListener("change", () => set(path, box.checked ? true : wasAbsent ? undefined : false));
    return { control: h(doc, "span", { class: "vc-check" }, box, h(doc, "label", { for: id }, field.help ?? "Yes")), id, show: (value: unknown) => { box.checked = value === true; } };
  };

  const imageInput = (field: ImageField, path: Path, disabled: boolean) => {
    const current = getAt(state, path);
    const wasAbsent = current === undefined;
    const record = isRecord(current) ? current : {};
    const src = typeof current === "string" ? current : typeof record.src === "string" ? record.src : "";
    const part = (label: string, value: string, placeholder: string) => {
      const id = uid("f");
      const input = h(doc, "input", { id, type: "text", class: "vc-input", disabled, placeholder, autocomplete: "off" });
      input.value = value;
      return { input, element: h(doc, "div", { class: "vc-subfield" }, h(doc, "label", { for: id, class: "vc-sublabel" }, label), input) };
    };
    const srcPart = part("Image address", src, "/images/photo.jpg");
    const altPart = field.alt || typeof record.alt === "string" ? part("Alt text (describes the image)", typeof record.alt === "string" ? record.alt : "", "e.g. Pedicure chair by the window") : null;
    const mobilePart = field.mobile || typeof record.mobile === "string" ? part("Image for phones (optional)", typeof record.mobile === "string" ? record.mobile : "", "/images/photo-mobile.jpg") : null;
    // U3: the image card of the Mr Spa CMS — the picture as it is (contain, on the canvas colour), its file name and
    // size; hover / focus shows Replace; ⋯ = Copy image link · Remove image; Desktop / Phone when there is a phone image.
    // The address inputs stay under it (an address can also be typed).
    const usable = (value: string) => /^(\/(?!\/)|https:\/\/)/.test(value);
    const thumb = h(doc, "img", { class: "vc-thumb", alt: "", hidden: true });
    const empty = h(doc, "span", { class: "vc-image-empty" }, "No image yet");
    const fileName = h(doc, "span", { class: "vc-image-name" });
    const fileSize = h(doc, "span", { class: "vc-image-size" });
    let target = srcPart;
    const describe = () => (target === srcPart ? `the image for ${field.label}` : `the phone image for ${field.label}`);
    const showThumb = () => {
      const value = target.input.value;
      const ok = usable(value);
      thumb.hidden = !ok; empty.hidden = ok;
      if (ok) { if (thumb.getAttribute("src") !== value) { fileSize.textContent = ""; thumb.setAttribute("src", value); } } else { thumb.removeAttribute("src"); fileSize.textContent = ""; }
      fileName.textContent = value ? decodeURIComponent(value.split(/[?#]/)[0].split("/").pop() || value) : "";
      for (const button of card.querySelectorAll<HTMLElement>("[data-image-action]")) {
        const action = button.dataset.imageAction;
        button.setAttribute("aria-label", `${action === "choose" ? "Choose" : action === "remove" ? "Remove" : "Copy the link of"} ${describe()}`);
        if (action === "choose" && button.classList.contains("vc-image-replace")) button.textContent = value ? "Replace" : "Choose image";
      }
      menuButton.hidden = !value;
      metaReplace.hidden = !value;
    };
    thumb.addEventListener("load", () => { if (thumb.naturalWidth) fileSize.textContent = `${thumb.naturalWidth} × ${thumb.naturalHeight}`; });
    const choose = () => {
      const before = target.input.value;
      const which = target;
      options.pickImage?.(before, (image) => {
        which.input.value = image.src;
        update();
        if (which === srcPart && altPart && !altPart.input.value) altPart.input.focus();
        if (before && before !== image.src) options.notify?.("Image replaced", { label: "Undo", run: () => { which.input.value = before; update(); } });
      }, field.label);
    };
    const menu = h(doc, "div", { class: "vc-menu vc-image-menu", role: "menu", hidden: true });
    const closeMenu = () => { menu.hidden = true; menuButton.setAttribute("aria-expanded", "false"); };
    const menuButton = h(doc, "button", { type: "button", class: "vc-icon-button vc-image-more", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "More for this image", "data-tooltip": "More", onclick: (event: Event) => { event.stopPropagation(); menu.hidden = !menu.hidden; menuButton.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLElement>("button")?.focus(); } }, h(doc, "span", { "aria-hidden": "true" }, "⋯"));
    menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); closeMenu(); menuButton.focus(); } });
    menu.append(
      h(doc, "button", { type: "button", class: "vc-menu-item", role: "menuitem", "data-image-action": "copy", onclick: async () => {
        closeMenu();
        const value = target.input.value;
        const address = /^https:\/\//.test(value) ? value : `${doc.defaultView?.location.origin ?? ""}${value}`;
        try { await doc.defaultView?.navigator.clipboard.writeText(address); options.notify?.("Image link copied"); } catch { options.notify?.(`Image link: ${address}`); }
      } }, "Copy image link"),
      h(doc, "button", { type: "button", class: "vc-menu-item vc-danger", role: "menuitem", "data-image-action": "remove", onclick: () => {
        closeMenu();
        const before = target.input.value;
        const which = target;
        which.input.value = ""; update(); which.input.focus();
        if (before) options.notify?.("Image removed", { label: "Undo", run: () => { which.input.value = before; update(); } });
      } }, "Remove image"));
    const canPick = Boolean(options.pickImage) && !disabled;
    const metaReplace = h(doc, "button", { type: "button", class: "vc-link-button", tabindex: "-1", "aria-hidden": "true", onclick: choose }, "Replace");
    const stage = h(doc, "div", { class: "vc-image-stage" }, thumb, empty,
      canPick ? h(doc, "div", { class: "vc-image-overlay" }, h(doc, "button", { type: "button", class: "vc-button vc-image-replace", "data-image-action": "choose", onclick: choose }, "Replace")) : null);
    if (canPick) thumb.addEventListener("click", choose);
    const devices = mobilePart ? h(doc, "div", { class: "vc-segment vc-image-devices", role: "group", "aria-label": "Which image" },
      ...([["Desktop", srcPart], ["Phone", mobilePart]] as const).map(([label, part]) => h(doc, "button", { type: "button", class: "vc-segment-item", "aria-pressed": String(part === srcPart), onclick: (event: Event) => {
        target = part;
        for (const button of devices!.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button === event.currentTarget));
        showThumb();
      } }, label))) : null;
    const card = h(doc, "div", { class: "vc-image-card" }, stage,
      h(doc, "div", { class: "vc-image-meta" }, h(doc, "span", { class: "vc-image-file" }, fileName, fileSize), canPick ? metaReplace : null),
      canPick ? h(doc, "div", { class: "vc-image-tools" }, devices, menuButton, menu) : devices ? h(doc, "div", { class: "vc-image-tools" }, devices) : null);
    doc.addEventListener("click", (event) => { if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu(); });
    showThumb();
    const update = () => {
      const now = getAt(state, path);
      const nextSrc = srcPart.input.value;
      const alt = altPart?.input.value ?? "";
      const mobile = mobilePart?.input.value ?? "";
      let next: unknown;
      if (isRecord(now) || alt || mobile) {
        const object: Record<string, unknown> = isRecord(now) ? { ...now } : {};
        object.src = nextSrc;
        for (const [key, value] of [["alt", alt], ["mobile", mobile]] as const) { if (value || key in object) object[key] = value; }
        next = object;
      } else next = nextSrc === "" && wasAbsent ? undefined : nextSrc;
      showThumb();
      set(path, next);
    };
    for (const entry of [srcPart, altPart, mobilePart]) entry?.input.addEventListener("input", update);
    return { control: h(doc, "div", { class: "vc-image" }, card, h(doc, "div", { class: "vc-image-parts" }, srcPart.element, altPart?.element, mobilePart?.element)) };
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

  const listInput = (field: ListField, path: Path, locked: boolean) => {
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
        const body = renderField(field.of, [...path, index], locked, { hideLabel: true, label: name });
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

  function renderField(field: Field, path: Path, lockedAbove: boolean, extra: { hideLabel?: boolean; label?: string } = {}): HTMLElement {
    const locked = lockedAbove || (isAdminOnly(field.locked) && !owner);
    const reason = path.length === 1 ? options.readOnly?.[String(path[0])] : undefined;
    const disabled = locked || Boolean(reason);
    // P12d: a text field says which {words} the website fills in and the format it needs.
    const hints = field.type === "text" ? [field.tokens?.length ? `Words the website fills in: ${field.tokens.map((token) => `{${token}}`).join(", ")}.` : "", field.patternHint ? `Format: ${field.patternHint}.` : ""].filter(Boolean).join(" ") : "";
    const withHints = hints ? { ...field, help: field.help ? `${field.help} ${hints}` : hints } : field;
    const shown = extra.label ? { ...withHints, label: extra.label } : withHints;
    const common = { path, field: shown, locked: locked && !lockedAbove, reason, hideLabel: extra.hideLabel };
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
      case "toggle": {
        const { control, show } = toggleInput(field, path, disabled);
        return wrap({ ...common, field: { ...shown, help: undefined }, group: false, control, show });
      }
      case "image": return wrap({ ...common, group: true, control: imageInput(field, path, disabled).control });
      case "hours": return wrap({ ...common, group: true, control: hoursInput(path, disabled).control });
      case "object": {
        const box = h(doc, "div", { class: "vc-object" });
        renderFields(field.fields, path, locked || Boolean(reason), box);
        return wrap({ ...common, group: true, control: box });
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
  const sections = options.sections?.filter((section) => section.fields.some((key) => key in options.fields)) ?? [];
  if (sections.length) {
    const placed = new Set(sections.flatMap((section) => section.fields));
    const rest = Object.keys(options.fields).filter((key) => !placed.has(key));
    const groups = [...sections, ...(rest.length ? [{ key: "_other", label: "Other", fields: rest }] : [])];
    for (const section of groups) {
      const headingId = uid("s");
      const box = h(doc, "section", { class: "vc-section", "aria-labelledby": headingId, "data-section": section.key }, h(doc, "h2", { id: headingId, class: "vc-section-title" }, section.label));
      // Keep the config's field order inside a section, as the section lists them.
      for (const key of section.fields) if (key in options.fields) renderFields({ [key]: options.fields[key] }, [], false, box);
      element.append(box);
    }
  } else renderFields(options.fields, [], false, element);

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
  };
};
