// Demo site for Vibe CMS: public pages prerender; the CMS routes (/admin, /api/cms/*) run on demand in the Worker.
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import vibeCms from "@sonle282/vibe-cms";

export default defineConfig({
  site: "https://demo.example",
  output: "static",
  adapter: cloudflare({ configPath: "./wrangler.jsonc" }),
  integrations: [vibeCms()],
});
