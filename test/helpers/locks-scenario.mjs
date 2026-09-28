// P4 enforcement on real stores: the same checks run on memory stores (locks.test.mjs) and on local D1
// (test/store-worker, scripts/store-local.mjs). Returns checks instead of throwing.
// Worker-safe entry points only (the package root also exports the Astro integration, which needs Node / Vite).
import { f } from "../../dist/config/index.js";
import { checkPublishLocks, LockedFieldError, saveDraftChecked } from "../../dist/locks/index.js";

const config = {
  configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" },
  files: [{ key: "site", label: "Salon info", path: "src/data/site.json", format: "json", fields: { phone: f.text({ label: "Phone", locked: "owner" }), tagline: f.text({ label: "Tagline" }) } }],
  collections: [{ key: "services", label: "Services", itemLabel: "Service", store: { kind: "json-array", path: "src/data/services.json", idField: "id" }, fields: { name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "owner" }) } }],
};

export const runLocksScenario = async ({ drafts, audit }) => {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? "") }) });
  const source = { phone: "(555) 010-0000", tagline: "Hi" };
  let denied;
  try { await saveDraftChecked({ config, role: "editor", drafts, audit, source, input: { userId: "usr_editor1", resource: "file:site", content: { ...source, phone: "(555) 999-0000" }, sourceVersion: "v1" } }); } catch (error) { denied = error; }
  check("editor changing Phone: LockedFieldError 403", denied instanceof LockedFieldError && denied.status === 403, denied);
  check("…the draft was not written", (await drafts.get("usr_editor1", "file:site")) === undefined);
  const rows = await audit.list({ resource: "file:site" });
  check("…one audit row 'denied' / draft with the field path, no value", rows.length === 1 && rows[0].action === "denied" && rows[0].stage === "draft" && rows[0].detail.fields[0].path === "phone" && !JSON.stringify(rows).includes("999-0000"), JSON.stringify(rows));
  const ok = await saveDraftChecked({ config, role: "editor", drafts, audit, source, input: { userId: "usr_editor1", resource: "file:site", content: { ...source, tagline: "Welcome" }, sourceVersion: "v1" } });
  check("editor changing Tagline: saved", ok.revision === 1);
  const before = { id: "mani", name: "Manicure", price: "$20" };
  const draft = await saveDraftChecked({ config, role: "owner", drafts, audit, source: before, input: { userId: "usr_owner1", resource: "item:services:mani", content: { ...before, price: "$22" }, sourceVersion: "v1" } });
  let publishDenied;
  try { await checkPublishLocks({ config, role: "editor", userId: "usr_owner1", audit, resource: "item:services:mani", before, after: draft.content }); } catch (error) { publishDenied = error; }
  check("publish re-checks with the current role (now editor): denied", publishDenied instanceof LockedFieldError && publishDenied.stage === "publish", publishDenied);
  const all = await audit.list();
  check("audit: 2 'denied' rows, newest first", all.length === 2 && all[0].stage === "publish" && all[1].stage === "draft", JSON.stringify(all));
  return checks;
};
