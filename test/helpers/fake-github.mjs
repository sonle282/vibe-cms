// A fake GitHub REST API on 127.0.0.1 for the publish tests — never the real GitHub. Keeps git objects in memory:
// blobs (exact bytes), trees (path → blob), commits, one branch ref. Implements only what GitPublisher calls:
//   GET  /repos/:o/:r/git/ref/heads/:branch         GET  /repos/:o/:r/contents/:path?ref=  (raw bytes)
//   GET  /repos/:o/:r/git/commits/:sha              POST /repos/:o/:r/git/blobs | git/trees | git/commits
//   PATCH /repos/:o/:r/git/refs/heads/:branch       (non-fast-forward → 422, like GitHub)
// Like GitHub: contents come raw only with Accept "application/vnd.github.raw+json"; otherwise JSON + base64, and for
// files over 1 MB the JSON has encoding "none" and no content. failNext() injects errors (rate limits, 409, 404…).
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const sha = (value) => createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

export const startFakeGitHub = async ({ owner = "o", name = "r", branch = "main", token = "test-token", files = {} } = {}) => {
  const blobs = new Map(); const trees = new Map(); const commits = new Map();
  const requests = [];
  let ref;
  let movesBeforeRefUpdate = 0;
  let moveFiles = {};
  const failures = [];

  const putBlob = (bytes) => { const id = sha(bytes.toString("base64")); blobs.set(id, bytes); return id; };
  const putTree = (entries) => { const id = sha([...entries].sort()); trees.set(id, new Map(entries)); return id; };
  const putCommit = (tree, parents, message, author) => { const id = sha({ tree, parents, message, author, n: commits.size }); commits.set(id, { tree, parents, message, author }); return id; };
  const treeOf = (commitSha) => trees.get(commits.get(commitSha).tree);
  /** Commit straight on the branch (someone else pushing). */
  const pushOther = (changes, message = "someone else") => {
    const entries = new Map(treeOf(ref));
    for (const [path, text] of Object.entries(changes)) entries.set(path, putBlob(Buffer.from(text, "utf8")));
    ref = putCommit(putTree([...entries]), [ref], message, { name: "Other", email: "other@example.invalid" });
    return ref;
  };
  ref = putCommit(putTree(Object.entries(files).map(([path, text]) => [path, putBlob(Buffer.from(text, "utf8"))])), [], "initial", { name: "Init", email: "init@example.invalid" });

  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const url = new URL(req.url, "http://x");
    requests.push({ method: req.method, path: url.pathname, accept: req.headers.accept, apiVersion: req.headers["x-github-api-version"], userAgent: req.headers["user-agent"], body: req.method === "PATCH" ? body : undefined });
    const send = (status, value, raw, headers = {}) => { res.writeHead(status, { "content-type": raw ? "application/octet-stream" : "application/json", ...headers }); res.end(raw ?? JSON.stringify(value)); };
    const failure = failures.find((entry) => entry.times > 0 && entry.method === req.method && entry.path.test(url.pathname));
    if (failure) { failure.times -= 1; return send(failure.status, { message: failure.message ?? "injected" }, undefined, failure.headers ?? {}); }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "Bad credentials" });
    const prefix = `/repos/${owner}/${name}`;
    if (!url.pathname.startsWith(prefix)) return send(404, { message: "Not Found" });
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    let match;
    if (req.method === "GET" && path === `/git/ref/heads/${branch}`) return send(200, { object: { sha: ref, type: "commit" } });
    if (req.method === "GET" && (match = /^\/contents\/(.+)$/.exec(path))) {
      const at = url.searchParams.get("ref") ?? ref;
      if (!commits.has(at)) return send(404, { message: "No commit found" });
      const blob = treeOf(at).get(match[1]);
      if (!blob) return send(404, { message: "Not Found" });
      const bytes = blobs.get(blob);
      if (/vnd\.github\.raw/.test(req.headers.accept ?? "")) return send(200, null, bytes);
      return send(200, bytes.length > 1024 * 1024 ? { sha: blob, size: bytes.length, encoding: "none", content: "" } : { sha: blob, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
    }
    if (req.method === "GET" && (match = /^\/git\/commits\/([0-9a-f]+)$/.exec(path))) {
      const commit = commits.get(match[1]);
      return commit ? send(200, { sha: match[1], tree: { sha: commit.tree }, parents: commit.parents.map((parent) => ({ sha: parent })) }) : send(404, { message: "Not Found" });
    }
    if (req.method === "POST" && path === "/git/blobs") return send(201, { sha: putBlob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) });
    if (req.method === "POST" && path === "/git/trees") {
      const entries = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const entry of body.tree) { if (!blobs.has(entry.sha)) return send(422, { message: "blob missing" }); entries.set(entry.path, entry.sha); }
      return send(201, { sha: putTree([...entries]) });
    }
    if (req.method === "POST" && path === "/git/commits") return send(201, { sha: putCommit(body.tree, body.parents, body.message, body.author) });
    if (req.method === "PATCH" && path === `/git/refs/heads/${branch}`) {
      if (movesBeforeRefUpdate > 0) { movesBeforeRefUpdate -= 1; pushOther(moveFiles, "moved during publish"); }
      const commit = commits.get(body.sha);
      if (!commit) return send(422, { message: "Object does not exist" });
      if (!body.force && commit.parents[0] !== ref) return send(422, { message: "Update is not a fast forward" });
      ref = body.sha;
      return send(200, { object: { sha: ref } });
    }
    return send(404, { message: "Not Found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`, owner, name, branch, token, requests,
    head: () => ref,
    /** Exact text of every file at a commit (default: the branch head). */
    files: (at = ref) => Object.fromEntries([...treeOf(at)].map(([path, blob]) => [path, blobs.get(blob).toString("utf8")])),
    commit: (at = ref) => ({ sha: at, ...commits.get(at) }),
    /** Paths whose blob differs between two commits. */
    changedPaths: (from, to = ref) => { const a = treeOf(from); const b = treeOf(to); return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort(); },
    commitsSince: (from) => { const out = []; let at = ref; while (at && at !== from) { out.push(at); at = commits.get(at).parents[0]; } return out; },
    pushOther,
    /** The next `times` branch updates find the branch moved by someone else (changing `files`). */
    moveBranchBeforeRefUpdate: (times, files) => { movesBeforeRefUpdate = times; moveFiles = files; },
    /** The next `times` requests matching method + path regex get `status` (+ headers). */
    failNext: (method, path, status, { times = 1, headers, message } = {}) => { failures.push({ method, path, status, times, headers, message }); },
    forcedUpdates: () => requests.filter((request) => request.method === "PATCH" && request.body?.force !== false).length,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
