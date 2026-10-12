/**
 * P12h: images stored by NAME — a key of the site's image manifest ("nails/nails-01"), the name its own <Img> looks up
 * at build time (the build makes every size). Set by `media.names` in cms.config:
 *
 *   media: { dir: "assets-src/images/uploads", base: "/assets/uploads",
 *            names: { manifest: "src/data/image-manifest.json", root: "assets-src/images" } }
 *
 * manifest  { "nails/nails-01": { width, height, widths: [400, 800, 1600], path: "/assets/img/nails/nails-01" } }
 * url       the address of one size: "{path}-{width}.webp" (default); the editor shows the largest one ≤ `width` (1600)
 * uploads   an upload is named by where the publish commits it, from `root`: uploads/2026/10/chair-1a2b3c4d
 *           (file assets-src/images/uploads/2026/10/chair-1a2b3c4d.webp); the next build gives it its sizes
 *
 * The admin works with addresses, as on any site; the API converts on the way out (name → address) and in (address →
 * name), so drafts, publish, History and the content files hold names only. Pure: runs in the Worker and in Node.
 */
import type { Field } from "../config/index.js";

export type ManifestEntry = { width: number; height: number; widths: number[]; path: string };
export type ImageManifest = Record<string, ManifestEntry>;
export type NamesConfig = { manifest: string; url?: string; width?: number; root?: string; exclude?: readonly string[] };
export type ImageNames = {
  manifest: ImageManifest;
  url: string;
  width: number;
  exclude: readonly string[];
  /** Uploads: names start with `prefix` ("uploads"), files are served under `base` ("/assets/uploads") until built. */
  uploads?: { prefix: string; base: string };
};

export const DEFAULT_NAME_URL = "{path}-{width}.webp";
export const DEFAULT_NAME_WIDTH = 1600;
const UPLOAD_TAIL = /^(20\d{2})\/(0[1-9]|1[0-2])\/([a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8})$/;

/** The names setting with the manifest read; undefined when the site stores image paths (the default). */
export const imageNamesOf = (media: { dir?: string; base?: string; names?: NamesConfig } | undefined, manifest: ImageManifest | null | undefined, base: string): ImageNames | undefined => {
  if (!media?.names || !manifest) return undefined;
  const { names } = media;
  const root = names.root?.replace(/\/+$/, "");
  const dir = media.dir?.replace(/\/+$/, "");
  const prefix = root && dir && dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : undefined;
  return { manifest, url: names.url ?? DEFAULT_NAME_URL, width: names.width ?? DEFAULT_NAME_WIDTH, exclude: names.exclude ?? [], ...(prefix ? { uploads: { prefix, base } } : {}) };
};

const sizeOf = (entry: ManifestEntry, width: number) => {
  const widths = [...(entry.widths?.length ? entry.widths : [entry.width])].sort((a, b) => a - b);
  return [...widths].reverse().find((size) => size <= width) ?? widths[0];
};
const fill = (template: string, entry: ManifestEntry, width: number) => template.replace(/\{path\}/g, entry.path).replace(/\{width\}/g, String(width));

/** "uploads/2026/10/chair-1a2b3c4d" → "2026/10/chair-1a2b3c4d", or undefined for any other name. */
export const uploadTail = (names: ImageNames, name: string) => {
  const prefix = names.uploads ? `${names.uploads.prefix}/` : undefined;
  if (!prefix || !name.startsWith(prefix)) return undefined;
  const tail = name.slice(prefix.length);
  return UPLOAD_TAIL.test(tail) ? tail : undefined;
};
export const isImageName = (names: ImageNames, name: string) => name in names.manifest || uploadTail(names, name) !== undefined;

/** The address the editor shows for a name; an upload not built yet needs its staged file (`staged`: tail → address). */
export const addressOfName = (names: ImageNames, name: string, staged?: (tail: string) => string | undefined) => {
  const entry = names.manifest[name];
  if (entry) return fill(names.url, entry, sizeOf(entry, names.width));
  const tail = uploadTail(names, name);
  return tail ? staged?.(tail) : undefined;
};

/** Every address of every size → its name (built once per setting). */
const addresses = new WeakMap<ImageNames, Map<string, string>>();
const addressMap = (names: ImageNames) => {
  let map = addresses.get(names);
  if (!map) {
    map = new Map();
    for (const [name, entry] of Object.entries(names.manifest)) {
      map.set(entry.path, name);
      for (const width of entry.widths?.length ? entry.widths : [entry.width]) map.set(fill(names.url, entry, width), name);
    }
    addresses.set(names, map);
  }
  return map;
};

/** The name of an address the editor sends back: any size of a manifest image, or an upload's address. */
export const nameOfAddress = (names: ImageNames, address: string) => {
  const clean = address.split(/[?#]/)[0];
  if (names.manifest[clean]) return clean; // already a name
  const known = addressMap(names).get(clean);
  if (known) return known;
  if (names.uploads) {
    const start = `${names.uploads.base}/`;
    if (clean.startsWith(start)) {
      const tail = clean.slice(start.length).replace(/\.(webp|jpg|png|avif)$/, "");
      if (UPLOAD_TAIL.test(tail)) return `${names.uploads.prefix}/${tail}`;
    }
  }
  return undefined;
};

/** Every upload name in a text (a draft's JSON), for the publish: "uploads/2026/10/chair-1a2b3c4d". */
export const uploadNamesIn = (names: ImageNames, text: string) => {
  if (!names.uploads) return [];
  const escaped = names.uploads.prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [...new Set([...text.matchAll(new RegExp(`${escaped}/20\\d{2}/(?:0[1-9]|1[0-2])/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}`, "g"))].map((match) => match[0]))];
};

/** A copy of a record with every image value of its fields mapped (string, or the src / mobile of { src, alt, mobile }). */
export const mapImageValues = (fields: Record<string, Field>, content: unknown, map: (value: string) => string): unknown => {
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const one = (field: Field, value: unknown): unknown => {
    switch (field.type) {
      case "image":
        if (typeof value === "string") return value ? map(value) : value;
        if (isRecord(value)) return { ...value, ...(typeof value.src === "string" && value.src ? { src: map(value.src) } : {}), ...(typeof value.mobile === "string" && value.mobile ? { mobile: map(value.mobile) } : {}) };
        return value;
      case "object": return isRecord(value) ? record(field.fields, value) : value;
      case "list": return Array.isArray(value) ? value.map((item) => one(field.of, item)) : value;
      case "tuple": return Array.isArray(value) ? value.map((item, index) => (field.items[index] ? one(field.items[index], item) : item)) : value;
      default: return value;
    }
  };
  // Dotted keys ("about.photo") are nested values.
  const record = (level: Record<string, Field>, value: Record<string, unknown>) => {
    let out: Record<string, unknown> = { ...value };
    for (const [key, field] of Object.entries(level)) {
      const parts = key.split(".");
      if (parts.length === 1) { if (key in out) out[key] = one(field, out[key]); continue; }
      const set = (target: Record<string, unknown>, index: number): Record<string, unknown> => {
        const part = parts[index];
        if (!(part in target)) return target;
        if (index === parts.length - 1) return { ...target, [part]: one(field, target[part]) };
        return isRecord(target[part]) ? { ...target, [part]: set(target[part] as Record<string, unknown>, index + 1) } : target;
      };
      out = set(out, 0);
    }
    return out;
  };
  return isRecord(content) ? record(fields, content) : content;
};

/** The site's images for the library (picker, Media): one entry per name, at the editor's size; excluded folders left out. */
export const manifestImages = (names: ImageNames) => Object.entries(names.manifest)
  .filter(([name]) => !names.exclude.some((prefix) => name.startsWith(prefix)))
  .map(([name, entry]) => ({ src: fill(names.url, entry, sizeOf(entry, names.width)), width: entry.width, height: entry.height, bytes: 0, name }));
