/**
 * P10: uploaded images — the same mechanism as the CMS already running on the first site, without Cloudflare Images
 * (DESIGN decision 9): the browser prepares the file (longest edge ≤ 2400 px, WebP, metadata such as GPS dropped by
 * re-encoding), the server checks the real type from the bytes, names it, and keeps it in the site's R2 bucket
 * (binding CMS_MEDIA = <site>-media) until a publish commits it into the repository:
 *
 *   public path   /assets/uploads/YYYY/MM/<slug>-<first 8 hex of sha256>.<ext>   (media.dir, default public/assets/uploads)
 *   R2 keys       staging/<path without "/">   the bytes (+ metadata: sha256, size, who, when, original name)
 *                 upload-index/<sha256>        → the path (the same bytes uploaded again reuse it)
 *
 * Drafts hold the final public path. Until the site is deployed with the file, the injected route at that path serves
 * the staged copy (static files win once published). Publishing adds every referenced upload that the branch does not
 * have yet to the same single commit.
 */
import { detectImage, type ImageInfo } from "./image-type.js";

export { detectImage, IMAGE_EXTENSIONS, type ImageInfo, type ImageKind } from "./image-type.js";
// P12h: images stored by name in the site's manifest.
export { addressOfName, imageNamesOf, isImageName, manifestImages, mapImageValues, nameOfAddress, uploadNamesIn, uploadTail, type ImageManifest, type ImageNames, type ManifestEntry } from "./names.js";

/** The part of Cloudflare's R2 binding the CMS uses. */
export interface MediaBucket {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  /** M11: Remove image / Remove unused images (R2 takes one key or several). */
  delete?(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number; include?: Array<"customMetadata" | "httpMetadata"> }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date; customMetadata?: Record<string, string> }>; truncated: boolean; cursor?: string }>;
}

export const DEFAULT_MEDIA_DIR = "public/assets/uploads";
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_EDGE = 2400;
const STAGING = "staging/";
const INDEX = "upload-index/";
/** M11: a small object beside an upload — its display name and whether it is archived (no D1 table needed). */
const NOTE = "media-note/";
/** M18: `uploadedAt` is written at upload and outlives the staged copy, so a published upload keeps its date. */
export type MediaNote = { displayName?: string; archivedAt?: string; archivedBy?: string; uploadedAt?: string };
/** M11 (Mr Spa): a display name — NFKC, no control characters, single spaces, 1–120 characters; undefined when not usable. */
export const cleanDisplayName = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= 120 ? text : undefined;
};

export type MediaSettings = { dir: string; base: string; maxBytes: number };
export const mediaSettings = (media?: { dir?: string; base?: string; maxBytes?: number }): MediaSettings => {
  const dir = media?.dir ?? DEFAULT_MEDIA_DIR;
  // P12h: a folder outside public/ (the build turns it into the site's images) says where it is served until then.
  return { dir, base: media?.base ?? dir.replace(/^public/, ""), maxBytes: media?.maxBytes ?? DEFAULT_MAX_BYTES };
};

/** "Hội sơn — Spa.JPG" → "hoi-son-spa" (60 characters at most, "image" when nothing is left). */
export const uploadSlug = (fileName: string) =>
  fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "image";

/** The strict shape of an upload path under `base` — nothing else is ever read from or served out of the bucket. */
export const uploadPattern = (base: string) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/(20\\d{2})/(0[1-9]|1[0-2])/([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})\\.(webp|jpg|png|avif)$`);
/** Every upload path written in some text (JSON, HTML, Markdown). */
/** P12h: where the publish commits an upload: its folder in the repo (media.dir) instead of the address' base. */
export const repoPathOf = (settings: MediaSettings, path: string) => `${settings.dir}${path.slice(settings.base.length)}`;
export const uploadPathsIn = (text: string, base: string) => {
  const escaped = base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [...new Set([...text.matchAll(new RegExp(`${escaped}/20\\d{2}/(?:0[1-9]|1[0-2])/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}\\.(?:webp|jpg|png|avif)`, "g"))].map((match) => match[0]))];
};
const keyOf = (path: string) => `${STAGING}${path.replace(/^\//, "")}`;
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export class MediaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "MediaError"; }
}

export type StagedImage = { src: string; width?: number; height?: number; bytes: number; type: string; uploadedAt: string; uploadedBy?: string; name?: string; reused: boolean };

export const createMediaStore = ({ bucket, settings, now = () => new Date() }: { bucket: MediaBucket; settings: MediaSettings; now?: () => Date }) => {
  const pattern = uploadPattern(settings.base);

  /** Check, name and keep an upload; the same bytes again give the same path (nothing new is written). */
  const stage = async ({ bytes, fileName, userId, width, height }: { bytes: Uint8Array; fileName: string; userId: string; width?: number; height?: number }): Promise<StagedImage> => {
    if (!bytes.length) throw new MediaError(400, "empty_file", "The file is empty.");
    if (bytes.length > settings.maxBytes) throw new MediaError(413, "image_too_large", `The image is larger than ${Math.round(settings.maxBytes / 1024 / 1024)} MB.`);
    const info: ImageInfo | undefined = detectImage(bytes);
    if (!info || info.kind === "gif") throw new MediaError(415, "unsupported_image", "Only JPEG, PNG, WebP or AVIF images can be uploaded.");
    const sha = hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    const known = await bucket.get(`${INDEX}${sha}`);
    if (known) {
      const path = (await known.text()).trim();
      const staged = pattern.test(path) ? await bucket.head(keyOf(path)) : null;
      if (staged) return { src: path, ...dims(staged.customMetadata), bytes: staged.size, type: info.mime, uploadedAt: staged.customMetadata?.uploadedAt ?? "", uploadedBy: staged.customMetadata?.uploadedBy, name: staged.customMetadata?.name, reused: true };
    }
    const at = now();
    const path = `${settings.base}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${uploadSlug(fileName)}-${sha.slice(0, 8)}.${info.ext}`;
    const size = { width: info.width ?? width, height: info.height ?? height };
    const metadata: Record<string, string> = { path, sha256: sha, bytes: String(bytes.length), uploadedAt: at.toISOString(), uploadedBy: userId, name: fileName.slice(0, 150) };
    if (size.width && size.height) { metadata.width = String(size.width); metadata.height = String(size.height); }
    await bucket.put(keyOf(path), bytes, { httpMetadata: { contentType: info.mime, cacheControl: "no-store" }, customMetadata: metadata });
    await bucket.put(`${INDEX}${sha}`, path);
    await bucket.put(noteKey(path), "", { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { uploadedAt: metadata.uploadedAt } });
    return { src: path, ...(size.width && size.height ? { width: size.width, height: size.height } : {}), bytes: bytes.length, type: info.mime, uploadedAt: metadata.uploadedAt, uploadedBy: userId, name: metadata.name, reused: false };
  };

  const dims = (metadata?: Record<string, string>) => (metadata?.width && metadata.height ? { width: Number(metadata.width), height: Number(metadata.height) } : {});

  /** Uploads kept in the bucket, newest first (one page of up to `limit`). */
  const list = async ({ cursor, limit = 200 }: { cursor?: string; limit?: number } = {}) => {
    const page = await bucket.list({ prefix: `${STAGING}${settings.base.replace(/^\//, "")}/`, ...(cursor ? { cursor } : {}), limit: Math.min(Math.max(limit, 1), 1000), include: ["customMetadata"] });
    const images = page.objects
      .map((object) => ({ src: `/${object.key.slice(STAGING.length)}`, ...dims(object.customMetadata), bytes: object.size, uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded.toISOString(), name: object.customMetadata?.name }))
      .filter((image) => pattern.test(image.src))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return { images, cursor: page.truncated ? page.cursor : undefined };
  };

  /** The staged bytes of an upload path (strictly checked), or undefined. */
  const read = async (path: string) => {
    if (!pattern.test(path)) return undefined;
    const object = await bucket.get(keyOf(path));
    if (!object) return undefined;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const info = detectImage(bytes);
    return info ? { bytes, mime: info.mime } : undefined;
  };

  /** The injected route at the upload path: the staged copy until the site is deployed with the file. */
  const serve = async (pathname: string) => {
    const found = await read(decodeURIComponent(pathname));
    if (!found) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    return new Response(found.bytes, { headers: { "content-type": found.mime, "cache-control": "public, max-age=60", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "x-vibe-cms-upload": "staging" } });
  };

  /** P12h: the staged upload with this address but any extension ("/assets/uploads/2026/10/chair-1a2b3c4d"), or undefined. */
  const find = async (stem: string) => {
    const page = await bucket.list({ prefix: keyOf(`${stem}.`), limit: 10 });
    const path = page.objects.map((object) => `/${object.key.slice(STAGING.length)}`).find((candidate) => pattern.test(candidate));
    return path;
  };

  // ---- M11: notes (display name, archived) and removal of an upload that was never published

  const noteKey = (path: string) => `${NOTE}${path.replace(/^\//, "")}`;
  /** Every upload's note, by address. */
  const notes = async () => {
    const found = new Map<string, MediaNote>();
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: NOTE, ...(cursor ? { cursor } : {}), limit: 1000, include: ["customMetadata"] });
      for (const object of page.objects) {
        const meta = object.customMetadata ?? {};
        const note: MediaNote = { ...(meta.displayName ? { displayName: meta.displayName } : {}), ...(meta.archivedAt ? { archivedAt: meta.archivedAt, archivedBy: meta.archivedBy ?? "" } : {}), ...(meta.uploadedAt ? { uploadedAt: meta.uploadedAt } : {}) };
        found.set(`/${object.key.slice(NOTE.length)}`, note);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return found;
  };
  /** Change an upload's note (undefined = remove that part); an empty note is removed. */
  const setNote = async (path: string, change: Partial<Record<keyof MediaNote, string | undefined>>) => {
    if (!pattern.test(path)) throw new MediaError(400, "invalid_path", "Invalid media path.");
    const before = (await bucket.head(noteKey(path)))?.customMetadata ?? {};
    const next: Record<string, string> = { ...before };
    for (const [key, value] of Object.entries(change)) { if (value === undefined) delete next[key]; else next[key] = value; }
    if (!Object.keys(next).length) { await bucket.delete?.(noteKey(path)); return {}; }
    await bucket.put(noteKey(path), "", { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: next });
    return next as MediaNote;
  };
  /** The staged upload's facts (its metadata), or undefined. */
  const staged = async (path: string) => (pattern.test(path) ? (await bucket.head(keyOf(path))) ?? undefined : undefined);
  /** Delete a staged upload for good: its bytes, its duplicate-check record and its note. */
  const remove = async (path: string) => {
    const head = await staged(path);
    if (!head) throw new MediaError(404, "not_found", "Media file does not exist.");
    if (!bucket.delete) throw new MediaError(503, "media_not_configured", "Removing images is not available here.");
    const sha = head.customMetadata?.sha256;
    await bucket.delete([keyOf(path), ...(sha ? [`${INDEX}${sha}`] : []), noteKey(path)]);
  };

  return { settings, stage, list, read, serve, pattern, find, notes, setNote, staged, remove };
};
export type MediaStore = ReturnType<typeof createMediaStore>;

/** In memory, for tests (and a site without R2 in local development). */
export const createMemoryBucket = (): MediaBucket & { keys(): string[] } => {
  const objects = new Map<string, { bytes: Uint8Array; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; uploaded: Date }>();
  const toBytes = (value: ArrayBuffer | Uint8Array | string) => (typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value));
  const view = (entry: { bytes: Uint8Array; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => ({
    size: entry.bytes.length, httpMetadata: entry.httpMetadata, customMetadata: entry.customMetadata,
    arrayBuffer: async () => entry.bytes.slice().buffer as ArrayBuffer, text: async () => new TextDecoder().decode(entry.bytes),
  });
  return {
    put: async (key, value, options = {}) => { objects.set(key, { bytes: toBytes(value), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata, uploaded: new Date() }); },
    get: async (key) => { const entry = objects.get(key); return entry ? view(entry) : null; },
    head: async (key) => { const entry = objects.get(key); return entry ? { size: entry.bytes.length, customMetadata: entry.customMetadata } : null; },
    delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    list: async ({ prefix, limit = 1000 }) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, entry]) => ({ key, size: entry.bytes.length, uploaded: entry.uploaded, customMetadata: entry.customMetadata })), truncated: false }),
    keys: () => [...objects.keys()],
  };
};
