// P5 end-to-end scenario for the CMS API, run by test/api.test.mjs (API in Node) and scripts/api-local.mjs (API in a
// Worker under `wrangler dev --local`). The fake GitHub always runs in Node. Returns checks instead of throwing.
//   request(method, path, { body, user, origin, raw }) → { status, body, headers }
//   github      fake GitHub (test/helpers/fake-github.mjs)
//   redeploy()  make the API's "live" content equal the branch head (a site rebuild after publish)
//   auditRows() every audit row, oldest first
import { lineDiff } from "./diff.mjs";

const OWNER = "usr_owner1:owner";
const EDITOR = "usr_editor1:editor";

export const runApiScenario = async ({ request, github, redeploy, auditRows }) => {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail: JSON.stringify(detail ?? null).slice(0, 1500) }) });
  const as = (user) => ({
    get: (path) => request("GET", path, { user }),
    put: (path, body, options = {}) => request("PUT", path, { user, body, ...options }),
    del: (path) => request("DELETE", path, { user }),
    publish: (resources, options = {}) => request("POST", "/api/cms/publish", { user, body: { resources }, ...options }),
  });
  const owner = as(OWNER); const editor = as(EDITOR);
  const oneLine = (before, after) => { const diff = lineDiff(before, after); return diff.removed.length === 1 && diff.added.length === 1; };

  // ---- identity, routes, headers
  const anonymous = await request("GET", "/api/cms/content", {});
  check("no identity → 401 unauthenticated", anonymous.status === 401 && anonymous.body.error === "unauthenticated", anonymous);
  const listing = await editor.get("/api/cms/content");
  check("GET /content lists files + collections from cms.config", listing.status === 200 && listing.body.files[0]?.key === "site" && listing.body.collections[0]?.count === 3, listing);
  check("…with the x-cms-live-version header", /^sha256:[0-9a-f]{64}$/.test(listing.headers["x-cms-live-version"] ?? ""), listing.headers);
  const liveVersion = await editor.get("/api/cms/live-version");
  check("GET /live-version = the header", liveVersion.body.liveVersion === listing.headers["x-cms-live-version"], liveVersion);
  const site = await editor.get("/api/cms/files/site");
  check("GET /files/site: live content, version, no draft", site.status === 200 && site.body.content.name === "Demo Salon" && /^sha256:/.test(site.body.version) && site.body.draft === null, site);
  const services = await editor.get("/api/cms/collections/services");
  check("GET /collections/services: 3 records with labels", services.status === 200 && services.body.items.map((item) => item.label).join("|") === "Classic Manicure|Spa Pedicure|Nail Art", services);
  check("unknown route → 404; wrong method → 405", (await editor.get("/api/cms/nope")).status === 404 && (await request("PATCH", "/api/cms/files/site", { user: EDITOR, body: {} })).status === 405);

  // ---- PUT draft: validation, CSRF, locks, types, revisions
  const content = { ...site.body.content, tagline: "Fresh tagline from the editor" };
  const noRevision = await editor.put("/api/cms/files/site", { content });
  check("PUT without expectedRevision → 400 expected_revision_required", noRevision.status === 400 && noRevision.body.error === "expected_revision_required", noRevision);
  const evil = await editor.put("/api/cms/files/site", { content, expectedRevision: 0 }, { origin: "https://evil.example" });
  const noOrigin = await editor.put("/api/cms/files/site", { content, expectedRevision: 0 }, { origin: null });
  check("PUT from another origin or without Origin → 403 origin_forbidden", evil.status === 403 && evil.body.error === "origin_forbidden" && noOrigin.status === 403, { evil, noOrigin });
  const badJson = await request("PUT", "/api/cms/files/site", { user: EDITOR, raw: "{ not json" });
  check("PUT with a broken JSON body → 400 bad_json", badJson.status === 400 && badJson.body.error === "bad_json", badJson);
  const tooBig = await request("PUT", "/api/cms/files/site", { user: EDITOR, raw: JSON.stringify({ content: { x: "x".repeat(2_100_000) }, expectedRevision: 0 }) });
  check("PUT larger than the body limit → 413", tooBig.status === 413 && tooBig.body.error === "payload_too_large", { status: tooBig.status, body: tooBig.body });
  const locked = await editor.put("/api/cms/files/site", { content: { ...content, phone: "(555) 999-1111" }, expectedRevision: 0, sourceVersion: site.body.version });
  check("editor PUT changing Phone → 403 locked_field with the field, no value", locked.status === 403 && locked.body.error === "locked_field" && locked.body.fields[0].path === "phone" && !JSON.stringify(locked.body).includes("999-1111"), locked);
  const wrongType = await editor.put("/api/cms/files/site", { content: { ...content, tagline: 42 }, expectedRevision: 0, sourceVersion: site.body.version });
  check("PUT with a wrong type → 422 invalid_content (P2 check)", wrongType.status === 422 && wrongType.body.errors[0].path === "tagline", wrongType);
  const noSource = await editor.put("/api/cms/files/site", { content, expectedRevision: 0 });
  check("a new draft without sourceVersion → 400 source_version_required", noSource.status === 400 && noSource.body.error === "source_version_required", noSource);
  const saved = await editor.put("/api/cms/files/site", { content, expectedRevision: 0, sourceVersion: site.body.version });
  check("editor PUT tagline, expectedRevision 0 → saved, revision 1", saved.status === 200 && saved.body.draft.revision === 1 && saved.body.draft.stale === false, saved);
  const stale = await editor.put("/api/cms/files/site", { content, expectedRevision: 0, sourceVersion: site.body.version });
  const resave = await editor.put("/api/cms/files/site", { content: { ...content, tagline: "Fresh tagline from the editor" }, expectedRevision: 1, sourceVersion: "sha256:0000000000000000000000000000000000000000000000000000000000000000" });
  check("saving an existing draft keeps the sourceVersion it started from (a new one is ignored)", resave.status === 200 && resave.body.draft.revision === 2 && resave.body.draft.sourceVersion === site.body.version, resave);
  check("PUT again with expectedRevision 0 → 409 draft_conflict (current 1)", stale.status === 409 && stale.body.error === "draft_conflict" && stale.body.currentRevision === 1, stale);
  const withDraft = await editor.get("/api/cms/files/site");
  check("GET shows my draft next to the live content", withDraft.body.draft?.content.tagline === "Fresh tagline from the editor" && withDraft.body.content.tagline !== withDraft.body.draft.content.tagline, withDraft);
  check("the owner does not see the editor's draft", (await owner.get("/api/cms/files/site")).body.draft === null);

  // ---- publish one file: one commit, one changed line, author, message, no force, draft cleared
  const head0 = github.head();
  const before0 = github.files()["src/data/site.json"];
  const published = await editor.publish(["file:site"]);
  const commit1 = github.commit();
  check("publish → 200 with the commit sha", published.status === 200 && published.body.commitSha === github.head() && published.body.attempts === 1, published);
  check("…exactly 1 new commit on top of the old head", github.commitsSince(head0).length === 1 && commit1.parents[0] === head0, github.commitsSince(head0));
  check("…changing only src/data/site.json, by exactly 1 line", github.changedPaths(head0).join() === "src/data/site.json" && oneLine(before0, github.files()["src/data/site.json"]), lineDiff(before0, github.files()["src/data/site.json"]));
  check("…author Vibe CMS <noreply>, message with the label + internal user id (no email)", commit1.author.name === "Vibe CMS" && /noreply/.test(commit1.author.email) && commit1.message.includes("Salon info") && commit1.message.includes("usr_editor1") && !commit1.message.includes("@"), commit1);
  check("…branch updated without force", github.forcedUpdates() === 0);
  check("…the publisher's draft is gone", (await editor.get("/api/cms/files/site")).body.draft === null);
  check("…expectedLiveVersion returned", /^sha256:/.test(published.body.expectedLiveVersion ?? "") && published.body.expectedLiveVersion !== listing.headers["x-cms-live-version"], published.body);
  await redeploy();
  check("after the rebuild, live-version = expectedLiveVersion", (await editor.get("/api/cms/live-version")).body.liveVersion === published.body.expectedLiveVersion);

  // ---- publish several resources = one commit (owner: phone + one price + a new record)
  const site2 = (await owner.get("/api/cms/files/site")).body;
  await owner.put("/api/cms/files/site", { content: { ...site2.content, phone: "(555) 010-2222" }, expectedRevision: 0, sourceVersion: site2.version });
  const pedicure = (await owner.get("/api/cms/collections/services/items/spa-pedicure")).body;
  await owner.put("/api/cms/collections/services/items/spa-pedicure", { content: { ...pedicure.content, price: "$36" }, expectedRevision: 0, sourceVersion: pedicure.version });
  const newItem = await owner.put("/api/cms/collections/services/items/gel-x", { content: { id: "gel-x", name: "Gel-X Extensions", price: "$60", category: "Nails", extras: [] }, expectedRevision: 0, sourceVersion: "new" });
  check("owner PUT of a new record (new id) → saved", newItem.status === 200, newItem);
  const head1 = github.head();
  const servicesBefore = github.files()["src/data/services.json"];
  const multi = await owner.publish(["file:site", "item:services:spa-pedicure", "item:services:gel-x"]);
  check("publish 3 resources in 2 files → 200, exactly 1 commit", multi.status === 200 && github.commitsSince(head1).length === 1, multi);
  check("…changing exactly site.json + services.json", github.changedPaths(head1).join() === "src/data/services.json,src/data/site.json", github.changedPaths(head1));
  const servicesDiff = lineDiff(servicesBefore, github.files()["src/data/services.json"]);
  // One-line records: the price line, the comma on the previous last record, and the new record's line — nothing else.
  check("…services.json: price line + comma on the old last line + the new record's line", servicesDiff.removed.length === 2 && servicesDiff.added.length === 3 && servicesDiff.added.map((line) => line.text.match(/"id": "([^"]+)"/)?.[1]).join() === "spa-pedicure,nail-art,gel-x" && servicesDiff.added[0].text.includes('"$36"'), servicesDiff);
  await redeploy();

  // ---- 409 when the branch changed the same record; another record's change does not block
  const mani = (await editor.get("/api/cms/collections/services/items/classic-manicure")).body;
  await editor.put("/api/cms/collections/services/items/classic-manicure", { content: { ...mani.content, name: "Classic Manicure Deluxe" }, expectedRevision: 0, sourceVersion: mani.version });
  const listBefore = JSON.parse(github.files()["src/data/services.json"]);
  github.pushOther({ "src/data/services.json": JSON.stringify(listBefore.map((item) => (item.id === "nail-art" ? { ...item, name: "Nail Art Studio" } : item)), null, 2) + "\n" }, "someone edits another record");
  const otherRecord = await editor.publish(["item:services:classic-manicure"]);
  check("another record changed on the branch → still publishes (record versions)", otherRecord.status === 200, otherRecord);
  check("…and keeps that other change", JSON.parse(github.files()["src/data/services.json"]).find((item) => item.id === "nail-art").name === "Nail Art Studio");
  await redeploy();
  const mani2 = (await editor.get("/api/cms/collections/services/items/classic-manicure")).body;
  await editor.put("/api/cms/collections/services/items/classic-manicure", { content: { ...mani2.content, name: "Classic Manicure Supreme" }, expectedRevision: 0, sourceVersion: mani2.version });
  const current = JSON.parse(github.files()["src/data/services.json"]);
  github.pushOther({ "src/data/services.json": JSON.stringify(current.map((item) => (item.id === "classic-manicure" ? { ...item, extras: ["Hand massage"] } : item)), null, 2) + "\n" }, "someone edits the same record");
  const headConflict = github.head();
  const conflict = await editor.publish(["item:services:classic-manicure"]);
  check("the same record changed on the branch → 409 source_changed, no commit", conflict.status === 409 && conflict.body.error === "source_changed" && github.head() === headConflict, conflict);
  check("…the draft is kept", (await editor.get("/api/cms/collections/services/items/classic-manicure")).body.draft?.content.name === "Classic Manicure Supreme");
  await editor.del("/api/cms/collections/services/items/classic-manicure");
  await redeploy();

  // ---- the branch moves during publish → retry; keeps moving → 502, nothing half-done
  const site3 = (await editor.get("/api/cms/files/site")).body;
  await editor.put("/api/cms/files/site", { content: { ...site3.content, tagline: "Retry tagline" }, expectedRevision: 0, sourceVersion: site3.version });
  github.moveBranchBeforeRefUpdate(1, { "README.md": "someone else's commit\n" });
  const retried = await editor.publish(["file:site"]);
  const retryCommit = github.commit();
  check("branch moved once during publish → re-read, retried, published (attempt 2)", retried.status === 200 && retried.body.attempts === 2, retried);
  check("…on top of the other commit, which is kept", github.commit(retryCommit.parents[0]).message === "moved during publish" && github.files()["README.md"] === "someone else's commit\n");
  await redeploy();
  const site4 = (await editor.get("/api/cms/files/site")).body;
  await editor.put("/api/cms/files/site", { content: { ...site4.content, tagline: "Never lands" }, expectedRevision: 0, sourceVersion: site4.version });
  github.moveBranchBeforeRefUpdate(3, { "README.md": "busy branch\n" });
  const busy = await editor.publish(["file:site"]);
  check("branch keeps moving (3 tries) → 502 publish_failed code branch_moving", busy.status === 502 && busy.body.error === "branch_moving", busy);
  check("…the tagline never reached the branch; the draft is kept", !github.files()["src/data/site.json"].includes("Never lands") && (await editor.get("/api/cms/files/site")).body.draft?.content.tagline === "Never lands");
  await editor.del("/api/cms/files/site");
  await redeploy();

  // ---- P5b: open A → someone else publishes B → save a draft started from A → publish → 409
  const openedA = (await editor.get("/api/cms/files/site")).body;
  const ownerB = (await owner.get("/api/cms/files/site")).body;
  await owner.put("/api/cms/files/site", { content: { ...ownerB.content, tagline: "Owner published B" }, expectedRevision: 0, sourceVersion: ownerB.version });
  const publishedB = await owner.publish(["file:site"]);
  await redeploy();
  const draftA = await editor.put("/api/cms/files/site", { content: { ...openedA.content, name: "Demo Salon A" }, expectedRevision: 0, sourceVersion: openedA.version });
  check("draft from A saved after B was published and deployed (sourceVersion = A, not live B)", publishedB.status === 200 && draftA.status === 200 && draftA.body.draft.sourceVersion === openedA.version && draftA.body.draft.stale === true, { publishedB, draftA });
  const headB = github.head();
  const publishA = await editor.publish(["file:site"]);
  check("…publishing it → 409 source_changed, nothing committed (B is not overwritten)", publishA.status === 409 && publishA.body.error === "source_changed" && github.head() === headB && github.files()["src/data/site.json"].includes("Owner published B"), publishA);
  await editor.del("/api/cms/files/site");

  // ---- a rate-limited GitHub → 503 with retryAfter, audited, draft kept
  const site5 = (await editor.get("/api/cms/files/site")).body;
  await editor.put("/api/cms/files/site", { content: { ...site5.content, tagline: "Rate limited" }, expectedRevision: 0, sourceVersion: site5.version });
  github.failNext("GET", /git\/ref\/heads\//, 429, { headers: { "retry-after": "600" } });
  const limited = await editor.publish(["file:site"]);
  check("GitHub rate limit (retry-after 600 s) → 503 github_rate_limited + retryAfter, draft kept", limited.status === 503 && limited.body.error === "github_rate_limited" && limited.body.retryAfter === 600 && (await editor.get("/api/cms/files/site")).body.draft?.content.tagline === "Rate limited", limited);
  await editor.del("/api/cms/files/site");

  // ---- the role at publish time decides
  const pedicure2 = (await owner.get("/api/cms/collections/services/items/spa-pedicure")).body;
  await owner.put("/api/cms/collections/services/items/spa-pedicure", { content: { ...pedicure2.content, price: "$37" }, expectedRevision: 0, sourceVersion: pedicure2.version });
  const headDenied = github.head();
  const demoted = await request("POST", "/api/cms/publish", { user: "usr_owner1:editor", body: { resources: ["item:services:spa-pedicure"] } });
  check("draft saved as owner, published after becoming editor → 403 locked_field, no commit", demoted.status === 403 && demoted.body.error === "locked_field" && github.head() === headDenied, demoted);
  const noDraft = await editor.publish(["item:services:nail-art"]);
  check("publishing without a draft → 404 no_draft", noDraft.status === 404 && noDraft.body.error === "no_draft", noDraft);
  const deleted = await owner.del("/api/cms/collections/services/items/spa-pedicure");
  const deletedAgain = await owner.del("/api/cms/collections/services/items/spa-pedicure");
  check("DELETE my draft → deleted true, then false", deleted.body.deleted === true && deletedAgain.body.deleted === false, { deleted, deletedAgain });

  // ---- audit: every step, never a value
  const rows = await auditRows();
  const actions = new Set(rows.map((row) => `${row.action}/${row.stage}`));
  check("audit has started, succeeded, failed, denied (draft + publish)", ["started/publish", "succeeded/publish", "failed/publish", "denied/draft", "denied/publish"].every((action) => actions.has(action)), [...actions]);
  check("succeeded rows carry the commit sha", rows.filter((row) => row.action === "succeeded").every((row) => /^[0-9a-f]{40}$/.test(row.detail.commitSha ?? "")), rows.filter((row) => row.action === "succeeded"));
  check("failed rows carry the error code", ["source_changed", "branch_moving", "github_rate_limited"].every((code) => rows.some((row) => row.action === "failed" && row.detail.code === code)), rows.filter((row) => row.action === "failed"));
  check("no content value in any audit row", !JSON.stringify(rows).match(/999-1111|010-2222|Retry tagline|Never lands|\$36|Rate limited|Owner published B/), rows);
  check("audit user ids are internal ids", rows.every((row) => /^usr_/.test(row.userId)));
  return checks;
};
