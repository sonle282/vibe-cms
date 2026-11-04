// Vibe CMS: the site's Worker with the CMS's scheduled publishing (F12, WordPress's "Schedule"). A site that wants it
// sets in its wrangler config: "main": "@sonle282/vibe-cms/routes/worker.ts" and "triggers": { "crons": ["*/5 * * * *"] }.
// Every request is Astro's own (its Cloudflare handler, as the default entry); every few minutes the cron publishes the
// scheduled drafts that are due, as the person who scheduled them.
import { handle } from "@astrojs/cloudflare/handler";
import { env } from "cloudflare:workers";
import config from "virtual:vibe-cms/config";
import content from "virtual:vibe-cms/content";
import images, { names } from "virtual:vibe-cms/images";
import { createSiteRuntime, type SiteEnv } from "@sonle282/vibe-cms/api";

let runtime: ReturnType<typeof createSiteRuntime> | undefined;

export default {
  fetch: handle,
  async scheduled(_controller: unknown, _env: unknown, context: { waitUntil: (promise: Promise<unknown>) => void }) {
    runtime ??= createSiteRuntime({ config, content, images, names, env: env as SiteEnv, dev: false });
    context.waitUntil(runtime.scheduled().then((result) => {
      if (result.published.length || result.failed.length) console.log(`vibe-cms schedule: published ${result.published.join(", ") || "none"}; not published ${result.failed.join(", ") || "none"}`);
    }));
  },
};
