// P6 test Worker: the production wiring (createSiteRuntime) on local D1 + KV + rate-limit bindings in
// `wrangler dev --local`, publishing to the fake GitHub run by scripts/auth-local.mjs. Never deployed.
import { createSiteRuntime } from "../../dist/api/index.js";
import { decoyHash, verifyPassword } from "../../dist/auth/index.js";
import { createD1AuditLog } from "../../dist/store/index.js";
import { config, files } from "./generated.mjs";

let runtime;
export default {
  async fetch(request, env) {
    runtime ??= createSiteRuntime({ config, content: files, env, dev: false, githubApiUrl: env.GITHUB_API });
    const { pathname } = new URL(request.url);
    // CPU probes: one PBKDF2 check (100k) with no I/O, and a request that does nothing.
    if (pathname === "/__test/hash") { const started = performance.now(); await verifyPassword("probe-password-123", decoyHash); return Response.json({ ok: true, insideMs: performance.now() - started }); }
    if (pathname === "/__test/noop") return Response.json({ ok: true });
    if (pathname === "/__test/audit") return Response.json((await createD1AuditLog(env.CMS_DB).list({ limit: 1000 })).reverse());
    if (pathname.startsWith("/api/auth/")) return runtime.auth.handleAuth(request);
    return runtime.api.handle(request);
  },
};
