/**
 * P6: how a site's Worker is wired — used by the injected routes (/api/cms/*, /api/auth/*, /admin) and by the test
 * Worker, so tests run the production wiring. Bindings (names fixed for every site):
 *   CMS_DB                D1 <site>-cms (drafts, audit, users; the package's migrations/)
 *   SESSION               KV <site>-session (sign-in sessions; also Astro's session binding)
 *   CMS_LOGIN_LIMITER     rate-limit binding, 10 / 60 s  (required in production)
 *   CMS_PUBLISH_LIMITER   rate-limit binding, 20 / 60 s  (required in production)
 *   VIBE_GITHUB_TOKEN     secret: fine-grained token, Contents read/write on the site's repository only
 *   CMS_BOOTSTRAP_USERNAME / CMS_BOOTSTRAP_PASSWORD   secrets for the very first owner (ignored once used)
 *   CMS_SESSION_TTL_SECONDS  optional, 300 … 2,592,000 (default 30 days)
 *   VIBE_CMS_DEV_USER     "usr_dev:owner" — only with `dev` (import.meta.env.DEV) on localhost
 *   VIBE_GITHUB_API_URL   tests only: a fake GitHub on THIS machine (http://127.0.0.1:…, localhost, [::1]); any other
 *                         value is ignored, so the token can never be sent anywhere but api.github.com
 */
import type { CmsConfig } from "../config/index.js";
import { createCmsAuth, type RateLimiter, type SessionKv } from "../auth/index.js";
import { createBundledSource, createD1AuditLog, createD1DraftStore, type D1Like } from "../store/index.js";
import { createCmsApi, devIdentity } from "./index.js";
import { createGitHubPublisher } from "./github.js";

export type SiteEnv = {
  CMS_DB?: D1Like; SESSION?: SessionKv; CMS_LOGIN_LIMITER?: RateLimiter; CMS_PUBLISH_LIMITER?: RateLimiter;
  VIBE_GITHUB_TOKEN?: string; VIBE_GITHUB_API_URL?: string; CMS_BOOTSTRAP_USERNAME?: string; CMS_BOOTSTRAP_PASSWORD?: string; CMS_SESSION_TTL_SECONDS?: string; VIBE_CMS_DEV_USER?: string;
};

/** A loopback GitHub API URL for tests, or undefined (= the real api.github.com). */
export const loopbackApiUrl = (value: unknown) => {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password ? url.origin : undefined;
  } catch { return undefined; }
};

export const createSiteRuntime = ({ config, content, env, dev, githubApiUrl }: {
  config: CmsConfig; content: Record<string, string>; env: SiteEnv;
  /** import.meta.env.DEV — false in every production build. */
  dev: boolean;
  /** Tests only (fake GitHub). Routes never pass it. */
  githubApiUrl?: string;
}) => {
  const audit = env.CMS_DB ? createD1AuditLog(env.CMS_DB) : undefined;
  const apiUrl = githubApiUrl ?? loopbackApiUrl(env.VIBE_GITHUB_API_URL);
  const auth = createCmsAuth({
    db: env.CMS_DB, kv: env.SESSION, audit, siteUrl: config.site.url,
    loginLimiter: env.CMS_LOGIN_LIMITER, requireLoginLimiter: !dev,
    bootstrap: { username: env.CMS_BOOTSTRAP_USERNAME, password: env.CMS_BOOTSTRAP_PASSWORD },
    sessionTtlSeconds: env.CMS_SESSION_TTL_SECONDS,
    devIdentity: devIdentity({ enabled: dev, value: env.VIBE_CMS_DEV_USER }),
  });
  const api = createCmsApi({
    config, source: createBundledSource(content),
    drafts: env.CMS_DB ? createD1DraftStore(env.CMS_DB) : undefined, audit,
    publisher: env.VIBE_GITHUB_TOKEN ? createGitHubPublisher({ token: env.VIBE_GITHUB_TOKEN, repo: config.repo, ...(apiUrl ? { apiUrl } : {}) }) : undefined,
    identify: auth.identify, people: auth.people,
    publishLimiter: env.CMS_PUBLISH_LIMITER, requirePublishLimiter: !dev,
  });
  return { api, auth };
};
