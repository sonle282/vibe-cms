// Vibe CMS: <media base>/[...path] (P10) — an uploaded image that is not deployed yet, served from the site's R2 bucket
// at its final address (strict path check, real image bytes only, no script: CSP sandbox). Once the site is deployed
// with the file, the static file answers first and this route is never reached. Without CMS_MEDIA: 404.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import config from "virtual:vibe-cms/config";
import { createMediaStore, mediaSettings, type MediaBucket } from "@sonle282/vibe-cms/media";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const bucket = (env as { CMS_MEDIA?: MediaBucket }).CMS_MEDIA;
  if (!bucket) return new Response("Not found", { status: 404 });
  return createMediaStore({ bucket, settings: mediaSettings(config.media) }).serve(url.pathname);
};
