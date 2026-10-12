/**
 * P12d: run a site's own `rules` (cms.config.ts, a file's or a collection's) on one record — the plugin seam for checks
 * the field types cannot say. Same code at build (content.ts) and in the Worker (API save + publish). A rule that throws
 * or returns something odd is an error naming the rule, never a crash. Problems keep the site's paths, under `base`.
 */
import type { ContentRule, RuleContext } from "../config/index.js";
import type { CheckResult } from "../config/validate.js";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const join = (base: string, path: string) => (!base ? path : !path ? base : path.startsWith("[") ? `${base}${path}` : `${base}.${path}`);

export const runRules = (rules: ContentRule | undefined, value: unknown, content: RuleContext, base = ""): CheckResult => {
  const result: CheckResult = { errors: [], warnings: [] };
  if (!rules || !isRecord(value)) return result;
  let problems: unknown;
  try { problems = rules(value, content) ?? []; } catch (error) {
    result.errors.push({ path: base || "(content)", message: `the site's rule failed: ${(error as Error)?.message ?? String(error)}`, hint: "fix rules in cms.config.ts" });
    return result;
  }
  if (!Array.isArray(problems)) {
    result.errors.push({ path: base || "(content)", message: "the site's rule did not return a list of problems", hint: "rules must return [] or [{ path, message }]" });
    return result;
  }
  for (const problem of problems) {
    if (!isRecord(problem) || typeof problem.message !== "string" || !problem.message) continue;
    const entry = { path: join(base, typeof problem.path === "string" ? problem.path : ""), message: problem.message, ...(typeof problem.hint === "string" && problem.hint ? { hint: problem.hint } : {}) };
    (problem.warning === true ? result.warnings : result.errors).push(entry);
  }
  return result;
};

/** A RuleContext over content that is already loaded (file key → value, collection key → records). */
export const ruleContext = (files: Map<string, unknown>, items: Map<string, Array<Record<string, unknown>>>): RuleContext => ({
  file: (key) => files.get(key),
  items: (key) => items.get(key) ?? [],
});
