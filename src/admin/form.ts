/**
 * P7: the editing form, generated from a file's / collection's fields in cms.config — every field type: text (single /
 * multiline, maxLength counter), richText (P8d: the visual editor, src/admin/rich-editor.ts), image (address + alt + mobile), select, hours, object, list (ordered, min /
 * max, nested), reference (one / many, ordered), dotted keys ("seo.title"), sections.
 *
 * The form edits a copy of the content: keys it does not know (and keys nobody touched) stay exactly as they were, so
 * "no change" saves the same value and the writer keeps the file byte for byte. Fields locked for the owner are shown
 * to editors but cannot be changed (the server refuses anyway, P4): their inputs are disabled, a locked list / object
 * is disabled as a whole, and an editor cannot remove a list item that holds owner-only values (DESIGN §C.1).
 */
import type { Field, ImageField, ListField, ReferenceField, Section } from "../config/index.js";
import type { Role } from "../locks/index.js";
import { clear, h, icon, uid, type Child } from "./dom.js";
import { createRichEditor, type RichEditor, type RichEditorOptions } from "./rich-editor.js";
import { clone, emptyValue, getAt, holdsLockedValue, isRecord, keyPath, pathText, setAt, type Path } from "./value.js";

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
  pickImage?: (current: string, done: (image: { src: string; width?: number; height?: number }) => void) => void;
  /** P8d: top-level keys whose rich text is Markdown (a Markdown record's body); the rest is HTML. */
  markdown?: string[];
  /** P8d tests: how the visual editor loads its Markdown converter. */
  loadMarkdown?: RichEditorOptions["loadMarkdown"];
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
export const LOCK_HELP = "Only the owner can change this.";
export const OWNER_NOTE = "Editors see this but only an owner can change it.";

export const createForm = (options: FormOptions): Form => {
  const { doc, role } = options;
  const owner = role === "owner";
  const state: Record<string, unknown> = isRecord(options.value) ? clone(options.value) : {};
  const references = options.references ?? {};
  /** path text → the field's wrapper, error line and a way to show a new value. */
  const registry = new Map<string, { wrapper: HTMLElement; error: HTMLElement; inputs: () => HTMLElement[]; show?: (value: unknown) => void }>();
  const changed = (path: Path) => options.onChange?.(clone(state), path);
  const set = (path: Path, value: unknown) => { setAt(state, path, value); changed(path); };

  // ---------------------------------------------------------------- shared pieces

  const button = (label: string, name: string, onClick: () => void, disabled: boolean, extra: Record<string, string> = {}) =>
    h(doc, "button", { type: "button", class: `vc-icon-button vc-${name}`, "aria-label": label, title: label, disabled, onclick: (event: Event) => { event.preventDefault(); onClick(); }, ...extra }, icon(doc, name));

  const labelContent = (field: Field, locked: boolean, text = field.label): Child[] => [
    text,
    field.required ? h(doc, "span", { class: "vc-required", "aria-hidden": "true" }, " *") : null,
    field.required ? h(doc, "span", { class: "vc-sr-only" }, " (required)") : null,
    locked || (owner && field.locked === "owner") ? h(doc, "span", { class: "vc-lock", title: LOCK_HELP }, icon(doc, "lock"), h(doc, "span", { class: "vc-sr-only" }, " (owner only)")) : null,
  ];

  type Wrap = { path: Path; field: Field; locked: boolean; reason?: string; group: boolean; control: HTMLElement; inputId?: string; hideLabel?: boolean; show?: (value: unknown) => void; extraHelp?: Child };
  const wrap = ({ path, field, locked, reason, group, control, inputId, hideLabel, show, extraHelp }: Wrap) => {
    const text = pathText(path);
    const helpId = uid("help");
    const errorId = uid("err");
    const ownerNote = owner && field.locked === "owner" ? OWNER_NOTE : null;
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
    registry.set(text, { wrapper, error, inputs, show });
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
    const max = field.maxLength;
    const counter = max ? h(doc, "span", { class: "vc-counter", "aria-live": "polite" }) : null;
    const count = () => { if (counter && max) { counter.textContent = `${input.value.length} / ${max}`; counter.classList.toggle("vc-over", input.value.length > max); } };
    count();
    input.addEventListener("input", () => { count(); set(path, input.value === "" && wasAbsent ? undefined : input.value); });
    const show = (value: unknown) => { input.value = typeof value === "string" ? value : ""; count(); };
    return { control: counter ? h(doc, "div", { class: "vc-with-counter" }, input, counter) : input, id, show };
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
    const thumb = h(doc, "img", { class: "vc-thumb", alt: "", hidden: true });
    const showThumb = (value: string) => { const ok = /^(\/(?!\/)|https:\/\/)/.test(value); thumb.hidden = !ok; if (ok) thumb.setAttribute("src", value); else thumb.removeAttribute("src"); };
    showThumb(src);
    // P10: "Choose image…" opens the library / upload sheet; "Remove" empties the address (alt and phone image stay).
    const pickers = (target: { input: HTMLInputElement; element: HTMLElement }, label: string, afterPick?: () => void) => {
      if (!options.pickImage || disabled) return;
      const choose = h(doc, "button", { type: "button", class: "vc-button", "aria-label": `Choose ${label}`, onclick: () => options.pickImage?.(target.input.value, (image) => { target.input.value = image.src; update(); afterPick?.(); }) }, "Choose image…");
      const remove = h(doc, "button", { type: "button", class: "vc-button vc-quiet", "aria-label": `Remove ${label}`, onclick: () => { target.input.value = ""; update(); target.input.focus(); } }, "Remove");
      target.element.append(h(doc, "div", { class: "vc-image-actions" }, choose, remove));
    };
    pickers(srcPart, `the image for ${field.label}`, () => { if (altPart && !altPart.input.value) altPart.input.focus(); });
    if (mobilePart) pickers(mobilePart, `the phone image for ${field.label}`);
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
      showThumb(nextSrc);
      set(path, next);
    };
    for (const entry of [srcPart, altPart, mobilePart]) entry?.input.addEventListener("input", update);
    return { control: h(doc, "div", { class: "vc-image" }, thumb, h(doc, "div", { class: "vc-image-parts" }, srcPart.element, altPart?.element, mobilePart?.element)) };
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
        registry.set(pathText(rowPath), { wrapper: element, error, inputs: () => [...element.querySelectorAll<HTMLElement>("input")] });
        for (const key of ["days", "open", "close", "label", "closed"]) registry.set(pathText([...rowPath, key]), { wrapper: element, error, inputs: () => [...element.querySelectorAll<HTMLElement>("input")] });
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

  const listInput = (field: ListField, path: Path, locked: boolean) => {
    const items = h(doc, "div", { class: "vc-items" });
    const note = h(doc, "p", { class: "vc-note" });
    const itemLabel = field.itemLabel ?? field.of.label;
    const list = () => (Array.isArray(getAt(state, path)) ? (getAt(state, path) as unknown[]) : []);
    const primitive = !["object", "list", "hours", "image"].includes(field.of.type) && !(field.of.type === "reference" && field.of.multiple);
    const add = h(doc, "button", { type: "button", class: "vc-button vc-add" }, icon(doc, "plus"), ` Add ${itemLabel.toLowerCase()}`);
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
        const removeLabel = keepsLocked ? `Only the owner can delete ${name}: it holds owner-only values` : `Delete ${name}`;
        const actions = h(doc, "div", { class: "vc-item-actions" },
          field.ordered ? button(`Move ${name} up`, "up", () => { const next = clone(values); [next[index - 1], next[index]] = [next[index], next[index - 1]]; write(next, { index: index - 1, action: "up" }); }, locked || index === 0) : null,
          field.ordered ? button(`Move ${name} down`, "down", () => { const next = clone(values); [next[index + 1], next[index]] = [next[index], next[index + 1]]; write(next, { index: index + 1, action: "down" }); }, locked || index === values.length - 1) : null,
          button(removeLabel, "remove", () => { const next = clone(values); next.splice(index, 1); write(next, next.length ? { index: Math.min(index, next.length - 1), action: "remove" } : undefined); if (!next.length) add.focus(); }, locked || keepsLocked || values.length <= (field.min ?? 0)));
        // The card already says "Group 2": the item's own label is for screen readers only.
        const body = renderField(field.of, [...path, index], locked, { hideLabel: true, label: name });
        const summary = summaryOf(field.of, value);
        items.append(primitive
          ? h(doc, "div", { class: "vc-item vc-item-inline", role: "group", "aria-label": name }, body, actions)
          : h(doc, "div", { class: "vc-item", role: "group", "aria-label": summary ? `${name}: ${summary}` : name },
            h(doc, "div", { class: "vc-item-head" }, h(doc, "span", { class: "vc-item-title" }, name), summary ? h(doc, "span", { class: "vc-item-summary" }, summary) : null, actions), body));
      });
      const count = values.length;
      note.textContent = field.max ? `${count} of ${field.max} allowed.` : count ? "" : `No ${itemLabel.toLowerCase()} yet.`;
      note.hidden = !note.textContent;
      add.disabled = locked || (field.max !== undefined && count >= field.max);
    };
    add.addEventListener("click", () => { const next = clone(list()); next.push(emptyValue(field.of)); write(next, { index: next.length - 1, action: "add" }); });
    render();
    return { control: h(doc, "div", { class: "vc-list" }, note, items, add) };
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
    const locked = lockedAbove || (field.locked === "owner" && !owner);
    const reason = path.length === 1 ? options.readOnly?.[String(path[0])] : undefined;
    const disabled = locked || Boolean(reason);
    const shown = extra.label ? { ...field, label: extra.label } : field;
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
      case "image": return wrap({ ...common, group: true, control: imageInput(field, path, disabled).control });
      case "hours": return wrap({ ...common, group: true, control: hoursInput(path, disabled).control });
      case "object": {
        const box = h(doc, "div", { class: "vc-object" });
        renderFields(field.fields, path, locked || Boolean(reason), box);
        return wrap({ ...common, group: true, control: box });
      }
      case "list": return wrap({ ...common, group: true, control: listInput(field, path, disabled).control });
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
    const groups = [...sections, ...(rest.length ? [{ key: "_other", label: "More", fields: rest }] : [])];
    for (const section of groups) {
      const headingId = uid("s");
      const box = h(doc, "section", { class: "vc-section", "aria-labelledby": headingId, "data-section": section.key }, h(doc, "h2", { id: headingId, class: "vc-section-title" }, section.label));
      // Keep the config's field order inside a section, as the section lists them.
      for (const key of section.fields) if (key in options.fields) renderFields({ [key]: options.fields[key] }, [], false, box);
      element.append(box);
    }
  } else renderFields(options.fields, [], false, element);

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
      if (loose.length) {
        general.hidden = false;
        general.append(h(doc, "ul", {}, loose.map((problem) => h(doc, "li", {}, problem.path ? `${problem.path}: ${problem.message}` : problem.message))));
      }
      return placed;
    },
    focus: (path) => { const target = registry.get(path)?.inputs().find((input) => !(input as HTMLInputElement).disabled); target?.focus(); return Boolean(target); },
  };
};
