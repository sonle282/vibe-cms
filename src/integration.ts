/**
 * Vibe CMS — the Astro integration. Loads the site's cms.config.ts and checks it together with the content files it
 * declares (any error stops the build; warnings are printed), exposes the config and the raw content files to the
 * server routes as virtual modules, and adds /admin (placeholder) and /api/cms/health. The site's public pages keep
 * prerendering; only the injected routes run on demand (the site uses @astrojs/cloudflare).
 */
import { existsSync, openSync, readSync, closeSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { normalizePath, type Plugin } from "vite";
import { countConfig, formatWarnings, type CmsConfig } from "./config/index.js";
import { checkSite } from "./load-config.js";
import { detectImage, IMAGE_EXTENSIONS, mediaSettings } from "./media/index.js";

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

/** P10: the site's own images (public/…) for the image library — path, size, pixels; at most 3000, SVG included. */
export const VIRTUAL_IMAGES = "virtual:vibe-cms/images";
const RESOLVED_VIRTUAL_IMAGES = `\0${VIRTUAL_IMAGES}`;
export const siteImages = (root: string, limit = 3000) => {
  const publicDir = join(root, "public");
  const out: Array<{ src: string; width?: number; height?: number; bytes: number }> = [];
  const walk = (dir: string, url: string) => {
    if (out.length >= limit || !existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (out.length >= limit || name.startsWith(".")) continue;
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full, `${url}/${name}`);
      else if (IMAGE_EXTENSIONS.test(name)) {
        const head = Buffer.alloc(Math.min(stat.size, 65_536));
        const fd = openSync(full, "r");
        try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
        const info = detectImage(new Uint8Array(head));
        out.push({ src: `${url}/${name}`, ...(info?.width && info.height ? { width: info.width, height: info.height } : {}), bytes: stat.size });
      }
    }
  };
  walk(publicDir, "");
  return out;
};

const virtualModules = (file: string, root: string, paths: string[]): Plugin => ({
  name: "vibe-cms:virtual",
  resolveId: (id) => (id === VIRTUAL_CONFIG ? RESOLVED_VIRTUAL_CONFIG : id === VIRTUAL_CONTENT ? RESOLVED_VIRTUAL_CONTENT : id === VIRTUAL_IMAGES ? RESOLVED_VIRTUAL_IMAGES : undefined),
  load: (id) => {
    if (id === RESOLVED_VIRTUAL_CONFIG) return `export { default } from ${JSON.stringify(normalizePath(file))};`;
    if (id === RESOLVED_VIRTUAL_IMAGES) return `export default ${JSON.stringify(siteImages(root))};`;
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
      // P10: an upload that is not deployed yet is served from the site's R2 bucket at its final address (once the
      // site is deployed with the file, the static file answers first and this route is never reached).
      injectRoute({ pattern: `${mediaSettings(cms.media).base}/[...path]`, entrypoint: "@sonle282/vibe-cms/routes/media.ts", prerender: false });
    },
  },
});

export default vibeCms;
