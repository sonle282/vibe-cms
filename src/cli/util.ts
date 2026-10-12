/** P11: shared bits of the `vibe-cms` CLI — the error it prints, site names, resource names, the package's own files. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** An error the CLI prints as "✘ message" + "→ hint" and exits 1 (no stack: the user did nothing wrong in the code). */
export class CliError extends Error {
  constructor(message: string, readonly hint?: string) { super(message); this.name = "CliError"; }
}

export type Log = (line: string) => void;

/** `<site>`: the short name every resource of the site starts with — lowercase letters, digits, hyphens (R2 rules). */
export const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;
export const validateSite = (site: unknown): string => {
  if (typeof site !== "string" || !SITE_NAME.test(site)) throw new CliError(`--site must be a short name: lowercase letters, digits and hyphens (got ${JSON.stringify(site ?? "")})`, "for example --site innovate");
  return site;
};

/** The site's own Cloudflare resources (design §0.5): one D1, one KV, one R2 bucket — never shared with another site. */
export const resourceNames = (site: string) => ({ db: `${site}-cms`, session: `${site}-session`, media: `${site}-media` });

/** The package this CLI belongs to (the copy installed in the site): its root, version, migrations folder. */
export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export const packageVersion = (): string => (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
export const PACKAGE_NAME = "@sonle282/vibe-cms";

/** `migrations_dir` as wrangler.jsonc writes it: relative to the config file, forward slashes (same on every machine). */
export const migrationsDirFor = (configFile: string) => {
  const target = join(packageRoot, "migrations");
  const rel = relative(dirname(configFile), target);
  return (isAbsolute(rel) ? target : rel).split(sep).join("/");
};

export const readJsonFile = <T>(file: string, what: string): T => {
  if (!existsSync(file)) throw new CliError(`${what} not found: ${file}`);
  try { return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as T; } catch (error) { throw new CliError(`${what} is not valid JSON: ${(error as Error).message}`); }
};

/** Only loopback addresses may replace the GitHub URLs (the package's tests); anything else would be a place to send the site to. */
export const loopbackOverride = (name: string, fallback: string) => {
  const value = process.env[name];
  if (!value) return fallback;
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new CliError(`${name} may only point to this machine (127.0.0.1), got ${url.hostname}`);
  return value.replace(/\/$/, "");
};
