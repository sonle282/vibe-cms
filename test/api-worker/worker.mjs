// P5 test Worker: the CMS API on local D1 in `wrangler dev --local`, publishing to the fake GitHub that
// scripts/api-local.mjs runs on 127.0.0.1 (GITHUB_API var). Never deployed; test-only identity from x-test-user.
import { createCmsApi, createGitHubPublisher } from "../../dist/api/index.js";
import { createBundledSource, createD1AuditLog, createD1DraftStore } from "../../dist/store/index.js";
import { config, files } from "./generated.mjs";

let live = { ...files };
let api;
const identify = (request) => {
  const value = request.headers.get("x-test-user");
  if (!value) return null;
  const [userId, role] = value.split(":");
  return { userId, role };
};
const publisherFor = (env) => createGitHubPublisher({ token: env.GITHUB_TOKEN, repo: config.repo, apiUrl: env.GITHUB_API });
const build = (env) => createCmsApi({ config, source: createBundledSource(live), drafts: createD1DraftStore(env.DB), audit: createD1AuditLog(env.DB), publisher: publisherFor(env), identify });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/__test/redeploy") {
      const publisher = publisherFor(env);
      const { sha } = await publisher.head();
      const read = await publisher.readFiles(sha, Object.keys(files));
      live = Object.fromEntries(Object.entries(read).filter(([, text]) => text !== undefined));
      api = build(env);
      return Response.json({ ok: true, head: sha });
    }
    if (pathname === "/__test/audit") return Response.json(await createD1AuditLog(env.DB).list({ limit: 1000 }));
    api ??= build(env);
    return api.handle(request);
  },
};
