/**
 * Load a site's cms.config.ts at build / dev time (Node, before Vite serves anything). Vite's loadConfigFromFile bundles
 * the TypeScript file with esbuild and imports it, so the site needs no extra loader; then the config is checked
 * (all errors at once → CmsConfigError; warnings go to onWarnings) and, with checkSite, the content files too.
 */
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { loadConfigFromFile } from "vite";
import { checkContent } from "./check/content.js";
import { assertCmsConfig, CmsConfigError, type CmsConfig, type Problem } from "./config/index.js";

export type LoadOptions = { onWarnings?: (warnings: Problem[], file: string) => void };

export const loadCmsConfig = async (file: string, options: LoadOptions = {}): Promise<CmsConfig> => {
  const name = basename(file);
  if (!existsSync(file)) throw new CmsConfigError(name, [{ path: name, message: `not found at ${file}`, hint: "create it with defineCmsConfig({ … }) (see the README)" }]);
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, file, dirname(file), "silent");
  const config = loaded?.config as unknown;
  assertCmsConfig(config, name, (warnings) => options.onWarnings?.(warnings, name));
  return config;
};

/** Config + content: what the build (and later `vibe-cms check`) runs. Throws on the first failing stage. */
export const checkSite = async (file: string, options: LoadOptions = {}): Promise<CmsConfig> => {
  const config = await loadCmsConfig(file, options);
  const { errors, warnings } = checkContent(config, dirname(file));
  if (warnings.length) options.onWarnings?.(warnings, "the content");
  if (errors.length) throw new CmsConfigError(basename(file), errors, "does not match the content");
  return config;
};
