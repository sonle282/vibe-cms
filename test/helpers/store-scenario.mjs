// P3: one draft-store scenario, run against the memory store (unit test) and against local KV + D1 in wrangler dev
// (scripts/store-local.mjs). Returns a list of checks instead of throwing, so the Worker can report them as JSON.
import { createDrafts, DraftConflictError, parseResourceId } from "../../dist/store/index.js";

export const runStoreScenario = async ({ store, index }) => {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  let clock = 0;
  const drafts = createDrafts({ store, index, now: () => new Date(Date.UTC(2026, 8, 28, 12, 0, clock++)).toISOString() });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Save / read one draft of a file.
  const first = await drafts.save({ userId: "owner-1", resource: "file:site", label: "Salon info", content: { phone: "(555) 010-0001" }, sourceVersion: "sha256:aaa" });
  const read = await drafts.get("owner-1", "file:site");
  check("save → get returns the same draft", same(read, first), { read, first });
  check("first save has revision 1", first.revision === 1, first);
  let rows = await drafts.mine("owner-1");
  check("index row matches the draft", rows.length === 1 && same(rows[0], { userId: "owner-1", resource: "file:site", kind: "file", resourceKey: "site", itemId: null, label: "Salon info", sourceVersion: "sha256:aaa", revision: 1, updatedAt: first.updatedAt }), rows);

  // Save again: revision +1; a stale expectedRevision is refused and changes nothing.
  const second = await drafts.save({ userId: "owner-1", resource: "file:site", content: { phone: "(555) 010-0002" }, sourceVersion: "sha256:aaa", expectedRevision: 1 });
  check("second save → revision 2, label kept", second.revision === 2 && second.label === "Salon info", second);
  let conflict;
  try { await drafts.save({ userId: "owner-1", resource: "file:site", content: { phone: "lost" }, sourceVersion: "sha256:aaa", expectedRevision: 1 }); } catch (error) { conflict = error; }
  check("stale expectedRevision → DraftConflictError", conflict instanceof DraftConflictError && conflict.current === 2, String(conflict));
  check("the refused save changed nothing", (await drafts.get("owner-1", "file:site")).content.phone === "(555) 010-0002");
  rows = await drafts.mine("owner-1");
  check("index follows the revision", rows[0]?.revision === 2, rows);

  // Two people, same file: two drafts, neither overwrites the other.
  await drafts.save({ userId: "editor:2 Lê", resource: "file:site", label: "Salon info", content: { phone: "(555) 010-0003" }, sourceVersion: "sha256:aaa" });
  const mine = await drafts.get("owner-1", "file:site");
  const theirs = await drafts.get("editor:2 Lê", "file:site");
  check("two users' drafts of one file are separate", mine.content.phone === "(555) 010-0002" && theirs.content.phone === "(555) 010-0003", { mine, theirs });
  check("forResource lists both, newest first", same((await drafts.forResource("file:site")).map((row) => row.userId), ["editor:2 Lê", "owner-1"]));

  // Two items of the same collection file: separate drafts.
  await drafts.save({ userId: "owner-1", resource: "item:services:classic-manicure", label: "Classic Manicure", content: { price: "$22" }, sourceVersion: "sha256:m1" });
  await drafts.save({ userId: "owner-1", resource: "item:services:spa-pedicure", label: "Spa Pedicure", content: { price: "$38" }, sourceVersion: "sha256:p1" });
  const a = await drafts.get("owner-1", "item:services:classic-manicure");
  const b = await drafts.get("owner-1", "item:services:spa-pedicure");
  check("two items in one collection file are separate drafts", a.content.price === "$22" && b.content.price === "$38", { a, b });
  rows = await drafts.mine("owner-1");
  check("My drafts: 3 rows, newest first, item ids set", same(rows.map((row) => [row.resource, row.itemId]), [["item:services:spa-pedicure", "spa-pedicure"], ["item:services:classic-manicure", "classic-manicure"], ["file:site", null]]), rows);

  // Discard one; publish clears only the publisher's draft.
  await drafts.discard("owner-1", "item:services:spa-pedicure");
  check("discard removes the draft", (await drafts.get("owner-1", "item:services:spa-pedicure")) === undefined);
  check("discard removes the index row", !(await drafts.mine("owner-1")).some((row) => row.resource === "item:services:spa-pedicure"));
  await drafts.clearAfterPublish("owner-1", "file:site");
  check("after publish the publisher's draft is gone", (await drafts.get("owner-1", "file:site")) === undefined);
  check("…and the other user's draft of that file stays", (await drafts.get("editor:2 Lê", "file:site"))?.content.phone === "(555) 010-0003");
  check("…and stays in the index", same((await drafts.forResource("file:site")).map((row) => row.userId), ["editor:2 Lê"]));

  // KV and index agree.
  const mismatches = await drafts.mismatches();
  check("KV keys and index rows match", !mismatches.onlyInKv.length && !mismatches.onlyInIndex.length, mismatches);
  check("2 drafts left in total", (await store.keys()).length === 2, await store.keys());

  let bad;
  try { parseResourceId("page:home"); } catch (error) { bad = error; }
  check("an unknown resource id is refused", bad instanceof RangeError, String(bad));
  let refused;
  try { await drafts.save({ userId: "owner-1", resource: "file:Bad Key", content: {}, sourceVersion: "x" }); } catch (error) { refused = error; }
  check("save refuses a bad resource id and writes nothing", refused instanceof RangeError && (await store.keys()).length === 2, String(refused));
  return checks;
};
