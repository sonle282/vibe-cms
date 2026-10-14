/// <reference types="astro/client" />
// The site's cms.config.ts, provided to the injected routes by the integration's Vite plugin.
declare module "virtual:vibe-cms/config" {
  const config: import("./config/index.js").CmsConfig;
  export default config;
}

// The site's content files as built (raw text keyed by project path, e.g. "src/data/site.json").
declare module "virtual:vibe-cms/content" {
  const files: Record<string, string>;
  export default files;
}

// The Worker's bindings (Cloudflare runtime module; typed loosely here, the route narrows what it uses).
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

// P10: the site's own images under public/ (built in for the image library).
declare module "virtual:vibe-cms/images" {
  const images: Array<{ src: string; width?: number; height?: number; bytes: number; name?: string }>;
  export default images;
  /** P12h: the site's image manifest when images are stored by name (media.names), else null. */
  export const names: import("./media/names.js").ImageManifest | null;
}

// M14: the site's admin plugins (cms.config.ts `admin.plugins`), bundled into /admin.
declare module "virtual:vibe-cms/admin-plugins" {
  const plugins: import("./admin/plugins.js").AdminPlugin[];
  export default plugins;
}
