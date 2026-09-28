// Vibe CMS: GET /api/cms/health — the package version, what the site's cms.config.ts declares, and how many content
// files were built into the Worker (the bundled ContentSource, P3).
import type { APIRoute } from "astro";
import config from "virtual:vibe-cms/config";
import content from "virtual:vibe-cms/content";
import pkg from "../../package.json" with { type: "json" };

export const prerender = false;

export const GET: APIRoute = () => new Response(JSON.stringify({
  ok: true,
  package: pkg.name,
  version: pkg.version,
  site: config.site.name,
  files: config.files.length,
  collections: config.collections.length,
  sources: Object.keys(content).length,
}), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
