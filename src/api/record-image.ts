import type { Field } from "../config/index.js";

const srcOf = (value: unknown) =>
  typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { src?: unknown }).src === "string" ? String((value as { src: string }).src) : "";

/**
 * U4: a record's thumbnail in its collection's list — the first image field that has one; else (F7, 2026-10-29) the
 * first image of its first list of images, e.g. a product whose Main image is empty shows its first Gallery photo, as
 * the website's product cards do. Before, a list of 83 Mr Spa products showed 83 grey boxes.
 */
export const recordThumbnail = (fields: Record<string, Field>, record: unknown): string | undefined => {
  const data = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== "image") continue;
    const src = srcOf(data[key]);
    if (src) return src;
  }
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== "list" || field.of.type !== "image" || !Array.isArray(data[key])) continue;
    const src = (data[key] as unknown[]).map(srcOf).find(Boolean);
    if (src) return src;
  }
  return undefined;
};
