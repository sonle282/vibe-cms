// Demo site for Vibe CMS: public pages prerender; the CMS routes (/admin, /api/cms/*) run on demand in the Worker.
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import vibeCms from "@sonle282/vibe-cms";

export default defineConfig({
  site: "https://demo.example",
  output: "static",
  // Images: processed at build time, served as-is at run time — no Cloudflare IMAGES binding.
  adapter: cloudflare({ configPath: "./wrangler.jsonc", imageService: "compile" }),
  integrations: [vibeCms()],
});
