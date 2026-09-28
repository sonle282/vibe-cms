/**
 * Load a site's cms.config.ts at build / dev time (Node, before Vite serves anything). Vite's loadConfigFromFile bundles
 * the TypeScript file with esbuild and imports it, so the site needs no extra loader; then the config is checked.
 */
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { loadConfigFromFile } from "vite";
import { assertCmsConfig, CmsConfigError, type CmsConfig } from "./config/index.js";

export const loadCmsConfig = async (file: string): Promise<CmsConfig> => {
  if (!existsSync(file)) throw new CmsConfigError(basename(file), [`not found at ${file} — create it with defineCmsConfig({ … }) (see the README)`]);
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, file, dirname(file), "silent");
  const config = loaded?.config as unknown;
  assertCmsConfig(config, basename(file));
  return config;
};
