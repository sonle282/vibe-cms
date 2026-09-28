/**
 * P6: passwords, exactly as the CMS already running on the first site does it, so its users can move over without a
 * password reset (P21): PBKDF2-SHA256, 100,000 iterations (the most Web Crypto allows on Workers), 16-byte random salt,
 * 256-bit digest, stored as "pbkdf2-sha256-v1$<iterations>$<salt base64url>$<digest base64url>", compared in constant
 * time. Rules: username 3–32 characters (a-z 0-9 . _ -, starting with a letter or digit, case-insensitive); password
 * 12–200 characters.
 */

export const PBKDF2_ITERATIONS = 100_000;
export const HASH_VERSION = "pbkdf2-sha256-v1";
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
export const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
};
export const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length));

export class InputError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "InputError"; }
}

export const normalizeUsername = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
export const validateUsername = (value: unknown) => {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new InputError("invalid_username", "Username must be 3-32 characters using letters, numbers, dot, dash, or underscore.");
  return username;
};
export const validatePassword = (value: unknown) => {
  if (typeof value !== "string" || value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) throw new InputError("invalid_password", `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`);
  return value;
};
export const validateDisplayName = (value: unknown, fallback: string) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 60) throw new InputError("invalid_display_name", "Display name must be 1-60 characters.");
  return value.trim();
};

const derive = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, bits: number) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, bits));
};

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  return `${HASH_VERSION}$${PBKDF2_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(await derive(password, salt, PBKDF2_ITERATIONS, 256))}`;
};

export const verifyPassword = async (password: string, encoded: string) => {
  const [version, iterationsText, saltText, digestText] = encoded.split("$");
  const iterations = Number(iterationsText);
  if (version !== HASH_VERSION || !Number.isSafeInteger(iterations) || iterations < PBKDF2_ITERATIONS || !saltText || !digestText) return false;
  try {
    const expected = decodeBase64Url(digestText);
    const derived = await derive(password, decodeBase64Url(saltText), iterations, expected.length * 8);
    if (derived.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < derived.length; index += 1) difference |= derived[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
};

/** A hash of a random password: verifying against it costs the same as a real one (no "user exists" timing hint). */
export const decoyHash = `${HASH_VERSION}$${PBKDF2_ITERATIONS}$${"A".repeat(22)}$${"A".repeat(43)}`;

/** A readable temporary password (20 characters, no look-alike letters). */
export const temporaryPassword = () => {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
};
