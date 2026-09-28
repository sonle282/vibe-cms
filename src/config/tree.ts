/**
 * Shared helpers for walking content by its field schema (content check, lock check). No Node APIs — runs in the Worker.
 */
import type { Field } from "./index.js";

export type FieldTree = Map<string, Field | FieldTree>;

/** Dotted keys ("about.title") become nested levels so the content can be walked like the JSON. */
export const toTree = (fields: Record<string, Field>): FieldTree => {
  const tree: FieldTree = new Map();
  for (const [key, field] of Object.entries(fields)) {
    const parts = key.split(".");
    let level = tree;
    parts.slice(0, -1).forEach((part) => {
      const next = level.get(part);
      if (next instanceof Map) level = next;
      else { const created: FieldTree = new Map(); level.set(part, created); level = created; }
    });
    level.set(parts.at(-1) as string, field);
  }
  return tree;
};

/** A readable path step: .name for identifiers, ["odd key"] otherwise. */
export const pathStep = (base: string, key: string) => {
  const step = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
  return base ? `${base}${step}` : step.replace(/^\./, "");
};

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
