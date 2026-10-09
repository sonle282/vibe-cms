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
