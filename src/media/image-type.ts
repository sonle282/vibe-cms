/**
 * P10: what an uploaded file really is, from its first bytes (never from its name or the browser's content type):
 * WebP, JPEG, PNG, GIF or AVIF, with its pixel size when the header says it. SVG is never accepted (it can carry
 * script). Pure — runs in the Worker and in Node (build-time list of the site's own images).
 */

export type ImageKind = "webp" | "jpeg" | "png" | "gif" | "avif";
export type ImageInfo = { kind: ImageKind; mime: string; ext: string; width?: number; height?: number };

const MIME: Record<ImageKind, string> = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", avif: "image/avif" };
const EXT: Record<ImageKind, string> = { webp: "webp", jpeg: "jpg", png: "png", gif: "gif", avif: "avif" };

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

const jpegSize = (b: Uint8Array): { width?: number; height?: number } => {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = u16be(b, i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + length;
  }
  return {};
};

const webpSize = (b: Uint8Array): { width?: number; height?: number } => {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25) { const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  if (chunk === "VP8X" && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return {};
};

/** The image in these bytes, or undefined when it is not one of the accepted kinds. */
export const detectImage = (bytes: Uint8Array): ImageInfo | undefined => {
  const b = bytes;
  const make = (kind: ImageKind, size: { width?: number; height?: number } = {}): ImageInfo => ({ kind, mime: MIME[kind], ext: EXT[kind], ...(size.width && size.height ? { width: size.width, height: size.height } : {}) });
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return make("webp", webpSize(b));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return make("jpeg", jpegSize(b));
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return make("png", { width: u32be(b, 16), height: u32be(b, 20) });
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return make("gif", { width: u16le(b, 6), height: u16le(b, 8) });
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 4))) return make("avif");
  return undefined;
};

export const IMAGE_EXTENSIONS = /\.(webp|jpe?g|png|gif|avif|svg)$/i;
