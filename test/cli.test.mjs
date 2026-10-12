// P11: the `vibe-cms` CLI without Cloudflare — wrangler.jsonc edits that keep the file, `setup` against a fake wrangler
// (resources created once, second run changes nothing, --account, another site's binding refused, not signed in),
// `check` on the site wiring, `update` helpers and argument errors. The local-D1 paths (setup --local, export / import,
// reset-owner-password) run on real wrangler in scripts/cli-local.mjs; the install from a release URL in scripts/install-local.mjs.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkWiring, limiterNamespaces, r2Names, releaseUrl, RELEASE_URL, run, siteActions, upsertBindings } from "../dist/cli/index.js";

const demo = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
const fake = fileURLToPath(new URL("./helpers/fake-wrangler.mjs", import.meta.url));
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A copy of the demo site's config files in a temp folder + a fake Cloudflare account. */
const site = (wrangler = readFileSync(join(demo, "wrangler.jsonc"), "utf8")) => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-cli-"));
  dirs.push(root);
  for (const name of ["package.json", "cms.config.ts"]) cpSync(join(demo, name), join(root, name));
  writeFileSync(join(root, "wrangler.jsonc"), wrangler);
  const state = join(root, "fake-cf.json");
  writeFileSync(state, "{}");
  return { root, state, read: () => JSON.parse(readFileSync(state, "utf8")), config: () => readFileSync(join(root, "wrangler.jsonc"), "utf8") };
};
const cli = async (root, argv, env = {}) => {
  const out = [], err = [];
  const saved = { ...process.env };
  Object.assign(process.env, { VIBE_CMS_WRANGLER: fake, FAKE_CF_STATE: join(root, "fake-cf.json") }, env);
  try { const code = await run(argv, { root, log: (line) => out.push(line), error: (line) => err.push(line) }); return { code, out: out.join("\n"), err: err.join("\n") }; }
  finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
};

test("upsertBindings keeps comments, order, other bindings and the file's style; nothing to do = same text", () => {
  const text = "// my site\r\n{\r\n\t\"name\": \"x\", // worker\r\n\t\"d1_databases\": [\r\n\t\t{ \"binding\": \"OTHER\", \"database_name\": \"other\", \"database_id\": \"1\" },\r\n\t\t{ \"binding\": \"CMS_DB\", \"database_name\": \"a-cms\", \"database_id\": \"old\", \"preview_database_id\": \"keep\" }\r\n\t],\r\n}\r\n";
  const entries = [
    { list: "d1_databases", name: "CMS_DB", values: { database_name: "a-cms", database_id: "new" } },
    { list: "kv_namespaces", name: "SESSION", values: { id: "kv1" } },
    { list: "ratelimits", name: "CMS_LOGIN_LIMITER", values: { namespace_id: "1", simple: { limit: 10, period: 60 } } },
  ];
  const { text: out, changes } = upsertBindings(text, "wrangler.jsonc", entries);
  assert.deepEqual(changes, ['CMS_DB.database_id: "old" → "new"', "SESSION: added", "CMS_LOGIN_LIMITER: added"]);
  assert.ok(out.startsWith("// my site\r\n{\r\n\t\"name\": \"x\", // worker\r\n"), "comments and the first lines are untouched");
  assert.match(out, /"binding": "OTHER", "database_name": "other", "database_id": "1" \}/, "another binding is untouched");
  assert.match(out, /"database_id": "new", "preview_database_id": "keep"/, "only the changed key of the entry is rewritten");
  assert.ok(out.split("\r\n").every((line) => !/^ /.test(line)), "tab indentation kept");
  assert.ok(!/[^\r]\n/.test(out), "CRLF kept");
  const again = upsertBindings(out, "wrangler.jsonc", entries);
  assert.equal(again.text, out, "second time: identical text");
  assert.deepEqual(again.changes, []);
  const appended = upsertBindings(out, "wrangler.jsonc", [{ list: "d1_databases", name: "THIRD", values: { database_name: "t" } }]);
  assert.match(appended.text, /"binding": "CMS_DB"[\s\S]*"binding": "THIRD"/, "a new binding is added at the end of its list");
  assert.throws(() => upsertBindings("{ nope", "w.jsonc", entries), /not valid JSONC/);
});

test("setup on a fake account: creates the 3 resources once, writes the bindings, applies the migrations; second run changes nothing", async () => {
  const s = site();
  const first = await cli(s.root, ["setup", "--site", "demo"]);
  assert.equal(first.code, 0, first.err);
  const account = s.read().accounts.default;
  assert.deepEqual([account.d1.map((db) => db.name), account.kv.map((ns) => ns.title), account.r2], [["demo-cms"], ["demo-session"], ["demo-media"]]);
  assert.match(first.out, /D1 demo-cms: created[\s\S]*KV demo-session: created[\s\S]*R2 demo-media: created/);
  assert.match(first.out, /migrations applied \(remote\): 0001_draft_index\.sql, 0002_draft_content\.sql, 0003_audit_log\.sql, 0004_users\.sql, 0005_audit_log_auth\.sql/);
  assert.match(first.out, /wrangler secret put VIBE_GITHUB_TOKEN/, "next steps name the secrets; the CLI never sets them");
  const config = s.config();
  assert.ok(config.startsWith("// Local only (wrangler dev)."), "the comment at the top is kept");
  const parsed = JSON.parse(config.replace(/^\/\/.*$/m, ""));
  const [db] = parsed.d1_databases;
  assert.deepEqual(db, { binding: "CMS_DB", database_name: "demo-cms", database_id: account.d1[0].uuid, migrations_dir: db.migrations_dir });
  assert.ok(existsSync(join(s.root, db.migrations_dir, "0001_draft_index.sql")), "migrations_dir: the package's migrations, relative to wrangler.jsonc");
  assert.deepEqual(parsed.kv_namespaces, [{ binding: "SESSION", id: account.kv[0].id }]);
  assert.deepEqual(parsed.r2_buckets, [{ binding: "CMS_MEDIA", bucket_name: "demo-media" }]);
  const ns = limiterNamespaces("demo");
  assert.deepEqual(parsed.ratelimits, [{ name: "CMS_LOGIN_LIMITER", namespace_id: ns.login, simple: { limit: 10, period: 60 } }, { name: "CMS_PUBLISH_LIMITER", namespace_id: ns.publish, simple: { limit: 20, period: 60 } }]);
  assert.equal(parsed.name, "vibe-cms-demo-site", "the Worker is kept");

  const second = await cli(s.root, ["setup", "--site", "demo"]);
  assert.equal(second.code, 0, second.err);
  assert.equal(s.config(), config, "wrangler.jsonc identical byte for byte");
  assert.match(second.out, /D1 demo-cms: already there[\s\S]*KV demo-session: already there[\s\S]*R2 demo-media: already there[\s\S]*wrangler\.jsonc: already up to date[\s\S]*migrations: up to date/);
  const creates = s.read().calls.filter((call) => call.args.includes("create"));
  assert.equal(creates.length, 3, "nothing created the second time");

  const wired = checkWiring(s.root, join(s.root, "wrangler.jsonc"));
  assert.deepEqual([wired.site, wired.errors], ["demo", []]);
  assert.deepEqual(wired.warnings.map((w) => w.where), ["package.json"], "only: the demo installs the package from file:, not a release URL");
});

test("setup --account: hand-over to another account — resources there, ids follow, names and limits kept", async () => {
  const s = site();
  assert.equal((await cli(s.root, ["setup", "--site", "demo"])).code, 0);
  const before = JSON.parse(s.config().replace(/^\/\/.*$/m, ""));
  const other = "0123456789abcdef0123456789abcdef";
  const moved = await cli(s.root, ["setup", "--site", "demo", "--account", other]);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /Cloudflare account 0123456789abcdef0123456789abcdef/);
  const state = s.read();
  assert.ok(state.calls.filter((call) => call.account === other).length >= 7, "every call of the second run went to the other account");
  const after = JSON.parse(s.config().replace(/^\/\/.*$/m, ""));
  assert.equal(after.d1_databases[0].database_id, state.accounts[other].d1[0].uuid);
  assert.notEqual(after.d1_databases[0].database_id, before.d1_databases[0].database_id);
  assert.equal(after.kv_namespaces[0].id, state.accounts[other].kv[0].id);
  assert.deepEqual(after.ratelimits, before.ratelimits);
  assert.match(moved.out, /CMS_DB\.database_id: "[^"]+" → "[^"]+"/);
  assert.equal((await cli(s.root, ["setup", "--site", "demo", "--account", "nope"])).code, 1);
});

test("setup refuses a binding that points at another site, an invalid site name, and says how to sign in", async () => {
  const s = site('{ "name": "w", "d1_databases": [{ "binding": "CMS_DB", "database_name": "novelle-cms", "database_id": "x" }] }\n');
  const refused = await cli(s.root, ["setup", "--site", "innovate"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /CMS_DB uses the database "novelle-cms", not "innovate-cms"/);
  assert.equal(s.read().calls, undefined, "nothing ran on Cloudflare");
  for (const bad of ["Innovate", "a_b", "-x", ""]) assert.match((await cli(s.root, ["setup", `--site=${bad}`])).err, /--site must be a short name/);
  const t = site();
  writeFileSync(t.state, JSON.stringify({ loggedOut: true }));
  const out = await cli(t.root, ["setup", "--site", "demo"]);
  assert.equal(out.code, 1);
  assert.match(out.err, /not authenticated[\s\S]*→ sign in first: npx wrangler login/);
  assert.equal(t.config(), readFileSync(join(demo, "wrangler.jsonc"), "utf8"), "a failed setup writes nothing");
});

test("check: the wiring must point at this site's own resources only", () => {
  const s = site();
  const write = (config) => { writeFileSync(join(s.root, "wrangler.jsonc"), JSON.stringify(config)); return checkWiring(s.root, join(s.root, "wrangler.jsonc"), "demo"); };
  const good = { d1_databases: [{ binding: "CMS_DB", database_name: "demo-cms", database_id: "u", migrations_dir: fileURLToPath(new URL("../migrations", import.meta.url)) }], kv_namespaces: [{ binding: "SESSION", id: "k" }], r2_buckets: [{ binding: "CMS_MEDIA", bucket_name: "demo-media" }], ratelimits: [{ name: "CMS_LOGIN_LIMITER", namespace_id: "1" }, { name: "CMS_PUBLISH_LIMITER", namespace_id: "2" }] };
  assert.deepEqual(write(good).errors, []);
  assert.match(write({ ...good, r2_buckets: [{ binding: "CMS_MEDIA", bucket_name: "novelle-media" }] }).errors[0].message, /another site's images/);
  assert.match(write({ ...good, d1_databases: [{ ...good.d1_databases[0], database_name: "novelle-cms" }] }).errors[0].message, /another site's data/);
  assert.deepEqual(write({ ...good, ratelimits: [] }).errors.map((e) => e.message.split(" is missing")[0]), ["rate limit CMS_LOGIN_LIMITER", "rate limit CMS_PUBLISH_LIMITER"]);
  assert.match(write({ ...good, kv_namespaces: [] }).errors[0].message, /nobody can sign in/);
  assert.match(write({ ...good, r2_buckets: [] }).warnings.find((w) => w.where === "wrangler.jsonc").message, /uploading images is off/);
  assert.match(write({ ...good, d1_databases: [{ ...good.d1_databases[0], database_id: "local-demo-cms" }] }).warnings[0].message, /placeholder id/);
  assert.match(write({ ...good, d1_databases: [{ ...good.d1_databases[0], migrations_dir: "nowhere" }] }).errors[0].message, /holds no CMS migrations/);
  assert.match(checkWiring(s.root, join(s.root, "wrangler.jsonc")).site, /^demo$/, "the site comes from <site>-cms when --site is not given");
  writeFileSync(join(s.root, "wrangler.jsonc"), "{}");
  assert.match(checkWiring(s.root, join(s.root, "wrangler.jsonc")).errors[0].message, /CMS_DB \(D1\) is missing/);
});

test("release URLs, r2 list parsing, rate-limit namespaces, CHANGELOG site actions", () => {
  assert.equal(releaseUrl("0.14.0"), "https://github.com/sonle282/vibe-cms/releases/download/v0.14.0/vibe-cms-0.14.0.tgz");
  assert.ok(RELEASE_URL.test(releaseUrl("1.2.3")));
  assert.ok(!RELEASE_URL.test("https://github.com/sonle282/vibe-cms/releases/download/v1.2.3/vibe-cms-1.2.4.tgz"));
  assert.deepEqual(r2Names("Listing buckets...\nname:           a-media\ncreation_date:  x\n\nname:           b\ncreation_date:  y\n"), ["a-media", "b"]);
  assert.deepEqual(r2Names("Listing buckets...\n"), []);
  assert.deepEqual(limiterNamespaces("demo"), limiterNamespaces("demo"), "the same site always gets the same namespaces");
  assert.notDeepEqual(limiterNamespaces("innovate"), limiterNamespaces("novelle"));
  assert.equal(Number(limiterNamespaces("x").publish), Number(limiterNamespaces("x").login) + 1);
  const changelog = "# C\n\n## 0.3.0 — x\n\n- a\n- Site action: do C\n  over two lines.\n\n## 0.2.0 — y\n\n- **Site action:** do B\n\n## 0.1.0\n\n- Site action: do A\n";
  assert.deepEqual(siteActions(changelog, "0.1.0", "0.3.0"), ["0.2.0: do B", "0.3.0: do C over two lines."]);
  assert.deepEqual(siteActions(changelog, "0.3.0", "0.3.0"), []);
  assert.deepEqual(siteActions(readFileSync(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8"), "0.12.0", "0.13.0").length, 1, "the real CHANGELOG parses");
});

test("command line: help, version, unknown command / option, missing arguments", async () => {
  const s = site();
  assert.match((await cli(s.root, ["help"])).out, /setup --site <site>[\s\S]*reset-admin-password[\s\S]*Old name:\s+reset-owner-password/);
  assert.match((await cli(s.root, ["--version"])).out, /^\d+\.\d+\.\d+$/);
  assert.match((await cli(s.root, ["deploy"])).err, /unknown command "deploy"/);
  assert.match((await cli(s.root, ["setup", "--sight", "x"])).err, /Unknown option '--sight'/);
  assert.match((await cli(s.root, ["export"])).err, /export needs --out/);
  assert.match((await cli(s.root, ["import"])).err, /import needs --file/);
  assert.match((await cli(s.root, ["update", "1.0", "2.0"])).err, /update takes one version/);
  assert.match((await cli(s.root, ["update", "latest-ish"])).err, /is not a version/);
  const other = mkdtempSync(join(tmpdir(), "vibe-cms-cli-")); dirs.push(other);
  assert.match((await cli(other, ["migrate"])).err, /no wrangler\.jsonc/);
  writeFileSync(join(other, "wrangler.toml"), "name = 'x'\n");
  assert.match((await cli(other, ["migrate"])).err, /uses wrangler\.toml/);
  assert.match((await cli(s.root, ["update"], { VIBE_CMS_GITHUB_API_URL: "https://evil.example" })).err, /may only point to this machine/);
});
