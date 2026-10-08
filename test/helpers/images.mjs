// P10 test images, made here (no binary fixtures): a real, decodable PNG of any size, and a WebP header (VP8X) whose
// stated size is all the server reads.
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** An RGB PNG, width × height, a soft gradient (so it is not one colour). */
export const tinyPng = (width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    rows[at] = (x * 255) / Math.max(1, width - 1); rows[at + 1] = (y * 255) / Math.max(1, height - 1); rows[at + 2] = 160;
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
};

/** A WebP container with a VP8X chunk stating width × height (enough for the type check; not decodable). */
export const tinyWebp = (width, height) => {
  const out = Buffer.alloc(30);
  out.write("RIFF", 0, "ascii"); out.writeUInt32LE(22, 4); out.write("WEBP", 8, "ascii"); out.write("VP8X", 12, "ascii"); out.writeUInt32LE(10, 16);
  out.writeUIntLE(width - 1, 24, 3); out.writeUIntLE(height - 1, 27, 3);
  return new Uint8Array(out);
};
