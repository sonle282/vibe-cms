// Draft-store scenario, run against the memory store (unit test) and against local D1 in wrangler dev
// (scripts/store-local.mjs). Returns a list of checks instead of throwing, so the Worker can report them as JSON.
import { canonicalJson, DraftConflictError, DraftTooLargeError, MAX_DRAFT_BYTES, parseResourceId } from "../../dist/store/index.js";

const outcome = async (promise) => { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; } };

export const runStoreScenario = async ({ drafts }) => {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail: JSON.parse(JSON.stringify(detail ?? null, (_, value) => (value instanceof Error ? String(value) : value))) }) });
  const same = (a, b) => canonicalJson(a) === canonicalJson(b);

  // Save / read one draft of a file.
  const first = await drafts.save({ userId: "usr_owner1", resource: "file:site", label: "Salon info", content: { phone: "(555) 010-0001" }, sourceVersion: "sha256:aaa" });
  const read = await drafts.get("usr_owner1", "file:site");
  check("save → get returns the same draft", same(read, first), { read, first });
  check("first save has revision 1", first.revision === 1, first);
  let rows = await drafts.mine("usr_owner1");
  check("summary row matches the draft (no content)", rows.length === 1 && same(rows[0], { userId: "usr_owner1", resource: "file:site", label: "Salon info", sourceVersion: "sha256:aaa", revision: 1, updatedAt: first.updatedAt, kind: "file", resourceKey: "site", itemId: null }), rows);

  // Save again: revision +1; a stale expectedRevision is refused and changes nothing.
  const second = await drafts.save({ userId: "usr_owner1", resource: "file:site", content: { phone: "(555) 010-0002" }, sourceVersion: "sha256:aaa", expectedRevision: 1 });
  check("second save → revision 2, label kept", second.revision === 2 && second.label === "Salon info", second);
  const stale = await outcome(drafts.save({ userId: "usr_owner1", resource: "file:site", content: { phone: "lost" }, sourceVersion: "sha256:aaa", expectedRevision: 1 }));
  check("stale expectedRevision → DraftConflictError (current 2)", !stale.ok && stale.error instanceof DraftConflictError && stale.error.current === 2, stale);
  check("the refused save changed nothing", (await drafts.get("usr_owner1", "file:site")).content.phone === "(555) 010-0002");

  // Two saves with the same expected revision at (almost) the same time: exactly one wins.
  const race = await Promise.all([
    outcome(drafts.save({ userId: "usr_owner1", resource: "file:site", content: { phone: "A" }, sourceVersion: "sha256:aaa", expectedRevision: 2 })),
    outcome(drafts.save({ userId: "usr_owner1", resource: "file:site", content: { phone: "B" }, sourceVersion: "sha256:aaa", expectedRevision: 2 })),
  ]);
  const winners = race.filter((result) => result.ok);
  const stored = await drafts.get("usr_owner1", "file:site");
  check("concurrent saves on revision 2: exactly one succeeds", winners.length === 1 && race.find((result) => !result.ok)?.error instanceof DraftConflictError, race);
  check("…and the stored draft is the winner's, revision 3", stored.revision === 3 && stored.content.phone === winners[0]?.value.content.phone, stored);
  const createRace = await Promise.all([0, 1].map((index) => outcome(drafts.save({ userId: "usr_owner1", resource: "item:services:new-one", label: "New", content: { name: `copy ${index}` }, sourceVersion: "new", expectedRevision: 0 }))));
  check("concurrent first saves (expectedRevision 0): exactly one creates the draft", createRace.filter((result) => result.ok).length === 1, createRace);
  await drafts.discard("usr_owner1", "item:services:new-one");

  // Two people, same file: two drafts, neither overwrites the other.
  await drafts.save({ userId: "usr_editor2", resource: "file:site", label: "Salon info", content: { phone: "(555) 010-0003" }, sourceVersion: "sha256:aaa" });
  const mine = await drafts.get("usr_owner1", "file:site");
  const theirs = await drafts.get("usr_editor2", "file:site");
  check("two users' drafts of one file are separate", mine.content.phone === stored.content.phone && theirs.content.phone === "(555) 010-0003", { mine, theirs });
  check("forResource lists both, newest first", same((await drafts.forResource("file:site")).map((row) => row.userId), ["usr_editor2", "usr_owner1"]));

  // Two items of the same collection file: separate drafts.
  await drafts.save({ userId: "usr_owner1", resource: "item:services:classic-manicure", label: "Classic Manicure", content: { price: "$22" }, sourceVersion: "sha256:m1" });
  await drafts.save({ userId: "usr_owner1", resource: "item:services:spa-pedicure", label: "Spa Pedicure", content: { price: "$38" }, sourceVersion: "sha256:p1" });
  const a = await drafts.get("usr_owner1", "item:services:classic-manicure");
  const b = await drafts.get("usr_owner1", "item:services:spa-pedicure");
  check("two items in one collection file are separate drafts", a.content.price === "$22" && b.content.price === "$38", { a, b });
  rows = await drafts.mine("usr_owner1");
  check("My drafts: 3 rows with item ids", same(rows.map((row) => row.resource).sort(), ["file:site", "item:services:classic-manicure", "item:services:spa-pedicure"]) && rows.find((row) => row.resource === "item:services:spa-pedicure")?.itemId === "spa-pedicure", rows);

  // Discard one; publish clears only the publisher's draft.
  check("discard reports a removed draft", (await drafts.discard("usr_owner1", "item:services:spa-pedicure")) === true);
  check("discard removes it", (await drafts.get("usr_owner1", "item:services:spa-pedicure")) === undefined && !(await drafts.mine("usr_owner1")).some((row) => row.resource === "item:services:spa-pedicure"));
  check("discard of nothing reports false", (await drafts.discard("usr_owner1", "item:services:spa-pedicure")) === false);
  await drafts.clearAfterPublish("usr_owner1", "file:site");
  check("after publish the publisher's draft is gone", (await drafts.get("usr_owner1", "file:site")) === undefined);
  check("…and the other user's draft of that file stays", (await drafts.get("usr_editor2", "file:site"))?.content.phone === "(555) 010-0003" && same((await drafts.forResource("file:site")).map((row) => row.userId), ["usr_editor2"]));

  // Size: a 1.5 MB draft fits (the largest content file seen is ~750 KB); over MAX_DRAFT_BYTES is refused.
  const big = { text: "x".repeat(1_500_000) };
  const saved = await outcome(drafts.save({ userId: "usr_owner1", resource: "file:big", content: big, sourceVersion: "v" }));
  check("a 1.5 MB draft is stored and read back", saved.ok && (await drafts.get("usr_owner1", "file:big"))?.content.text.length === 1_500_000, saved.ok ? "read back differs" : saved.error);
  const tooBig = await outcome(drafts.save({ userId: "usr_owner1", resource: "file:big", content: { text: "x".repeat(MAX_DRAFT_BYTES) }, sourceVersion: "v" }));
  check("a draft over MAX_DRAFT_BYTES → DraftTooLargeError, old draft kept", !tooBig.ok && tooBig.error instanceof DraftTooLargeError && (await drafts.get("usr_owner1", "file:big"))?.revision === 1, tooBig);
  await drafts.discard("usr_owner1", "file:big");

  // Ids: internal user ids only (never an email); resource ids checked.
  const email = await outcome(drafts.save({ userId: "owner@example.com", resource: "file:site", content: {}, sourceVersion: "x" }));
  check("an email as user id is refused", !email.ok && email.error instanceof RangeError && /never an email/.test(email.error.message), email);
  const badResource = await outcome(drafts.save({ userId: "usr_owner1", resource: "file:Bad Key", content: {}, sourceVersion: "x" }));
  check("a bad resource id is refused", !badResource.ok && badResource.error instanceof RangeError, badResource);
  let bad;
  try { parseResourceId("page:home"); } catch (error) { bad = error; }
  check("an unknown resource kind is refused", bad instanceof RangeError, String(bad));
  check("2 drafts left in total", (await drafts.mine("usr_owner1")).length + (await drafts.mine("usr_editor2")).length === 2);
  return checks;
};
