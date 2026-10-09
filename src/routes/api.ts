// Vibe CMS: /api/cms/* — the CMS API (P5) with sign-in (P6). Wiring and bindings: src/api/runtime.ts.
// No session → 401; sign-in not set up (no CMS_DB / SESSION) → 503; `astro dev` on localhost may use VIBE_CMS_DEV_USER.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import config from "virtual:vibe-cms/config";
import content from "virtual:vibe-cms/content";
import images from "virtual:vibe-cms/images";
import { createSiteRuntime, type SiteEnv } from "@sonle282/vibe-cms/api";

export const prerender = false;

let runtime: ReturnType<typeof createSiteRuntime> | undefined;
export const ALL: APIRoute = ({ request }) => (runtime ??= createSiteRuntime({ config, content, images, env: env as SiteEnv, dev: import.meta.env.DEV })).api.handle(request);
