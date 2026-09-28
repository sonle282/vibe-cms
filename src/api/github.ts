/**
 * P5: publishing = one commit on the site's production branch. GitPublisher is the interface the API uses; the GitHub
 * REST version creates blobs → tree → commit and then moves the branch WITHOUT force. When the branch moved in the
 * meantime the ref update is refused and commit() returns { conflict: true } — the API re-reads and retries (bounded).
 *
 * P5b — checked against the publisher running in production on Mr Spa (src/lib/cms/github-commit.ts):
 * - same flow and endpoints: GET git/ref/heads → git/commits/:sha → POST git/blobs (base64) → git/trees (base_tree)
 *   → git/commits → PATCH git/refs/heads { force: false }; same headers (Accept vnd.github+json, API version
 *   2022-11-28, a User-Agent);
 * - "branch moved" = HTTP 422 on the ref update, exactly as there; any other refusal (409…) is an error, not a retry;
 * - blobs are base64 (works for any bytes; the utf-8 blob encoding would not keep a BOM / binary);
 * - reading differs on purpose: Mr Spa reads the contents API as JSON + base64, which only carries files up to 1 MB and
 *   decodes with the BOM dropped. Here the raw media type is used: files up to 100 MB, exact bytes (BOM kept) — the
 *   format-keeping writer needs the exact text;
 * - rate limits (Mr Spa does not handle them): 403 / 429 with retry-after or x-ratelimit-remaining: 0 → wait and try
 *   once more when the wait is short (≤ maxWaitSeconds), else error github_rate_limited (HTTP 503 + retryAfter).
 *
 * Token: the site's own secret (VIBE_GITHUB_TOKEN), a fine-grained token for exactly one repository with
 * "Contents: Read and write" (see the README). The token never appears in errors, logs or responses.
 */

export type CommitAuthor = { name: string; email: string };
export type CommitInput = { parent: string; files: Record<string, string>; message: string; author: CommitAuthor; date?: string };

export interface GitPublisher {
  /** The branch's current commit. */
  head(): Promise<{ sha: string }>;
  /** Exact text of each path at `sha` (undefined = the file does not exist there). */
  readFiles(sha: string, paths: string[]): Promise<Record<string, string | undefined>>;
  /** One commit with exactly `files` changed, on top of `parent`; then move the branch (no force). */
  commit(input: CommitInput): Promise<{ sha: string } | { conflict: true }>;
}

/** A publish error with a stable code for the API response and the audit row (never the token or a raw body). */
export class GitPublishError extends Error {
  constructor(public readonly code: string, public readonly httpStatus = 502, public readonly retryAfter?: number) {
    super(code === "github_rate_limited" ? `GitHub is rate-limiting publishes — try again in ${retryAfter ?? 60} seconds.` : `Publishing to GitHub failed (${code}).`);
    this.name = "GitPublishError";
  }
}

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
/** UTF-8 with the BOM kept (fetch's .text() would drop it — the writer must see the file's exact bytes). */
const exactText = async (response: Response) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Seconds to wait when GitHub says "rate limited", or undefined when the response is not a rate limit. */
export const rateLimitWait = (response: Response, nowSeconds = Date.now() / 1000): number | undefined => {
  if (response.status !== 403 && response.status !== 429) return undefined;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter);
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - nowSeconds)) : 60;
  }
  return response.status === 429 ? 60 : undefined;
};

export type GitHubOptions = {
  token: string;
  repo: { owner: string; name: string; branch: string };
  /** Only for tests (a local fake server). The Astro route never sets it: production always talks to api.github.com. */
  apiUrl?: string;
  fetch?: typeof fetch;
  /** Longest wait for a rate limit before giving up (seconds). Default 10. */
  maxWaitSeconds?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

export const createGitHubPublisher = ({ token, repo, apiUrl = "https://api.github.com", fetch: fetcher = fetch, maxWaitSeconds = 10, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: GitHubOptions): GitPublisher => {
  const base = `${apiUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const call = async (method: string, path: string, body?: unknown, accept = "application/vnd.github+json") => {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, accept, "x-github-api-version": "2022-11-28", "user-agent": "vibe-cms", ...(body === undefined ? {} : { "content-type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch { throw new GitPublishError("github_unreachable"); }
      const wait = rateLimitWait(response);
      if (wait === undefined) return response;
      if (attempt === 1 && wait <= maxWaitSeconds) { await sleep(wait * 1000); continue; }
      throw new GitPublishError("github_rate_limited", 503, wait);
    }
  };
  const fail = (response: Response, what: string): never => {
    if (response.status === 401) throw new GitPublishError("github_unauthorized");
    if (response.status === 403) throw new GitPublishError("github_forbidden");
    if (response.status === 404) throw new GitPublishError(`github_not_found_${what}`);
    throw new GitPublishError(`github_${what}_${response.status}`);
  };
  const json = async <T>(response: Response, what: string): Promise<T> => (response.ok ? ((await response.json()) as T) : fail(response, what));

  return {
    async head() {
      const ref = await json<{ object: { sha: string } }>(await call("GET", `/git/ref/heads/${encodePath(repo.branch)}`), "branch");
      return { sha: ref.object.sha };
    },
    async readFiles(sha, paths) {
      const out: Record<string, string | undefined> = {};
      for (const path of paths) {
        const response = await call("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`, undefined, "application/vnd.github.raw+json");
        if (response.status === 404) { out[path] = undefined; continue; }
        if (!response.ok) fail(response, "contents");
        out[path] = await exactText(response);
      }
      return out;
    },
    async commit({ parent, files, message, author, date = new Date().toISOString() }) {
      const base = await json<{ tree: { sha: string } }>(await call("GET", `/git/commits/${encodeURIComponent(parent)}`), "commit");
      const tree = [];
      for (const [path, text] of Object.entries(files)) {
        const blob = await json<{ sha: string }>(await call("POST", "/git/blobs", { content: toBase64(text), encoding: "base64" }), "blob");
        tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const newTree = await json<{ sha: string }>(await call("POST", "/git/trees", { base_tree: base.tree.sha, tree }), "tree");
      const commit = await json<{ sha: string }>(await call("POST", "/git/commits", { message, tree: newTree.sha, parents: [parent], author: { ...author, date } }), "commit");
      const moved = await call("PATCH", `/git/refs/heads/${encodePath(repo.branch)}`, { sha: commit.sha, force: false });
      // Like Mr Spa's publisher: 422 = not a fast-forward (someone committed meanwhile) → the caller re-reads and retries.
      if (moved.status === 422) return { conflict: true };
      if (!moved.ok) fail(moved, "ref");
      return { sha: commit.sha };
    },
  };
};
