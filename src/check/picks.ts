/**
 * P12g: the choices of `pick` fields — a value that points to something inside the same record, e.g. a price written
 * once in the menu and used elsewhere as { "of": "packages/the-essential-reset" }. The site computes the choices from
 * the record's content (its `choices` function, in cms.config); this runs on the server (build check, save, publish,
 * the editor's view) and the admin gets the result, by place:
 *
 *   "fromPrice.of", "highlights[].of" (any item of a list), "price[1]" (the 2nd place of a tuple)
 *
 * Pure (no Node, no DOM): the admin uses `pickPlace` to find its field's choices in the view.
 */
import type { Field, PickChoice } from "../config/index.js";

export type PickChoices = Record<string, PickChoice[]>;

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

/** Every pick field of a record with its choices; a `choices` function that throws gives none (and a problem). */
export const pickChoices = (fields: Record<string, Field>, content: unknown, onError?: (place: string, error: unknown) => void): PickChoices => {
  const out: PickChoices = {};
  const record = content && typeof content === "object" && !Array.isArray(content) ? (content as Record<string, unknown>) : {};
  const walk = (field: Field, place: string) => {
    switch (field.type) {
      case "pick": {
        if (typeof field.choices !== "function") return;
        try {
          const list = field.choices(record);
          out[place] = Array.isArray(list) ? list.filter((choice) => choice && typeof choice.value === "string").map((choice) => ({ value: choice.value, label: String(choice.label ?? choice.value), ...(choice.group ? { group: String(choice.group) } : {}) })) : [];
        } catch (error) { out[place] = []; onError?.(place, error); }
        return;
      }
      case "object": for (const [key, child] of Object.entries(field.fields)) walk(child, join(place, key)); return;
      case "list": walk(field.of, `${place}[]`); return;
      case "tuple": field.items.forEach((item, index) => walk(item, `${place}[${index}]`)); return;
      default: return;
    }
  };
  for (const [key, field] of Object.entries(fields)) walk(field, key);
  return out;
};

/** The place of a value path in pickChoices: list indexes become "[]", tuple places stay "[n]". */
export const pickPlace = (fields: Record<string, Field>, path: Array<string | number>) => {
  let place = "";
  let current: Field | undefined;
  let level: Record<string, Field> | undefined = fields;
  for (let index = 0; index < path.length; index += 1) {
    const step = path[index];
    if (typeof step === "number") {
      if (current?.type === "list") { place += "[]"; current = current.of; }
      else if (current?.type === "tuple") { place += `[${step}]`; current = current.items[step]; }
      else return undefined;
      level = current?.type === "object" ? current.fields : undefined;
      continue;
    }
    // Dotted field keys ("about.title") take several steps of the path.
    if (!level) return undefined;
    let key = String(step);
    while (!(key in level) && index + 1 < path.length && typeof path[index + 1] === "string") { index += 1; key = `${key}.${path[index]}`; }
    current = level[key];
    if (!current) return undefined;
    place = join(place, key);
    level = current.type === "object" ? current.fields : undefined;
  }
  return place;
};
