// P8c: rich text is cleaned on the server (hast, the same allow-list as the first site's CMS) — what stays, what goes,
// clean input byte for byte, only what a user changed, Markdown bodies, the size limit, the API (save + publish), the
// build-time warning.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkContent, contentPaths, createBundledSource, createCmsApi, createGitHubPublisher, createMemoryAuditLog, createMemoryDraftStore, f, loadCmsConfig } from "../dist/index.js";
import { RICH_TEXT_MAX_CHARS, sanitizeRecord, sanitizeRichText } from "../dist/check/rich-text.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});

const DANGER = /<\s*(script|style|iframe|object|embed|form|svg|math|base|meta|link|textarea)\b|\son[a-z]+\s*=|javascript:|vbscript:|data:|\sstyle\s*=|srcdoc/i;

test("clean HTML in normal form comes back byte for byte; other clean HTML is only re-formatted (nothing reported removed)", () => {
  for (const html of [
    "<p>Hi <strong>there</strong></p>",
    "<p>a &amp; b &lt; c</p>",
    "<p>café “quotes” — dash</p>",
    '<a href="/services/" target="_blank" rel="noopener">Services</a>',
    '<a href="https://example.org/x?y=1&amp;z=2" title="Out">x</a> <a href="mailto:hi@demo.example">mail</a> <a href="tel:+15550100">call</a>',
    '<ul class="list"><li>One</li><li>Two</li></ul><ol><li>1</li></ol>',
    '<figure><img src="/images/hero.svg" alt="Hero" width="64" height="64" loading="lazy"><figcaption>Cap</figcaption></figure>',
    "<h2>Title</h2><h3>Sub</h3><blockquote>Quote</blockquote><pre><code>x = 1</code></pre><hr>",
    "Plain text with **Markdown** and [a link](/x).",
    "",
  ]) {
    const result = sanitizeRichText(html);
    assert.deepEqual([result.changed, result.html], [false, html], html);
  }
  for (const [html, normal] of [["<P>Upper<BR/>case</P>", "<p>Upper<br>case</p>"], ["a < b & c > d", "a &lt; b &amp; c > d"], ["<p>x</p", "<p>x</p>"]]) {
    const result = sanitizeRichText(html);
    assert.deepEqual([result.html, result.changed], [normal, true], html);
    assert.deepEqual(sanitizeRichText(result.html), { html: normal, changed: false, removed: [] }, "the normal form is stable");
  }
  assert.deepEqual(sanitizeRichText("<P>Upper<BR/>case</P>").removed, []);
  // Markdown keeps its text unless something unsafe is removed ("<" in a code sample stays "<").
  assert.deepEqual(sanitizeRichText("Use `a < b` & **bold**", { markdown: true }), { html: "Use `a < b` & **bold**", changed: false, removed: [] });
});

test("an unfinished tag at the end is not kept as typed (it would become live markup next to the page's own HTML)", () => {
  const result = sanitizeRichText('<p>Hi</p><img src=x onerror="alert(1)"//');
  assert.equal(result.html, "<p>Hi</p>");
  assert.ok(result.removed.includes("an unfinished tag at the end"));
  assert.doesNotMatch(sanitizeRichText("Hello <img src=x onerror=alert(1)", { markdown: true }).html, /onerror/);
});

test("every kind of attack is removed (one case or more each) and named", () => {
  const cases = [
    ["<p>Hi</p><script>alert(1)</script>", "<script>"],
    ["<ScRiPt>alert(1)</sCrIpT><p>x</p>", "<script>"],
    ["<scr<script>ipt>alert(1)</script>", null], // parsed as an unknown element "scr<script": dropped, never run
    ["<style>body{display:none}</style><p>x</p>", "<style>"],
    ['<iframe src="https://evil.example"></iframe>', "<iframe>"],
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe>', "<iframe>"],
    ['<object data="evil.swf"></object><embed src="evil.swf">', "<object>"],
    ['<form action="https://evil.example"><input name="password"></form>', "<form>"],
    ["<svg><script>alert(1)</script></svg>", "<svg>"],
    ['<svg onload="alert(1)"></svg>', "<svg>"],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', "<math>"],
    ['<img src="x" onerror="alert(1)">', "img[onerror]"],
    ["<img src=x onerror=alert(1)//", "an unfinished tag at the end"],
    ['<p onclick="alert(1)">x</p>', "p[onclick]"],
    ['<a href="/x" onmouseover="alert(1)">x</a>', "a[onmouseover]"],
    ['<a href="javascript:alert(1)">x</a>', "a[href=javascript:]"],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', "a[href=javascript:]"],
    ['<a href="  javascript:alert(1)">x</a>', "a[href=javascript:]"],
    ['<a href="java&#x09;script:alert(1)">x</a>', "a[href=javascript:]"],
    ['<a href="&#106;avascript:alert(1)">x</a>', "a[href=javascript:]"],
    ['<a href="vbscript:msgbox(1)">x</a>', "a[href=vbscript:]"],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', "a[href=data:]"],
    ['<img src="data:image/svg+xml,<svg onload=alert(1)>">', "img[src=data:]"],
    ['<div style="background:url(javascript:alert(1))">x</div>', "div[style]"],
    ['<base href="https://evil.example/">', "<base>"],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example">', "<meta>"],
    ['<link rel="stylesheet" href="https://evil.example/x.css">', "<link>"],
    ["<textarea><script>alert(1)</script></textarea>", "<textarea>"],
    ["<!--[if IE]><script>alert(1)</script><![endif]--><p>x</p>", null],
    ['<p id="login" name="x">x</p>', "p[id]"],
  ];
  for (const [html, named] of cases) {
    const result = sanitizeRichText(html);
    assert.equal(result.changed, true, html);
    assert.doesNotMatch(result.html, DANGER, `${html} → ${result.html}`);
    if (named) assert.ok(result.removed.includes(named), `${html}: ${JSON.stringify(result.removed)} names ${named}`);
  }
  // What is safe around the attack is kept.
  assert.equal(sanitizeRichText('<p onclick="x()">Keep <strong>me</strong></p><script>bad()</script>').html, "<p>Keep <strong>me</strong></p>");
  assert.equal(sanitizeRichText('<span class="hl">Text</span> stays').html, "Text stays", "unknown tags go, their text stays");
});

test("a record: rich text at any depth and the Markdown body are cleaned; values already in the source are left; too long is reported", () => {
  const fields = {
    intro: f.richText({ label: "Intro" }),
    "about.text": f.richText({ label: "About" }),
    blocks: f.list(f.object({ label: "Block", fields: { body: f.richText({ label: "Body" }), title: f.text({ label: "Title" }) } }), { label: "Blocks" }),
    title: f.text({ label: "Title" }),
  };
  const record = { intro: "<p>Hi</p><script>x()</script>", about: { text: '<a href="javascript:x()">a</a>' }, blocks: [{ title: "<script>not rich</script>", body: "<b onclick=x>b</b>" }], title: "<script>plain text is not HTML on the page</script>" };
  const result = sanitizeRecord({ fields, record });
  assert.deepEqual(result.cleaned.map((entry) => entry.path), ["intro", "about.text", "blocks[0].body"]);
  assert.deepEqual(result.record, { ...record, intro: "<p>Hi</p>", about: { text: "<a>a</a>" }, blocks: [{ title: "<script>not rich</script>", body: "b" }] });
  // The same unsafe text that is already in the site's own file is not touched (the site's developers put it there).
  const kept = sanitizeRecord({ fields, record, before: record });
  assert.deepEqual([kept.cleaned, kept.record], [[], record]);
  // Markdown: the body is HTML on the page too.
  const md = sanitizeRecord({ fields: { title: f.text({ label: "T" }) }, record: { title: "x", body: "Hello **there**\n\n<script>alert(1)</script>\n" }, markdownBody: true });
  assert.deepEqual(md.cleaned.map((entry) => entry.path), ["body"]);
  assert.doesNotMatch(md.record.body, /script/);
  assert.match(md.record.body, /Hello \*\*there\*\*/);
  assert.deepEqual(sanitizeRecord({ fields, record: { intro: "x".repeat(RICH_TEXT_MAX_CHARS + 1) } }).tooLong, ["intro"]);
});

test("API: saving cleans what the user typed (and says so); untouched unsafe source text stays; too long → 422", async () => {
  const site = JSON.parse(files["src/data/site.json"]);
  const legacy = { ...files, "src/data/site.json": JSON.stringify({ ...site, hero: { ...site.hero, text: '<p onclick="legacy()">Old</p>' } }, null, 2) };
  const api = createCmsApi({ config, source: createBundledSource(legacy), drafts: createMemoryDraftStore(), audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_owner", role: "owner" }) });
  const call = async (method, path, body) => { const response = await api.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: response.status, body: await response.json() }; };
  const live = await (await api.handle(new Request("http://localhost/api/cms/files/site"))).json();
  // 1. A change elsewhere: the legacy onclick stays as it is in the file.
  const untouched = await call("PUT", "/api/cms/files/site", { content: { ...live.content, tagline: "New" }, expectedRevision: 0, sourceVersion: live.version });
  assert.equal(untouched.status, 200);
  assert.deepEqual(untouched.body.cleaned, []);
  assert.equal(untouched.body.draft.content.hero.text, '<p onclick="legacy()">Old</p>');
  // 2. The user types unsafe HTML: cleaned, named in `cleaned` and in the warnings.
  const typed = await call("PUT", "/api/cms/files/site", { content: { ...live.content, hero: { ...live.content.hero, text: '<p>Hi</p><img src=x onerror="alert(1)">' } }, expectedRevision: 1 });
  assert.equal(typed.status, 200);
  assert.equal(typed.body.draft.content.hero.text, '<p>Hi</p><img src="x">');
  assert.deepEqual(typed.body.cleaned, [{ path: "hero.text", removed: ["img[onerror]"] }]);
  assert.ok(typed.body.warnings.some((warning) => warning.path === "hero.text" && /HTML removed for safety: img\[onerror\]/.test(warning.message)));
  // 3. Too long: refused, nothing saved.
  const long = await call("PUT", "/api/cms/files/site", { content: { ...live.content, hero: { ...live.content.hero, text: "x".repeat(RICH_TEXT_MAX_CHARS + 1) } }, expectedRevision: 2 });
  assert.deepEqual([long.status, long.body.error, long.body.errors[0].path], [422, "invalid_content", "hero.text"]);
});

test("API: publishing cleans drafts that were stored unclean (older versions / other clients) and says so", async () => {
  const github = await startFakeGitHub({ owner: config.repo.owner, name: config.repo.name, branch: config.repo.branch, files });
  try {
    const drafts = createMemoryDraftStore();
    const api = createCmsApi({ config, source: createBundledSource(files), drafts, audit: createMemoryAuditLog(), identify: () => ({ userId: "usr_owner", role: "owner" }), publisher: createGitHubPublisher({ token: github.token, repo: config.repo, apiUrl: github.url }) });
    const live = await (await api.handle(new Request("http://localhost/api/cms/files/site"))).json();
    // Stored straight in the draft store, past the API's cleaning.
    await drafts.save({ userId: "usr_owner", resource: "file:site", label: "Salon info", content: { ...live.content, hero: { ...live.content.hero, text: "<p>Hello</p><script>steal()</script>" } }, sourceVersion: live.version, expectedRevision: 0 });
    const response = await api.handle(new Request("http://localhost/api/cms/publish", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ resources: ["file:site"] }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(github.files()["src/data/site.json"]).hero.text, "<p>Hello</p>");
    assert.deepEqual(body.warnings, [{ resource: "file:site", code: "sanitized", fields: ["hero.text: removed <script>"] }]);
  } finally { await github.close(); }
});

test("build: rich text in the site's files that the CMS would clean is a warning (the build goes on)", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-cms-rich-"));
  try {
    cpSync(join(demoRoot, "src"), join(root, "src"), { recursive: true });
    const team = JSON.parse(readFileSync(join(root, "src/data/team.json"), "utf8"));
    team[0].bio = '<p style="color:red">Hi</p>';
    writeFileSync(join(root, "src/data/team.json"), JSON.stringify(team, null, 2));
    const { errors, warnings } = checkContent(config, root);
    assert.deepEqual(errors, []);
    const warning = warnings.find((entry) => entry.path === 'src/data/team.json[0] ("alex").bio');
    assert.ok(warning, JSON.stringify(warnings));
    assert.match(warning.message, /has HTML the CMS removes when this field is edited \(p\[style\]\)/);
    assert.deepEqual(checkContent(config, demoRoot), { errors: [], warnings: [] }, "the demo itself is clean");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
