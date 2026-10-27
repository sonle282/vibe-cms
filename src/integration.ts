/**
 * Vibe CMS — the Astro integration. Loads the site's cms.config.ts and checks it together with the content files it
 * declares (any error stops the build; warnings are printed), exposes the config and the raw content files to the
 * server routes as virtual modules, and adds /admin/[...path] (the admin) and /api/cms/*. The site's public pages keep
 * prerendering; only the injected routes run on demand (the site uses @astrojs/cloudflare).
 */
import { execFileSync } from "node:child_process";
import { existsSync, openSync, readSync, closeSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";
import { normalizePath } from "./site-vite.js";
import { countConfig, formatWarnings, type CmsConfig } from "./config/index.js";
import { checkSite } from "./load-config.js";
import { detectImage, IMAGE_EXTENSIONS, mediaSettings } from "./media/index.js";
import { manifestImages } from "./media/names.js";
import { readImageNames } from "./check/content.js";

export type VibeCmsOptions = {
  /** Path of the site's config, relative to the project root. Default: "cms.config.ts". */
  configFile?: string;
};

export const VIRTUAL_CONFIG = "virtual:vibe-cms/config";
const RESOLVED_VIRTUAL_CONFIG = `\0${VIRTUAL_CONFIG}`;
/** Every content file the config declares, as raw text keyed by its project path — the Worker's ContentSource (P3). */
export const VIRTUAL_CONTENT = "virtual:vibe-cms/content";
const RESOLVED_VIRTUAL_CONTENT = `\0${VIRTUAL_CONTENT}`;

/** M14: the site's admin plugins (cms.config.ts `admin.plugins`), as one module for the admin's script. */
export const VIRTUAL_ADMIN_PLUGINS = "virtual:vibe-cms/admin-plugins";
const RESOLVED_VIRTUAL_ADMIN_PLUGINS = `\0${VIRTUAL_ADMIN_PLUGINS}`;

/** M14: where each plugin is — a path from cms.config.ts's folder ("./cms/admin-plugin.ts"), or a package name as is. */
export const adminPluginModules = (cms: CmsConfig, configFile: string) => (cms.admin?.plugins ?? []).map((entry) => {
  if (!entry.startsWith(".") && !entry.startsWith("/")) return entry;
  const path = resolve(dirname(configFile), entry);
  if (!existsSync(path)) throw new Error(`cms.config.ts admin.plugins: ${entry} is not a file (looked for ${path})`);
  return normalizePath(path);
});

/** Project-relative paths of the declared content: files, json-array files, and the .md files of markdown-dir folders. */
export const contentPaths = (config: CmsConfig, root: string) => [...new Set([
  ...config.files.map((file) => file.path),
  ...config.collections.flatMap((collection) => {
    if (collection.store.kind !== "markdown-dir") return [collection.store.path];
    const dir = collection.store.dir;
    return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).sort().map((name) => `${dir}/${name}`) : [];
  }),
])];

/** P10: the site's own images (public/…) for the image library — path, size, pixels; at most 3000, SVG included.
 * M18: the CMS's upload folder (`uploadsDir`, e.g. public/assets/uploads) is read first, newest first, so a site with
 * more than 3000 images never leaves its own uploads out; each upload gets `uploadedAt` (when git first saw the file,
 * else the first of its year/month folder). */
export const VIRTUAL_IMAGES = "virtual:vibe-cms/images";
const RESOLVED_VIRTUAL_IMAGES = `\0${VIRTUAL_IMAGES}`;
type SiteImage = { src: string; width?: number; height?: number; bytes: number; uploadedAt?: string };
/** When each file under `dir` was first committed (git, one call), by project-relative path; empty without git. */
const addedDates = (root: string, dir: string) => {
  const dates = new Map<string, string>();
  try {
    const log = execFileSync("git", ["log", "--relative", "--diff-filter=A", "--format=%x00%cI", "--name-only", "--", dir], { cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    for (const entry of log.split("\0")) {
      const [date, ...files] = entry.trim().split("\n");
      // Newest commit first: the oldest "added" wins, so keep overwriting.
      for (const file of files) if (file.trim() && date) dates.set(file.trim(), date.trim());
    }
  } catch { /* not a git checkout: folder dates only */ }
  return dates;
};
export const siteImages = (root: string, limit = 3000, uploadsDir?: string) => {
  const publicDir = join(root, "public");
  const uploadsFull = uploadsDir ? resolve(root, uploadsDir) : undefined;
  const out: SiteImage[] = [];
  const read = (full: string, src: string, size: number): SiteImage => {
    const head = Buffer.alloc(Math.min(size, 65_536));
    const fd = openSync(full, "r");
    try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
    const info = detectImage(new Uint8Array(head));
    return { src, ...(info?.width && info.height ? { width: info.width, height: info.height } : {}), bytes: size };
  };
  const walk = (dir: string, url: string, into: SiteImage[], skip?: string, max = limit) => {
    if (into.length >= max || !existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (into.length >= max || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (skip && resolve(full) === skip) continue;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full, `${url}/${name}`, into, skip, max);
      else if (IMAGE_EXTENSIONS.test(name)) into.push(read(full, `${url}/${name}`, stat.size));
    }
  };
  if (uploadsFull && uploadsFull.startsWith(resolve(publicDir)) && existsSync(uploadsFull)) {
    const uploads: SiteImage[] = [];
    // Every upload is read: they are sorted by date before the limit applies.
    walk(uploadsFull, `/${relative(publicDir, uploadsFull).split(/[\\/]/).join("/")}`, uploads, undefined, Infinity);
    const added = addedDates(root, relative(root, uploadsFull).split(/[\\/]/).join("/"));
    const publicRel = relative(root, publicDir).split(/[\\/]/).join("/");
    for (const image of uploads) {
      const folder = /\/(20\d{2})\/(0[1-9]|1[0-2])\/[^/]+$/.exec(image.src);
      // A shallow clone dates every file to its one commit: a git date outside the upload's year/month folder is not used.
      const git = added.get(`${publicRel}${image.src}`);
      const date = folder ? (git?.startsWith(`${folder[1]}-${folder[2]}`) ? git : `${folder[1]}-${folder[2]}-01T00:00:00Z`) : git;
      if (date) image.uploadedAt = date;
    }
    uploads.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? "") || a.src.localeCompare(b.src));
    out.push(...uploads.slice(0, limit));
  }
  walk(publicDir, "", out, uploadsFull);
  return out;
};

const virtualModules = (file: string, root: string, paths: string[], cms: CmsConfig): Plugin => ({
  name: "vibe-cms:virtual",
  resolveId: (id) => (id === VIRTUAL_CONFIG ? RESOLVED_VIRTUAL_CONFIG : id === VIRTUAL_CONTENT ? RESOLVED_VIRTUAL_CONTENT : id === VIRTUAL_IMAGES ? RESOLVED_VIRTUAL_IMAGES : id === VIRTUAL_ADMIN_PLUGINS ? RESOLVED_VIRTUAL_ADMIN_PLUGINS : undefined),
  load: (id) => {
    if (id === RESOLVED_VIRTUAL_CONFIG) return `export { default } from ${JSON.stringify(normalizePath(file))};`;
    if (id === RESOLVED_VIRTUAL_ADMIN_PLUGINS) {
      const modules = adminPluginModules(cms, file);
      return `${modules.map((entry, index) => `import p${index} from ${JSON.stringify(entry)};`).join("\n")}\nexport default [${modules.map((_, index) => `p${index}`).join(", ")}];`;
    }
    if (id === RESOLVED_VIRTUAL_IMAGES) {
      // P12h: images by name — the library lists the manifest, and the Worker gets the manifest to convert names.
      const names = readImageNames(cms, root);
      return `export default ${JSON.stringify(names ? manifestImages(names) : siteImages(root, 3000, mediaSettings(cms.media).dir))};
export const names = ${JSON.stringify(names ? names.manifest : null)};`;
    }
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
      // M14: a plugin file that is not there stops the build here, with its path.
      const plugins = adminPluginModules(cms, file);
      if (plugins.length) logger.info(`admin plugins: ${plugins.length}`);
      updateConfig({ vite: { plugins: [virtualModules(file, root, contentPaths(cms, root), cms)] } });
      // M1: one route for every screen of the admin (/admin, /admin/pages/home, /admin/catalog/services/…).
      injectRoute({ pattern: "/admin/[...path]", entrypoint: "@sonle282/vibe-cms/routes/admin.astro", prerender: false });
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
