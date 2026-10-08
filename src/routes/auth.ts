// Vibe CMS: /api/auth/* — sign in (POST /login), sign out (POST /logout), who am I (GET /me), change my password
// (PUT /password). P6; wiring: src/api/runtime.ts.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import config from "virtual:vibe-cms/config";
import content from "virtual:vibe-cms/content";
import images from "virtual:vibe-cms/images";
import { createSiteRuntime, type SiteEnv } from "@sonle282/vibe-cms/api";

export const prerender = false;

let runtime: ReturnType<typeof createSiteRuntime> | undefined;
export const ALL: APIRoute = ({ request }) => (runtime ??= createSiteRuntime({ config, content, images, env: env as SiteEnv, dev: import.meta.env.DEV })).auth.handleAuth(request);
