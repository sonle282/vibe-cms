/**
 * P19: the site's plugins (cms.config.ts `plugins`) check the whole site at once — what one record's `rules` cannot
 * see: a record no longer listed anywhere, a removed record still referenced, a redirect that hides a Live page. They
 * run on the content as it will be: at build (the files as they are) and in the Worker at publish (and Hide / Show)
 * with the drafts being published put in. Errors stop the build / refuse the publish; warnings are said.
 * A plugin that throws or returns something odd is an error naming it, never a crash.
 */
import type { CmsConfig, CmsCollection, SiteContext, SiteProblem } from "../config/index.js";
import type { CheckResult } from "../config/validate.js";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A record's website address from a preview pattern ("/blog/{slug}/"), or undefined when a part is missing. */
export const addressOf = (pattern: string | undefined, record: Record<string, unknown>) => {
  if (!pattern) return undefined;
  let missing = false;
  const path = pattern.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = key.split(".").reduce<unknown>((at, part) => (isRecord(at) ? at[part] : undefined), record);
    if (value === undefined || value === null || value === "") { missing = true; return ""; }
    return encodeURIComponent(String(value));
  });
  return missing ? undefined : path;
};

export const isLiveRecord = (collection: CmsCollection | undefined, record: Record<string, unknown>) =>
  !collection?.status || record[collection.status.field] === undefined ? Boolean(collection) : record[collection.status.field] === collection.status.live;

/**
 * The context the plugins read. `files` / `items` = the content (as it will be), `texts` = the repo files the
 * plugins asked for (`files`), `changing` = the resources being published (empty at build).
 */
export const siteContext = (config: CmsConfig, files: Map<string, unknown>, items: Map<string, Array<Record<string, unknown>>>, texts: Record<string, string | undefined>, changing: readonly string[] = []): SiteContext => ({
  config,
  file: (key) => files.get(key),
  items: (key) => items.get(key) ?? [],
  text: (path) => texts[path],
  isLive: (key, record) => isLiveRecord(config.collections.find((collection) => collection.key === key), record),
  urlOf: (key, record) => addressOf(config.collections.find((collection) => collection.key === key)?.preview, record),
  fileUrl: (key) => { const file = config.files.find((entry) => entry.key === key); return file?.preview && !/\{/.test(file.preview) ? file.preview : undefined; },
  changing,
});

/** The repo files every plugin asked for. */
export const pluginFiles = (config: CmsConfig) => [...new Set((config.plugins ?? []).flatMap((plugin) => plugin.files ?? []))];

export const runSiteChecks = (config: CmsConfig, site: SiteContext): CheckResult => {
  const result: CheckResult = { errors: [], warnings: [] };
  for (const plugin of config.plugins ?? []) {
    let problems: unknown;
    try { problems = plugin.check(site) ?? []; } catch (error) {
      result.errors.push({ path: `plugins: ${plugin.name}`, message: `the ${plugin.name} plugin failed: ${(error as Error)?.message ?? String(error)}`, hint: "fix the plugin, or its options in cms.config.ts" });
      continue;
    }
    if (!Array.isArray(problems)) { result.errors.push({ path: `plugins: ${plugin.name}`, message: `the ${plugin.name} plugin did not return a list of problems`, hint: "check must return [] or [{ message }]" }); continue; }
    for (const problem of problems as SiteProblem[]) {
      if (!isRecord(problem) || typeof problem.message !== "string" || !problem.message) continue;
      const where = [typeof problem.resource === "string" ? problem.resource : "", typeof problem.path === "string" ? problem.path : ""].filter(Boolean).join(" › ") || plugin.name;
      const entry = { path: where, message: problem.message, ...(typeof problem.hint === "string" && problem.hint ? { hint: problem.hint } : {}) };
      (problem.warning === true ? result.warnings : result.errors).push(entry);
    }
  }
  return result;
};
