/**
 * Vibe CMS — the Astro integration. P1: load + check the site's cms.config.ts, expose it to the server routes as a
 * virtual module, and add /admin (placeholder) and /api/cms/health. The site's public pages keep prerendering; only the
 * injected routes run on demand (the site uses @astrojs/cloudflare).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { normalizePath, type Plugin } from "vite";
import { countConfig } from "./config/index.js";
import { loadCmsConfig } from "./load-config.js";

export type VibeCmsOptions = {
  /** Path of the site's config, relative to the project root. Default: "cms.config.ts". */
  configFile?: string;
};

export const VIRTUAL_CONFIG = "virtual:vibe-cms/config";
const RESOLVED_VIRTUAL_CONFIG = `\0${VIRTUAL_CONFIG}`;

const configModule = (file: string): Plugin => ({
  name: "vibe-cms:config",
  resolveId: (id) => (id === VIRTUAL_CONFIG ? RESOLVED_VIRTUAL_CONFIG : undefined),
  load: (id) => (id === RESOLVED_VIRTUAL_CONFIG ? `export { default } from ${JSON.stringify(normalizePath(file))};` : undefined),
});

export const vibeCms = (options: VibeCmsOptions = {}): AstroIntegration => ({
  name: "@sonle282/vibe-cms",
  hooks: {
    "astro:config:setup": async ({ config, injectRoute, updateConfig, logger }) => {
      const file = resolve(fileURLToPath(config.root), options.configFile ?? "cms.config.ts");
      const cms = await loadCmsConfig(file);
      const { files, collections } = countConfig(cms);
      logger.info(`config OK: ${files} files, ${collections} collections (${cms.repo.owner}/${cms.repo.name} → ${cms.repo.branch})`);
      updateConfig({ vite: { plugins: [configModule(file)] } });
      injectRoute({ pattern: "/admin", entrypoint: "@sonle282/vibe-cms/routes/admin.astro", prerender: false });
      injectRoute({ pattern: "/api/cms/health", entrypoint: "@sonle282/vibe-cms/routes/health.ts", prerender: false });
    },
  },
});

export default vibeCms;
