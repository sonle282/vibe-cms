/**
 * P11: the CLI runs the site's own wrangler (its node_modules) with node directly — no shell, so arguments such as SQL
 * with spaces and quotes go through unchanged, Windows included. The CLI never asks for, reads or stores a Cloudflare
 * token: wrangler uses the login of whoever runs it (`wrangler login`); `--account` only picks the account
 * (CLOUDFLARE_ACCOUNT_ID). VIBE_CMS_WRANGLER = a .js / .mjs file to run instead (the package's tests: a fake Cloudflare).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CliError } from "./util.js";

export type WranglerResult = { status: number; stdout: string; stderr: string };
export type Wrangler = (args: string[]) => WranglerResult;

const entry = (root: string) => {
  if (process.env.VIBE_CMS_WRANGLER) return process.env.VIBE_CMS_WRANGLER;
  try {
    const manifest = createRequire(join(root, "package.json")).resolve("wrangler/package.json");
    const bin = (JSON.parse(readFileSync(manifest, "utf8")) as { bin?: Record<string, string> }).bin?.wrangler;
    if (bin) return join(dirname(manifest), bin);
  } catch { /* not installed */ }
  throw new CliError("wrangler is not installed in this site", "npm i -D wrangler");
};

export const createWrangler = (root: string, account?: string): Wrangler => {
  const file = entry(root);
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}) };
  return (args) => {
    const run = spawnSync(process.execPath, [file, ...args], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    if (run.error) throw new CliError(`wrangler could not start: ${run.error.message}`);
    return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
  };
};

/** Run and require success; the error carries the end of wrangler's own message (and a login hint when it is about auth). */
export const must = (wrangler: Wrangler, args: string[], what: string) => {
  const result = wrangler(args);
  if (result.status === 0) return result.stdout;
  const message = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-12).join("\n");
  const auth = /not logged in|login|authenticat|10000|api token/i.test(message);
  throw new CliError(`${what} failed (wrangler ${args.slice(0, 3).join(" ")}):\n${message}`, auth ? "sign in first: npx wrangler login (or pick the account with --account <id>)" : undefined);
};

/** The JSON wrangler prints (an array or object starting at the beginning of a line; banners and notes are skipped). */
export const jsonOutput = <T>(stdout: string, what: string): T => {
  const lines = stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*[[{]/.test(lines[index])) continue;
    try { return JSON.parse(lines.slice(index).join("\n")) as T; } catch { /* a line that only looks like JSON */ }
  }
  throw new CliError(`${what}: wrangler did not print JSON`, "update wrangler in the site (npm i -D wrangler@4)");
};

type D1Rows<T> = Array<{ results: T[]; success: boolean }>;

/** Rows of one SELECT on the site's CMS database (binding CMS_DB), remote or local. */
export const query = <T>(wrangler: Wrangler, config: string, local: boolean, sql: string): T[] => {
  const out = must(wrangler, ["d1", "execute", "CMS_DB", local ? "--local" : "--remote", "--config", config, "--json", "--command", sql], "reading the CMS database");
  return jsonOutput<D1Rows<T>>(out, "reading the CMS database").flatMap((part) => part.results ?? []);
};

/** Apply the package migrations to CMS_DB. Returns the names applied now (empty = it was up to date). */
export const applyMigrations = (wrangler: Wrangler, config: string, local: boolean) => {
  const out = must(wrangler, ["d1", "migrations", "apply", "CMS_DB", local ? "--local" : "--remote", "--config", config], "applying the CMS migrations");
  if (/No migrations to apply/i.test(out)) return [];
  return [...new Set(out.match(/\b\d{4}_[a-z0-9_]+\.sql\b/g) ?? [])];
};
