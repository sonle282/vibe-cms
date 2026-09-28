// Test Worker: runs the draft-store scenario on a real (local) D1 binding in `wrangler dev --local`.
// Used only by scripts/store-local.mjs — never deployed; the wrangler config has no real resource ids.
import { createD1DraftStore } from "../../dist/store/index.js";
import { runStoreScenario } from "../helpers/store-scenario.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/schema") {
      const columns = (await env.DB.prepare("PRAGMA table_info(cms_draft_index)").all()).results.map((row) => ({ name: row.name, type: row.type, notnull: row.notnull, pk: row.pk }));
      const indexes = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cms_draft_index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map((row) => row.name);
      const migrations = (await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all()).results.map((row) => row.name);
      return json({ columns, indexes, migrations });
    }
    if (pathname === "/run") {
      try { return json(await runStoreScenario({ drafts: createD1DraftStore(env.DB) })); } catch (error) { return json({ error: String(error?.stack ?? error) }, 500); }
    }
    return new Response("vibe-cms store test worker", { status: 404 });
  },
};
