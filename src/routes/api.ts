// Vibe CMS: /api/cms/* — the CMS API (P5). Production wiring: bindings from the Worker env, GitHub at api.github.com,
// and no identity until P6 (every route answers 503 "auth not configured"), except `astro dev` on localhost with
// VIBE_CMS_DEV_USER="usr_dev:owner" (import.meta.env.DEV is false in every production build).
//   CMS_DB             D1 <site>-cms (drafts + audit; migrations/ of the package)
//   VIBE_GITHUB_TOKEN  secret: fine-grained token, Contents read/write on the site's repository only
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import config from "virtual:vibe-cms/config";
import content from "virtual:vibe-cms/content";
import { createCmsApi, createGitHubPublisher, devIdentity } from "@sonle282/vibe-cms/api";
import { createBundledSource, createD1AuditLog, createD1DraftStore } from "@sonle282/vibe-cms/store";

export const prerender = false;

type Env = { CMS_DB?: Parameters<typeof createD1DraftStore>[0]; VIBE_GITHUB_TOKEN?: string; VIBE_CMS_DEV_USER?: string };
let api: ReturnType<typeof createCmsApi> | undefined;

const build = () => {
  const bindings = env as unknown as Env;
  return createCmsApi({
    config,
    source: createBundledSource(content),
    drafts: bindings.CMS_DB ? createD1DraftStore(bindings.CMS_DB) : undefined,
    audit: bindings.CMS_DB ? createD1AuditLog(bindings.CMS_DB) : undefined,
    publisher: bindings.VIBE_GITHUB_TOKEN ? createGitHubPublisher({ token: bindings.VIBE_GITHUB_TOKEN, repo: config.repo }) : undefined,
    identify: devIdentity({ enabled: import.meta.env.DEV, value: bindings.VIBE_CMS_DEV_USER }),
  });
};

export const ALL: APIRoute = ({ request }) => (api ??= build()).handle(request);
