// The site's cms.config.ts, provided to the injected routes by the integration's Vite plugin.
declare module "virtual:vibe-cms/config" {
  const config: import("./config/index.js").CmsConfig;
  export default config;
}
