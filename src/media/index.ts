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

/** The part of Cloudflare's R2 binding the CMS uses. */
export interface MediaBucket {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  list(options: { prefix: string; cursor?: string; limit?: number; include?: Array<"customMetadata" | "httpMetadata"> }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date; customMetadata?: Record<string, string> }>; truncated: boolean; cursor?: string }>;
}

export const DEFAULT_MEDIA_DIR = "public/assets/uploads";
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_EDGE = 2400;
const STAGING = "staging/";
const INDEX = "upload-index/";

export type MediaSettings = { dir: string; base: string; maxBytes: number };
export const mediaSettings = (media?: { dir?: string; maxBytes?: number }): MediaSettings => {
  const dir = media?.dir ?? DEFAULT_MEDIA_DIR;
  return { dir, base: dir.replace(/^public/, ""), maxBytes: media?.maxBytes ?? DEFAULT_MAX_BYTES };
};

/** "Hội sơn — Spa.JPG" → "hoi-son-spa" (60 characters at most, "image" when nothing is left). */
export const uploadSlug = (fileName: string) =>
  fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "image";

/** The strict shape of an upload path under `base` — nothing else is ever read from or served out of the bucket. */
export const uploadPattern = (base: string) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/(20\\d{2})/(0[1-9]|1[0-2])/([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})\\.(webp|jpg|png|avif)$`);
/** Every upload path written in some text (JSON, HTML, Markdown). */
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

  return { settings, stage, list, read, serve, pattern };
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
    list: async ({ prefix, limit = 1000 }) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, entry]) => ({ key, size: entry.bytes.length, uploaded: entry.uploaded, customMetadata: entry.customMetadata })), truncated: false }),
    keys: () => [...objects.keys()],
  };
};
