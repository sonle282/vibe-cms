/**
 * Vibe CMS — the Astro integration. Loads the site's cms.config.ts and checks it together with the content files it
 * declares (any error stops the build; warnings are printed), exposes the config and the raw content files to the
 * server routes as virtual modules, and adds /admin (placeholder) and /api/cms/health. The site's public pages keep
 * prerendering; only the injected routes run on demand (the site uses @astrojs/cloudflare).
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { normalizePath, type Plugin } from "vite";
import { countConfig, formatWarnings, type CmsConfig } from "./config/index.js";
import { checkSite } from "./load-config.js";

export type VibeCmsOptions = {
  /** Path of the site's config, relative to the project root. Default: "cms.config.ts". */
  configFile?: string;
};

export const VIRTUAL_CONFIG = "virtual:vibe-cms/config";
const RESOLVED_VIRTUAL_CONFIG = `\0${VIRTUAL_CONFIG}`;
/** Every content file the config declares, as raw text keyed by its project path — the Worker's ContentSource (P3). */
export const VIRTUAL_CONTENT = "virtual:vibe-cms/content";
const RESOLVED_VIRTUAL_CONTENT = `\0${VIRTUAL_CONTENT}`;

/** Project-relative paths of the declared content: files, json-array files, and the .md files of markdown-dir folders. */
export const contentPaths = (config: CmsConfig, root: string) => [
  ...config.files.map((file) => file.path),
  ...config.collections.flatMap((collection) => {
    if (collection.store.kind === "json-array") return [collection.store.path];
    const dir = collection.store.dir;
    return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).sort().map((name) => `${dir}/${name}`) : [];
  }),
];

const virtualModules = (file: string, root: string, paths: string[]): Plugin => ({
  name: "vibe-cms:virtual",
  resolveId: (id) => (id === VIRTUAL_CONFIG ? RESOLVED_VIRTUAL_CONFIG : id === VIRTUAL_CONTENT ? RESOLVED_VIRTUAL_CONTENT : undefined),
  load: (id) => {
    if (id === RESOLVED_VIRTUAL_CONFIG) return `export { default } from ${JSON.stringify(normalizePath(file))};`;
    if (id !== RESOLVED_VIRTUAL_CONTENT) return undefined;
    // ?raw keeps the exact bytes (line endings, spacing): the writer patches this text at publish time.
    const imports = paths.map((path, index) => `import f${index} from ${JSON.stringify(`${normalizePath(join(root, path))}?raw`)};`);
    return `${imports.join("\n")}\nexport default {${paths.map((path, index) => `${JSON.stringify(path)}: f${index}`).join(", ")}};`;
  },
});

export const vibeCms = (options: VibeCmsOptions = {}): AstroIntegration => ({
  name: "@sonle282/vibe-cms",
  hooks: {
    "astro:config:setup": async ({ config, injectRoute, updateConfig, logger }) => {
      const root = fileURLToPath(config.root);
      const file = resolve(root, options.configFile ?? "cms.config.ts");
      const cms = await checkSite(file, { onWarnings: (warnings, where) => logger.warn(formatWarnings(where, warnings)) });
      const { files, collections } = countConfig(cms);
      logger.info(`config OK: ${files} files, ${collections} collections, content checked (${cms.repo.owner}/${cms.repo.name} → ${cms.repo.branch})`);
      updateConfig({ vite: { plugins: [virtualModules(file, root, contentPaths(cms, root))] } });
      injectRoute({ pattern: "/admin", entrypoint: "@sonle282/vibe-cms/routes/admin.astro", prerender: false });
      injectRoute({ pattern: "/api/cms/health", entrypoint: "@sonle282/vibe-cms/routes/health.ts", prerender: false });
      injectRoute({ pattern: "/api/cms/[...path]", entrypoint: "@sonle282/vibe-cms/routes/api.ts", prerender: false });
      injectRoute({ pattern: "/api/auth/[...path]", entrypoint: "@sonle282/vibe-cms/routes/auth.ts", prerender: false });
    },
  },
});

export default vibeCms;
