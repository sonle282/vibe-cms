// The draft store and lock enforcement on real D1 — locally. Applies migrations/ with `wrangler d1 migrations apply --local`, runs
// the test Worker (test/store-worker) in `wrangler dev --local`, and checks the shared scenario + the table schema.
// Local state goes to a temp folder that is deleted afterwards; no Cloudflare resource is used or created.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { npx, startWranglerDev } from "./lib/wrangler-dev.mjs";

const cwd = fileURLToPath(new URL("../test/store-worker/", import.meta.url));
const persist = mkdtempSync(join(tmpdir(), "vibe-cms-store-"));
try {
  const applied = npx(["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist, "--config", "wrangler.jsonc"], { cwd, input: "y\n" });
  assert.equal(applied.status, 0, `migrations apply failed:\n${applied.stdout}\n${applied.stderr}`);
  for (const name of ["0001_draft_index.sql", "0002_draft_content.sql", "0003_audit_log.sql"]) assert.ok(applied.stdout.includes(name), `migration ${name} applied`);
  const again = npx(["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist, "--config", "wrangler.jsonc"], { cwd, input: "y\n" });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /No migrations to apply/i, "a second apply changes nothing");

  const { base, stop } = await startWranglerDev({ cwd, config: "wrangler.jsonc", args: ["--persist-to", persist], ready: "/health" });
  try {
    const schema = await (await fetch(`${base}/schema`)).json();
    assert.deepEqual(schema.migrations, ["0001_draft_index.sql", "0002_draft_content.sql", "0003_audit_log.sql"]);
    assert.deepEqual(schema.audit, ["id", "at", "user_id", "role", "action", "stage", "resource", "detail"]);
    assert.deepEqual(schema.columns.map((column) => column.name), ["user_id", "resource", "kind", "resource_key", "item_id", "label", "source_version", "revision", "updated_at", "content"]);
    assert.deepEqual(schema.columns.filter((column) => column.pk).map((column) => column.name), ["user_id", "resource"]);
    assert.deepEqual(schema.indexes, ["cms_draft_index_resource", "cms_draft_index_user_updated"]);
    const response = await fetch(`${base}/run`);
    const checks = await response.json();
    assert.equal(response.status, 200, JSON.stringify(checks));
    const failed = checks.filter((item) => !item.ok);
    assert.deepEqual(failed, [], "every store check passes on local D1");
    const locksResponse = await fetch(`${base}/locks`);
    const locks = await locksResponse.json();
    assert.equal(locksResponse.status, 200, JSON.stringify(locks));
    assert.deepEqual(locks.filter((item) => !item.ok), [], "every lock-enforcement check passes on local D1");
    console.log(`Locks on local D1 OK: ${locks.length} checks passed (draft refused + not written, audit denied rows, publish re-check).`);
    console.log(`Store (local D1) OK: migration ${schema.migrations.join(", ")} (${schema.columns.length} columns, ${schema.indexes.length} indexes), ${checks.length} checks passed.`);
  } finally { stop(); }
} finally { rmSync(persist, { recursive: true, force: true }); }
process.exit(0);
