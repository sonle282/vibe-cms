/**
 * M5 / M11: where the live content uses each image — for the image sheet and the Media screen (the Mr Spa CMS's chips
 * "Pages", a collection, "Not used"; "Used on Home +4" under a tile; the detail panel's "Used on" rows that open the
 * exact field). Pure: the API reads the content and passes it in, as addresses.
 *
 * Images are found in image fields (src and mobile), in rich text (<img src>) and in a Markdown body (![…](src)).
 */
import type { Field } from "../config/index.js";

/**
 * One place an image is used: `label` = the page or record ("Salon info", "Alex Example"), `group` = "Pages" or the
 * collection; M11: `resource` ("file:site", "item:team:alex"), `path` (the field, "hero.image", "gallery[1]") and
 * `detail` (the field's name, "Picture", "Photo 2").
 */
export type ImagePlace = { label: string; group: string; resource?: string; path?: string; detail?: string };
export type ImageUsage = Record<string, ImagePlace[]>;
/** The Mr Spa CMS keeps at most 40 places per image. */
export const MAX_PLACES = 40;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const HTML_IMAGE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const join = (base: string, key: string | number) => (typeof key === "number" ? `${base}[${key}]` : KEY.test(key) ? (base ? `${base}.${key}` : key) : `${base}[${JSON.stringify(key)}]`);

/** Every image of one record with its field (path) and the field's name; `markdown` = also its Markdown body. */
export const imagePlacesOfRecord = (fields: Record<string, Field>, record: unknown, markdown?: string) => {
  const found: Array<{ src: string; path: string; detail: string }> = [];
  const add = (value: unknown, path: string, detail: string) => { if (typeof value === "string" && value.trim()) found.push({ src: value.trim(), path, detail }); };
  const rich = (value: unknown, path: string, detail: string) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(HTML_IMAGE)) add(match[1] ?? match[2], path, detail);
    for (const match of value.matchAll(MARKDOWN_IMAGE)) add(match[1], path, detail);
  };
  const one = (field: Field, value: unknown, path: string, detail: string) => {
    switch (field.type) {
      case "image":
        if (typeof value === "string") add(value, path, detail);
        else if (isRecord(value)) { add(value.src, path, detail); add(value.mobile, path, `${detail} (mobile)`); }
        return;
      case "richText": rich(value, path, detail); return;
      case "object": if (isRecord(value)) level(field.fields, value, path); return;
      case "list":
        if (Array.isArray(value)) value.forEach((item, index) => one(field.of, item, join(path, index), `${field.itemLabel ?? field.of.label} ${index + 1}`));
        return;
      case "tuple": if (Array.isArray(value)) field.items.forEach((item, index) => one(item, value[index], join(path, index), item.label)); return;
      default: return;
    }
  };
  // Dotted keys ("about.photo") are nested values.
  const level = (fieldsOf: Record<string, Field>, value: Record<string, unknown>, base: string) => {
    for (const [key, field] of Object.entries(fieldsOf)) {
      let at: unknown = value;
      for (const part of key.split(".")) at = isRecord(at) ? at[part] : undefined;
      if (at !== undefined) one(field, at, base ? `${base}.${key}` : key, field.label);
    }
  };
  if (isRecord(record)) level(fields, record, "");
  if (markdown !== undefined) rich(markdown, "body", "Text");
  return found;
};

/** The image addresses of one record (each once). */
export const imagesOfRecord = (fields: Record<string, Field>, record: unknown, markdown?: string): string[] => [...new Set(imagePlacesOfRecord(fields, record, markdown).map((place) => place.src))];

/** Add one record's images to the usage map: one place per field that shows the image (at most 40 per image). */
export const addUsage = (usage: ImageUsage, found: Array<string | { src: string; path?: string; detail?: string }>, place: ImagePlace) => {
  for (const entry of found) {
    const { src, ...where } = typeof entry === "string" ? { src: entry } : entry;
    const list = (usage[src] ??= []);
    if (list.length < MAX_PLACES) list.push({ ...place, ...where });
  }
  return usage;
};
