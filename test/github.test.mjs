// P5b: the GitHub publisher against the fake GitHub — the cases checked against the first site's production publisher
// (raw reads, 422 = branch moved, 409 / 404 = errors, rate limits with retry-after / x-ratelimit-*, large files).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHubPublisher, GitPublishError, rateLimitWait } from "../dist/api/index.js";
import { startFakeGitHub } from "./helpers/fake-github.mjs";

const repo = { owner: "o", name: "r", branch: "main" };
const setup = async (files = { "src/data/site.json": '{\n  "a": 1\n}\n' }) => {
  const github = await startFakeGitHub({ ...repo, files });
  const waits = [];
  const publisher = createGitHubPublisher({ token: github.token, repo, apiUrl: github.url, sleep: async (ms) => { waits.push(ms); } });
  return { github, publisher, waits };
};
const author = { name: "Vibe CMS", email: "vibe-cms@users.noreply.github.com" };
const rejectsWith = (promise, code, extra = {}) => assert.rejects(promise, (error) => { assert.ok(error instanceof GitPublishError); assert.equal(error.code, code); for (const [key, value] of Object.entries(extra)) assert.equal(error[key], value); assert.ok(!error.message.includes("test-token")); return true; });

test("same headers as the production publisher; contents read raw; ref update never forced", async () => {
  const { github, publisher } = await setup();
  try {
    const { sha } = await publisher.head();
    await publisher.readFiles(sha, ["src/data/site.json"]);
    await publisher.commit({ parent: sha, files: { "src/data/site.json": '{\n  "a": 2\n}\n' }, message: "m", author });
    for (const request of github.requests) {
      assert.equal(request.apiVersion, "2022-11-28");
      assert.equal(request.userAgent, "vibe-cms");
      assert.equal(request.accept, request.path.includes("/contents/") ? "application/vnd.github.raw+json" : "application/vnd.github+json");
    }
    assert.deepEqual(github.requests.filter((r) => r.method === "PATCH").map((r) => r.body.force), [false]);
  } finally { await github.close(); }
});

test("a file over 1 MB (with BOM, CRLF, non-ASCII) is read and committed byte for byte (raw read + base64 blob)", async () => {
  const big = `﻿{\r\n  "text": "${"Tiệm móng ✨ ".repeat(90_000)}"\r\n}\r\n`;
  assert.ok(Buffer.byteLength(big) > 1024 * 1024);
  const { github, publisher } = await setup({ "src/data/big.json": big });
  try {
    const { sha } = await publisher.head();
    const read = await publisher.readFiles(sha, ["src/data/big.json", "src/data/none.json"]);
    assert.equal(read["src/data/big.json"], big, "exact text, BOM kept");
    assert.equal(read["src/data/none.json"], undefined, "missing file → undefined");
    const changed = big.replace("✨", "💅");
    await publisher.commit({ parent: sha, files: { "src/data/big.json": changed }, message: "m", author });
    assert.equal(github.files()["src/data/big.json"], changed);
  } finally { await github.close(); }
});

test("ref update 422 (not a fast-forward) → { conflict: true }; 409 → an error, not a retry", async () => {
  const { github, publisher } = await setup();
  try {
    const { sha } = await publisher.head();
    github.failNext("PATCH", /git\/refs\/heads\/main$/, 422, { message: "Update is not a fast forward" });
    assert.deepEqual(await publisher.commit({ parent: sha, files: { "src/data/site.json": "{}\n" }, message: "m", author }), { conflict: true });
    github.failNext("PATCH", /git\/refs\/heads\/main$/, 409, { message: "Git Repository is empty." });
    await rejectsWith(publisher.commit({ parent: sha, files: { "src/data/site.json": "{}\n" }, message: "m", author }), "github_ref_409");
  } finally { await github.close(); }
});

test("404 on the branch, 401, 403 without rate-limit headers → clear codes", async () => {
  const { github, publisher } = await setup();
  try {
    github.failNext("GET", /git\/ref\/heads\/main$/, 404);
    await rejectsWith(publisher.head(), "github_not_found_branch");
    github.failNext("GET", /git\/ref\/heads\/main$/, 401);
    await rejectsWith(publisher.head(), "github_unauthorized");
    github.failNext("GET", /git\/ref\/heads\/main$/, 403);
    await rejectsWith(publisher.head(), "github_forbidden");
  } finally { await github.close(); }
});

test("rate limits: a short retry-after / reset is waited once; a long one or a second limit → github_rate_limited (503)", async () => {
  const { github, publisher, waits } = await setup();
  try {
    github.failNext("GET", /git\/ref\/heads\/main$/, 429, { headers: { "retry-after": "2" } });
    assert.ok((await publisher.head()).sha, "succeeds after waiting");
    assert.deepEqual(waits, [2000]);
    const reset = String(Math.floor(Date.now() / 1000) + 3);
    github.failNext("POST", /git\/blobs$/, 403, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } });
    const { sha } = await publisher.head();
    await publisher.commit({ parent: sha, files: { "src/data/site.json": '{\n  "a": 3\n}\n' }, message: "m", author });
    assert.ok(waits[1] >= 1000 && waits[1] <= 4000, `waited ${waits[1]} ms for the reset`);
    github.failNext("GET", /git\/ref\/heads\/main$/, 429, { headers: { "retry-after": "120" } });
    await rejectsWith(publisher.head(), "github_rate_limited", { httpStatus: 503, retryAfter: 120 });
    github.failNext("GET", /git\/ref\/heads\/main$/, 403, { times: 2, headers: { "retry-after": "1" } });
    await rejectsWith(publisher.head(), "github_rate_limited");
  } finally { await github.close(); }
});

test("rateLimitWait reads retry-after, x-ratelimit-reset and plain 429", () => {
  const response = (status, headers) => new Response(null, { status, headers });
  assert.equal(rateLimitWait(response(200, {})), undefined);
  assert.equal(rateLimitWait(response(403, {})), undefined, "403 without rate-limit headers is a permission error");
  assert.equal(rateLimitWait(response(429, { "retry-after": "7" })), 7);
  assert.equal(rateLimitWait(response(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000" }), 990), 10);
  assert.equal(rateLimitWait(response(429, {})), 60);
});
