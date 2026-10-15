/**
 * P11: the site's wrangler.jsonc — read it (comments allowed) and put the CMS bindings in without touching anything else:
 * comments, order, other bindings and formatting stay; a binding that is already right is not rewritten, so running
 * `setup` again leaves the file identical byte for byte.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { CliError } from "./util.js";

/**
 * Binding names the package's Worker code reads (src/api/runtime.ts, src/auth, src/media) — the defaults, or (P21) the
 * site's own from cms.config.ts (`bindings`, `secrets`), set by useSiteNames before a command runs.
 */
export const BINDINGS = { db: "CMS_DB", session: "SESSION", media: "CMS_MEDIA", login: "CMS_LOGIN_LIMITER", publish: "CMS_PUBLISH_LIMITER" };
export const SECRETS = { githubToken: "VIBE_GITHUB_TOKEN" };
export const useSiteNames = (names: { db: string; session: string; media: string; loginLimiter: string; publishLimiter: string; githubToken: string }) => {
  Object.assign(BINDINGS, { db: names.db, session: names.session, media: names.media, login: names.loginLimiter, publish: names.publishLimiter });
  SECRETS.githubToken = names.githubToken;
};
export const LIMITS = { login: { limit: 10, period: 60 }, publish: { limit: 20, period: 60 } } as const;

type Json = Record<string, unknown>;
export type BindingEntry = Json & { binding?: string; name?: string };
export type WranglerConfig = Json & {
  name?: string;
  d1_databases?: BindingEntry[];
  kv_namespaces?: BindingEntry[];
  r2_buckets?: BindingEntry[];
  ratelimits?: BindingEntry[];
};

export const findWranglerConfig = (root: string, explicit?: string) => {
  if (explicit) {
    const file = join(root, explicit);
    if (!existsSync(file)) throw new CliError(`${explicit} not found in ${root}`);
    return file;
  }
  for (const name of ["wrangler.jsonc", "wrangler.json"]) if (existsSync(join(root, name))) return join(root, name);
  if (existsSync(join(root, "wrangler.toml"))) throw new CliError("this site uses wrangler.toml; the CMS writes its bindings into wrangler.jsonc", "convert wrangler.toml to wrangler.jsonc first (same keys)");
  throw new CliError(`no wrangler.jsonc in ${root}`, "run the command in the site's folder, or pass --config <file>");
};

export const parseWranglerConfig = (text: string, file: string): WranglerConfig => {
  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new CliError(`${file} is not valid JSONC: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CliError(`${file} must hold one object`);
  return data as WranglerConfig;
};

export const readWranglerConfig = (file: string) => {
  const text = readFileSync(file, "utf8");
  return { text, data: parseWranglerConfig(text, file) };
};

/** The entry of a binding list with this binding (or rate-limit name). */
export const entryOf = (config: WranglerConfig, list: "d1_databases" | "kv_namespaces" | "r2_buckets" | "ratelimits", name: string) =>
  (Array.isArray(config[list]) ? config[list] : []).find((entry) => (list === "ratelimits" ? entry?.name : entry?.binding) === name);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type Upsert = { list: "d1_databases" | "kv_namespaces" | "r2_buckets" | "ratelimits"; name: string; values: Json };

/**
 * Put each entry in its list (found by `binding`, or `name` for rate limits); only the given keys are set, other keys
 * of the entry are kept. Returns the new text and one line per change ("CMS_DB.database_id: a → b").
 */
export const upsertBindings = (text: string, file: string, entries: Upsert[]) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  const formattingOptions = { insertSpaces: !indent.includes("\t"), tabSize: indent.includes("\t") ? 1 : indent.length, eol };
  const changes: string[] = [];
  let out = text;
  for (const { list, name, values } of entries) {
    const key = list === "ratelimits" ? "name" : "binding";
    const data = parseWranglerConfig(out, file);
    const current = Array.isArray(data[list]) ? data[list] : undefined;
    const index = current ? current.findIndex((entry) => entry?.[key] === name) : -1;
    if (!current) {
      out = applyEdits(out, modify(out, [list], [{ [key]: name, ...values }], { formattingOptions }));
      changes.push(`${name}: added`);
    } else if (index === -1) {
      out = applyEdits(out, modify(out, [list, current.length], { [key]: name, ...values }, { formattingOptions, isArrayInsertion: true }));
      changes.push(`${name}: added`);
    } else {
      for (const [field, value] of Object.entries(values)) {
        const before = current[index][field];
        if (same(before, value)) continue;
        out = applyEdits(out, modify(out, [list, index, field], value, { formattingOptions }));
        changes.push(`${name}.${field}: ${before === undefined ? "set" : `${JSON.stringify(before)} →`} ${JSON.stringify(value)}`);
      }
    }
  }
  if (out !== text && !out.endsWith(eol) && text.endsWith(eol)) out += eol;
  return { text: out, changes };
};
