/**
 * P19: the site plugins that come with the package (cms.config.ts `plugins`) — checks of the whole site at build and
 * at publish, from what the Mr Spa CMS checks (src/lib/cms/catalog-*.ts, scripts/redirect-regression-check.mjs):
 *
 *   import { catalogPlugin, redirectsCheck } from "@sonle282/vibe-cms/plugins";
 *   plugins: [catalogPlugin({ listed: [...] }), redirectsCheck({ file: "public/_redirects" })],
 *
 * They are plain functions of the content (no file system): the same code runs in the build and in the Worker.
 */
import type { CmsConfig, CmsPlugin, Field, SiteContext, SiteProblem } from "../config/index.js";
import { storeIdField } from "../config/store.js";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const idOf = (config: CmsConfig, key: string) => { const collection = config.collections.find((entry) => entry.key === key); return collection ? storeIdField(collection.store) : "id"; };
const resourceOf = (config: CmsConfig, key: string, record: Record<string, unknown>) => `item:${key}:${String(record[idOf(config, key)] ?? "")}`;
const labelOf = (config: CmsConfig, key: string, record: Record<string, unknown>) => {
  const collection = config.collections.find((entry) => entry.key === key);
  const text = collection ? Object.entries(collection.fields).find(([name, field]) => field.type === "text" && typeof record[name] === "string" && record[name])?.[0] : undefined;
  return text ? String(record[text]) : String(record[idOf(config, key)] ?? "");
};

/** The values at a path in a record: "productsPage.productIds", "groups[].productIds" ("[]" = every item). */
export const valuesAt = (value: unknown, path: string): unknown[] => {
  const parts = path.split(".").filter(Boolean);
  let current: unknown[] = [value];
  for (const part of parts) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    current = current.flatMap((entry) => {
      const next = isRecord(entry) ? entry[key] : undefined;
      return many ? (Array.isArray(next) ? next : []) : next === undefined ? [] : [next];
    });
  }
  return current.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
};

/** Every reference field of a field set, as paths ("categoryIds", "productsPage.productIds", "groups[].ids"). */
const referencePaths = (fields: Record<string, Field>, base = ""): Array<{ path: string; to: string; label: string }> =>
  Object.entries(fields).flatMap(([key, field]) => {
    const path = base ? `${base}.${key}` : key;
    if (field.type === "reference") return [{ path, to: field.to, label: field.label }];
    if (field.type === "object") return referencePaths(field.fields, path);
    if (field.type === "list" && field.of.type === "reference") return [{ path, to: field.of.to, label: field.label }];
    if (field.type === "list" && field.of.type === "object") return referencePaths(field.of.fields, `${path}[]`);
    return [];
  });

/** Every record of the site with its resource and place: files and collection items. */
const recordsOf = (site: SiteContext) => [
  ...site.config.files.map((file) => ({ resource: `file:${file.key}`, label: file.label, fields: file.fields, record: site.file(file.key), live: true })),
  ...site.config.collections.flatMap((collection) => site.items(collection.key).map((record) => ({ resource: resourceOf(site.config, collection.key, record), label: labelOf(site.config, collection.key, record), fields: collection.fields, record: record as unknown, live: site.isLive(collection.key, record) }))),
].filter((entry) => isRecord(entry.record)) as Array<{ resource: string; label: string; fields: Record<string, Field>; record: Record<string, unknown>; live: boolean }>;

export type ListedRule = {
  /** The collection whose Live records must be listed (Mr Spa: products). */
  collection: string;
  /** Where they are listed: a path in a file or in every record of a collection (Mr Spa: categories' "productsPage.productIds"). */
  in: ReadonlyArray<{ file?: string; collection?: string; path: string }>;
  /** At most once across those places (Mr Spa: a product is in one Products-page block). */
  once?: boolean;
  /** What the place is called in messages ("the Products page"). */
  place?: string;
};
export type CatalogOptions = {
  /** At publish, every other record's references still lead to a record — e.g. after one is removed (default true). */
  references?: boolean;
  /** A Live record that points to one that is not Live: "warning" (default), "error", or false. */
  liveReferences?: "warning" | "error" | false;
  /** Lists that must hold every Live record of a collection. */
  listed?: readonly ListedRule[];
};

/**
 * The catalog's relations (the Mr Spa CMS's catalog-categories / -collections / -products checks): references that
 * still lead somewhere, Live records that point to hidden ones, every Live product listed (once) on its page.
 */
export const catalogPlugin = (options: CatalogOptions = {}): CmsPlugin => ({
  name: "catalog",
  check: (site) => {
    const problems: SiteProblem[] = [];
    const { config } = site;
    const ids = new Map(config.collections.map((collection) => [collection.key, new Map(site.items(collection.key).map((record) => [String(record[idOf(config, collection.key)] ?? ""), record]))]));
    const records = recordsOf(site);
    for (const entry of records) {
      for (const reference of referencePaths(entry.fields)) {
        const target = config.collections.find((collection) => collection.key === reference.to);
        const known = ids.get(reference.to);
        if (!target || !known) continue;
        for (const value of valuesAt(entry.record, reference.path)) {
          if (typeof value !== "string" || !value) continue;
          const found = known.get(value);
          if (!found) {
            // The core checks each record's own references (all of them at build, the published ones at publish): here,
            // the others — a record removed or renamed while something else still points to it.
            if (options.references !== false && site.changing.length && !site.changing.includes(entry.resource)) problems.push({ resource: entry.resource, path: reference.path.replace(/\[\]/g, ""), message: `${entry.label} › ${reference.label} points to ${value}, which is not a ${target.itemLabel.toLowerCase()} any more.`, hint: "choose another one, or put it back" });
            continue;
          }
          const mode = options.liveReferences ?? "warning";
          if (mode && entry.live && !site.isLive(reference.to, found)) problems.push({ resource: entry.resource, path: reference.path.replace(/\[\]/g, ""), message: `${entry.label} › ${reference.label}: ${labelOf(config, reference.to, found)} is not Live, so the website does not show it there.`, ...(mode === "warning" ? { warning: true } : {}) });
        }
      }
    }
    for (const rule of options.listed ?? []) {
      const target = config.collections.find((collection) => collection.key === rule.collection);
      if (!target) { problems.push({ message: `catalogPlugin listed: there is no collection "${rule.collection}".` }); continue; }
      const place = rule.place ?? "its list";
      const seen = new Map<string, string[]>();
      for (const where of rule.in) {
        const holders = where.file ? [{ name: config.files.find((file) => file.key === where.file)?.label ?? where.file, record: site.file(where.file) }]
          : where.collection ? site.items(where.collection).map((record) => ({ name: labelOf(config, where.collection!, record), record })) : [];
        for (const holder of holders) for (const value of valuesAt(holder.record, where.path)) if (typeof value === "string") seen.set(value, [...(seen.get(value) ?? []), holder.name]);
      }
      for (const record of site.items(rule.collection)) {
        if (!site.isLive(rule.collection, record)) continue;
        const id = String(record[idOf(config, rule.collection)] ?? "");
        const holders = seen.get(id) ?? [];
        const resource = resourceOf(config, rule.collection, record);
        if (!holders.length) problems.push({ resource, message: `${labelOf(config, rule.collection, record)} is Live but not on ${place}.`, hint: `add it to ${place}, or hide it` });
        else if (rule.once && holders.length > 1) problems.push({ resource, message: `${labelOf(config, rule.collection, record)} is on ${place} ${holders.length} times (${holders.join(", ")}).`, hint: "keep it in one place" });
      }
    }
    return problems;
  },
});

export type RedirectsOptions = {
  /** The repo file (default "public/_redirects"). */
  file?: string;
  /** Allowed statuses (default [301], as Mr Spa). */
  statuses?: readonly number[];
  /** Site-path destinations end with "/" (one 301, no second one after it) — default true. */
  trailingSlash?: boolean;
  /** Cloudflare's limits: 2,000 exact + 100 dynamic rules (a warning from 90 %). */
  limits?: { exact: number; dynamic: number };
};

/**
 * The site's `_redirects` (the Mr Spa CMS's redirect-regression-check): its form, one 301 per hop, exact rules before
 * the first dynamic one, Cloudflare's limits — and against the content: a destination that is a record's address must
 * be Live, and no rule may hide a Live page.
 */
export const redirectsCheck = (options: RedirectsOptions = {}): CmsPlugin => {
  const file = options.file ?? "public/_redirects";
  const statuses = options.statuses ?? [301];
  const limits = options.limits ?? { exact: 2000, dynamic: 100 };
  return {
    name: "redirects",
    files: [file],
    check: (site) => {
      const text = site.text(file);
      if (text === undefined) return [];
      const problems: SiteProblem[] = [];
      const say = (line: number, message: string, warning = false) => problems.push({ resource: file, path: `line ${line}`, message: `${file} line ${line}: ${message}`, ...(warning ? { warning: true } : {}) });
      // The addresses of the site's records: Live ones, and every one by its address (to tell "not Live" from "not ours").
      const live = new Set<string>();
      const ours = new Map<string, string>();
      for (const collection of site.config.collections) for (const record of site.items(collection.key)) {
        const url = site.urlOf(collection.key, record);
        if (!url) continue;
        ours.set(url, collection.itemLabel.toLowerCase());
        if (site.isLive(collection.key, record)) live.add(url);
      }
      for (const entry of site.config.files) { const url = site.fileUrl(entry.key); if (url) live.add(url); }
      const slashed = (path: string) => (path.endsWith("/") ? path : `${path}/`);
      const sources = new Map<string, number>();
      let firstDynamic = 0; let exact = 0; let dynamic = 0;
      text.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        const content = raw.trim();
        if (!content || content.startsWith("#")) return;
        const [source = "", destination = "", status = "", ...extra] = content.split(/\s+/);
        if (!destination || !status) { say(line, "expected source destination status"); return; }
        if (extra.length) say(line, `unexpected redirect options ${extra.join(" ")}`);
        if (!source.startsWith("/")) say(line, "source must be a path");
        if (!destination.startsWith("/") && !/^https?:\/\//.test(destination)) say(line, "destination must be a path or absolute URL");
        if (!statuses.includes(Number(status))) say(line, `only ${statuses.join(" / ")} redirects are allowed`);
        if (source === destination) say(line, "source and destination are identical");
        if (sources.has(source)) say(line, `duplicate source ${source} (line ${sources.get(source)})`); else sources.set(source, line);
        const isDynamic = /[*:]/.test(source);
        if (isDynamic) { dynamic += 1; if (!firstDynamic) firstDynamic = line; }
        else {
          exact += 1;
          if (firstDynamic) say(line, `exact rule after the first dynamic rule (line ${firstDynamic}) — it would be dynamic`);
          if (live.has(source) || live.has(slashed(source))) say(line, `${source} is a Live page — a redirect would hide it`);
        }
        if (destination.startsWith("/") && !/[*:]/.test(destination)) {
          const path = destination.split(/[?#]/)[0];
          if ((options.trailingSlash ?? true) && !path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path)) say(line, `${destination} needs its trailing slash — use ${path}/ (one 301, no second redirect after it)`);
          if (ours.has(slashed(path)) && !live.has(slashed(path))) say(line, `${destination} is a ${ours.get(slashed(path))} that is not Live`);
          else if (ours.has(path) && !live.has(path)) say(line, `${destination} is a ${ours.get(path)} that is not Live`);
        }
      });
      const near = (count: number, limit: number) => count >= Math.ceil(limit * 0.9);
      if (exact > limits.exact) problems.push({ resource: file, message: `${file}: ${exact} exact rules — Cloudflare takes at most ${limits.exact}.` });
      else if (near(exact, limits.exact)) problems.push({ resource: file, message: `${file}: ${exact} of ${limits.exact} exact rules used.`, warning: true });
      if (dynamic > limits.dynamic) problems.push({ resource: file, message: `${file}: ${dynamic} dynamic rules — Cloudflare takes at most ${limits.dynamic}.` });
      else if (near(dynamic, limits.dynamic)) problems.push({ resource: file, message: `${file}: ${dynamic} of ${limits.dynamic} dynamic rules used.`, warning: true });
      return problems;
    },
  };
};
