/**
 * M5: where the live content uses each image — for the image sheet (the Mr Spa CMS's chips "Pages", a collection,
 * "Not used", and "Used on Home +4" under a tile). Pure: the API reads the content and passes it in, as addresses.
 *
 * Images are found in image fields (src and mobile), in rich text (<img src>) and in a Markdown body (![…](src)).
 */
import type { Field } from "../config/index.js";

export type ImagePlace = { label: string; group: string };
export type ImageUsage = Record<string, ImagePlace[]>;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const HTML_IMAGE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** The image addresses of one record (its fields; `markdown` = also its Markdown body). */
export const imagesOfRecord = (fields: Record<string, Field>, record: unknown, markdown?: string): string[] => {
  const found = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && value.trim()) found.add(value.trim()); };
  const rich = (value: unknown) => { if (typeof value !== "string") return; for (const match of value.matchAll(HTML_IMAGE)) add(match[1] ?? match[2]); for (const match of value.matchAll(MARKDOWN_IMAGE)) add(match[1]); };
  const one = (field: Field, value: unknown) => {
    switch (field.type) {
      case "image": if (typeof value === "string") add(value); else if (isRecord(value)) { add(value.src); add(value.mobile); } return;
      case "richText": rich(value); return;
      case "object": if (isRecord(value)) level(field.fields, value); return;
      case "list": if (Array.isArray(value)) for (const item of value) one(field.of, item); return;
      case "tuple": if (Array.isArray(value)) field.items.forEach((item, index) => one(item, value[index])); return;
      default: return;
    }
  };
  // Dotted keys ("about.photo") are nested values.
  const level = (fieldsOf: Record<string, Field>, value: Record<string, unknown>) => {
    for (const [key, field] of Object.entries(fieldsOf)) {
      let at: unknown = value;
      for (const part of key.split(".")) at = isRecord(at) ? at[part] : undefined;
      if (at !== undefined) one(field, at);
    }
  };
  if (isRecord(record)) level(fields, record);
  if (markdown !== undefined) rich(markdown);
  return [...found];
};

/** Add one record's places to the usage map (each image once per record). */
export const addUsage = (usage: ImageUsage, images: string[], place: ImagePlace) => {
  for (const src of images) (usage[src] ??= []).push(place);
  return usage;
};
