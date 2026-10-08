/**
 * P8: what a draft changes, in plain words, field by field — for the review screen before publishing.
 * Pure (no DOM): the live value and the draft value are compared through the fields of cms.config, so the summary
 * speaks in the labels people see in the form ("Price: $35 → $40", "Added Link “Blog”", "Changed the order of
 * Featured services"). List items are matched by `id` when they have one, else by identical content; what is left is
 * compared position by position.
 */
import type { Field } from "../config/index.js";
import { getAt, isRecord, keyPath, pathText, same, type Path } from "./value.js";

export type ChangeKind = "changed" | "added" | "removed" | "moved" | "created";
export type Change = {
  /** Where, as the value checker writes paths (hero.title, footerLinks[0].links[1]). */
  path: string;
  /** Where, in the form's words ("Banner › Heading"). */
  label: string;
  kind: ChangeKind;
  before?: string;
  after?: string;
  /** The field is owner-only (`locked: "owner"`). */
  locked?: boolean;
};
export type ReferenceLabels = Record<string, Record<string, string>>;
export type SummaryInput = {
  fields: Record<string, Field>;
  before: unknown;
  after: unknown;
  /** Record labels by collection key and id, for reference fields. */
  references?: ReferenceLabels;
  /** For a record that is not live yet. */
  newRecord?: { itemLabel: string; title: string };
};

const MAX = 140;
const short = (text: string) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > MAX ? `${flat.slice(0, MAX - 1)}…` : flat; };
const empty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri 09:00–19:00 · Sat 09:00–17:00 · Sun closed" */
export const formatHours = (value: unknown) => {
  if (!Array.isArray(value) || !value.length) return "";
  return value.map((row) => {
    if (!isRecord(row)) return "?";
    const days = Array.isArray(row.days) ? [...(row.days as number[])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [];
    const order = days.map((day) => (day + 6) % 7);
    const contiguous = order.length > 2 && order.every((day, index) => index === 0 || day === order[index - 1] + 1);
    const when = contiguous ? `${DAY_NAMES[days[0]]}–${DAY_NAMES[days[days.length - 1]]}` : days.map((day) => DAY_NAMES[day] ?? "?").join(", ");
    return `${when} ${row.closed === true ? "closed" : `${row.open ?? "?"}–${row.close ?? "?"}`}`;
  }).join(" · ");
};

export const summarizeChanges = ({ fields, before, after, references = {}, newRecord }: SummaryInput): Change[] => {
  const out: Change[] = [];
  if (newRecord && (before === undefined || before === null)) {
    out.push({ path: "", label: `New ${newRecord.itemLabel.toLowerCase()}`, kind: "created", after: newRecord.title });
    return out;
  }

  const refLabel = (to: string, id: unknown) => (typeof id === "string" ? references[to]?.[id] ?? id : "");
  const show = (field: Field, value: unknown): string => {
    if (value === undefined || value === null) return "";
    switch (field.type) {
      case "text": case "select": return short(String(value));
      case "richText": return short(String(value).replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, " ").replace(/<[^>]*>/g, ""));
      case "image": return typeof value === "string" ? value : isRecord(value) ? String(value.src ?? "") : "";
      case "hours": return formatHours(value);
      case "reference": return Array.isArray(value) ? value.map((id) => refLabel(field.to, id)).join(", ") : refLabel(field.to, value);
      case "object": return isRecord(value) ? short(Object.values(value).filter((entry) => typeof entry === "string").join(", ")) : "";
      case "list": return Array.isArray(value) ? `${value.length} item${value.length === 1 ? "" : "s"}` : "";
    }
  };
  const itemSummary = (field: Field, value: unknown) => {
    if (field.type === "object" && isRecord(value)) {
      for (const [key, child] of Object.entries(field.fields)) {
        const inner = getAt(value, keyPath(key));
        if ((child.type === "text" || child.type === "select") && typeof inner === "string" && inner) return short(inner);
      }
      return "";
    }
    return show(field, value);
  };
  const push = (change: Change) => out.push(change);
  const kindOf = (b: unknown, a: unknown): ChangeKind => (empty(b) ? "added" : empty(a) ? "removed" : "changed");

  const compare = (field: Field, b: unknown, a: unknown, label: string, path: Path, locked: boolean) => {
    if (same(b, a) || (empty(b) && empty(a))) return;
    const isLocked = locked || field.locked === "owner";
    const where = pathText(path);
    switch (field.type) {
      case "object":
        if ((isRecord(b) || empty(b)) && (isRecord(a) || empty(a))) { walk(field.fields, isRecord(b) ? b : {}, isRecord(a) ? a : {}, label, path, isLocked); return; }
        break;
      case "image": {
        const parts = (value: unknown) => (typeof value === "string" ? { src: value, alt: "", mobile: "" } : isRecord(value) ? { src: String(value.src ?? ""), alt: String(value.alt ?? ""), mobile: String(value.mobile ?? "") } : { src: "", alt: "", mobile: "" });
        const [pb, pa] = [parts(b), parts(a)];
        if (pb.src !== pa.src) push({ path: where, label, kind: kindOf(pb.src, pa.src), before: pb.src, after: pa.src, ...(isLocked ? { locked: true } : {}) });
        if (pb.alt !== pa.alt) push({ path: `${where}.alt`, label: `${label} › alt text`, kind: kindOf(pb.alt, pa.alt), before: short(pb.alt), after: short(pa.alt), ...(isLocked ? { locked: true } : {}) });
        if (pb.mobile !== pa.mobile) push({ path: `${where}.mobile`, label: `${label} › image for phones`, kind: kindOf(pb.mobile, pa.mobile), before: pb.mobile, after: pa.mobile, ...(isLocked ? { locked: true } : {}) });
        return;
      }
      case "list":
        if ((Array.isArray(b) || empty(b)) && (Array.isArray(a) || empty(a))) { compareList(field.of, field.itemLabel ?? field.of.label, Array.isArray(b) ? b : [], Array.isArray(a) ? a : [], label, path, isLocked); return; }
        break;
      case "reference":
        if (field.multiple && (Array.isArray(b) || empty(b)) && (Array.isArray(a) || empty(a))) {
          const [ids0, ids1] = [Array.isArray(b) ? (b as unknown[]) : [], Array.isArray(a) ? (a as unknown[]) : []];
          for (const id of ids1) if (!ids0.includes(id)) push({ path: where, label, kind: "added", after: refLabel(field.to, id), ...(isLocked ? { locked: true } : {}) });
          for (const id of ids0) if (!ids1.includes(id)) push({ path: where, label, kind: "removed", before: refLabel(field.to, id), ...(isLocked ? { locked: true } : {}) });
          const kept0 = ids0.filter((id) => ids1.includes(id));
          const kept1 = ids1.filter((id) => ids0.includes(id));
          if (!same(kept0, kept1)) push({ path: where, label, kind: "moved", before: kept0.map((id) => refLabel(field.to, id)).join(", "), after: kept1.map((id) => refLabel(field.to, id)).join(", "), ...(isLocked ? { locked: true } : {}) });
          return;
        }
        break;
      default: break;
    }
    push({ path: where, label, kind: kindOf(b, a), before: show(field, b), after: show(field, a), ...(isLocked ? { locked: true } : {}) });
  };

  const compareList = (of: Field, itemLabel: string, b: unknown[], a: unknown[], label: string, path: Path, locked: boolean) => {
    const identity = (value: unknown) => (isRecord(value) && typeof value.id === "string" ? `id:${value.id}` : `json:${JSON.stringify(value)}`);
    // 1. The same items, in another order.
    if (b.length === a.length && [...b.map(identity)].sort().join("\n") === [...a.map(identity)].sort().join("\n") && b.every((item) => a.some((other) => same(item, other)))) {
      push({ path: pathText(path), label, kind: "moved", before: b.map((item) => itemSummary(of, item)).filter(Boolean).join(", "), after: a.map((item) => itemSummary(of, item)).filter(Boolean).join(", "), ...(locked ? { locked: true } : {}) });
      return;
    }
    // 2. Match items by identity; what is left is paired by position.
    const usedB = new Set<number>();
    const pairs: Array<[number, number]> = [];
    a.forEach((item, index) => {
      const found = b.findIndex((other, at) => !usedB.has(at) && identity(other) === identity(item));
      if (found >= 0) { usedB.add(found); pairs.push([found, index]); }
    });
    const pairedA = new Set(pairs.map(([, index]) => index));
    let restB = b.map((_, index) => index).filter((index) => !usedB.has(index));
    let restA = a.map((_, index) => index).filter((index) => !pairedA.has(index));
    // Objects are "the same item, edited" only when they still share a value; a wholly different one is removed + added.
    const related = (x: unknown, y: unknown) => !isRecord(x) || !isRecord(y) || Object.keys(x).some((key) => !empty(x[key]) && same(x[key], y[key]));
    const paired: Array<[number, number]> = [];
    for (const ia of restA) {
      const ib = restB.find((candidate) => !paired.some(([used]) => used === candidate) && related(b[candidate], a[ia]));
      if (ib !== undefined && (of.type !== "object" || related(b[ib], a[ia]))) paired.push([ib, ia]);
    }
    pairs.push(...paired);
    restB = restB.filter((index) => !paired.some(([ib]) => ib === index));
    restA = restA.filter((index) => !paired.some(([, ia]) => ia === index));
    pairs.sort((x, y) => x[1] - y[1]);
    const itemName = (value: unknown, index: number) => { const summary = itemSummary(of, value); return `${itemLabel} ${index + 1}${summary && of.type === "object" ? ` (${summary})` : ""}`; };
    for (const [ib, ia] of pairs) if (!same(b[ib], a[ia])) {
      if (of.type === "object" || of.type === "list" || of.type === "hours" || of.type === "image") compare(of, b[ib], a[ia], `${label} › ${itemName(a[ia], ia)}`, [...path, ia], locked);
      else push({ path: pathText([...path, ia]), label: `${label} › ${itemLabel} ${ia + 1}`, kind: kindOf(b[ib], a[ia]), before: show(of, b[ib]), after: show(of, a[ia]), ...(locked || of.locked ? { locked: true } : {}) });
    }
    for (const index of restA) push({ path: pathText([...path, index]), label: `${label} › ${itemLabel}`, kind: "added", after: itemSummary(of, a[index]) || `${itemLabel} ${index + 1}`, ...(locked ? { locked: true } : {}) });
    for (const index of restB) push({ path: pathText([...path, index]), label: `${label} › ${itemLabel}`, kind: "removed", before: itemSummary(of, b[index]) || `${itemLabel} ${index + 1}`, ...(locked ? { locked: true } : {}) });
    // 3. Items that stayed but changed places.
    const keptOrder = pairs.filter(([ib]) => usedB.has(ib)).map(([ib]) => ib);
    if (keptOrder.some((value, index) => index > 0 && value < keptOrder[index - 1])) push({ path: pathText(path), label, kind: "moved", before: "", after: "", ...(locked ? { locked: true } : {}) });
  };

  function walk(fieldSet: Record<string, Field>, b: Record<string, unknown>, a: Record<string, unknown>, prefix: string, base: Path, locked: boolean) {
    for (const [key, field] of Object.entries(fieldSet)) {
      const steps = keyPath(key);
      compare(field, getAt(b, steps), getAt(a, steps), prefix ? `${prefix} › ${field.label}` : field.label, [...base, ...steps], locked);
    }
  }

  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  walk(fields, b, a, "", [], false);
  // Keys the config does not describe (set by the site's code): mention them, never hide a change.
  const known = new Set(Object.keys(fields).map((key) => keyPath(key)[0]));
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) if (!known.has(key as string) && !same(b[key], a[key])) {
    const text = (value: unknown) => (value === undefined ? "" : short(typeof value === "string" ? value : JSON.stringify(value)));
    push({ path: pathText([key]), label: `${key} (not in the form)`, kind: kindOf(b[key], a[key]), before: text(b[key]), after: text(a[key]) });
  }
  return out;
};

/** One line of plain words for a change ("Price: $35 → $40"). */
export const describeChange = (change: Change) => {
  switch (change.kind) {
    case "created": return `${change.label}: ${change.after ?? ""}`.trim();
    case "added": return change.after ? `${change.label}: added “${change.after}”` : `${change.label}: added`;
    case "removed": return change.before ? `${change.label}: removed “${change.before}”` : `${change.label}: removed`;
    case "moved": return change.after ? `${change.label}: new order — ${change.after}` : `${change.label}: new order`;
    default: return `${change.label}: ${change.before || "(empty)"} → ${change.after || "(empty)"}`;
  }
};
