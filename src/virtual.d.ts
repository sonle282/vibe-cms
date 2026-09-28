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
