// Vibe CMS · P1: GET /api/cms/health — the package version and what the site's cms.config.ts declares.
import type { APIRoute } from "astro";
import config from "virtual:vibe-cms/config";
import pkg from "../../package.json" with { type: "json" };

export const prerender = false;

export const GET: APIRoute = () => new Response(JSON.stringify({
  ok: true,
  package: pkg.name,
  version: pkg.version,
  site: config.site.name,
  files: config.files.length,
  collections: config.collections.length,
}), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
