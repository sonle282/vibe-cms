/**
 * P5: publishing = one commit on the site's production branch. GitPublisher is the interface the API uses; the GitHub
 * REST version creates blobs → tree → commit and then moves the branch WITHOUT force. When the branch moved in the
 * meantime the ref update is refused and commit() returns { conflict: true } — the API re-reads and retries (bounded).
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
  constructor(public readonly code: string, public readonly httpStatus = 502) {
    super(`Publishing to GitHub failed (${code}).`);
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

export type GitHubOptions = {
  token: string;
  repo: { owner: string; name: string; branch: string };
  /** Only for tests (a local fake server). The Astro route never sets it: production always talks to api.github.com. */
  apiUrl?: string;
  fetch?: typeof fetch;
};

export const createGitHubPublisher = ({ token, repo, apiUrl = "https://api.github.com", fetch: fetcher = fetch }: GitHubOptions): GitPublisher => {
  const base = `${apiUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const call = async (method: string, path: string, body?: unknown, accept = "application/vnd.github+json") => {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept, "x-github-api-version": "2022-11-28", "user-agent": "vibe-cms", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new GitPublishError("github_unreachable"); }
    return response;
  };
  const fail = (response: Response, what: string): never => {
    if (response.status === 401) throw new GitPublishError("github_unauthorized");
    if (response.status === 403) throw new GitPublishError(response.headers.get("x-ratelimit-remaining") === "0" ? "github_rate_limited" : "github_forbidden");
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
      if (moved.status === 422 || moved.status === 409) return { conflict: true };
      if (!moved.ok) fail(moved, "ref");
      return { sha: commit.sha };
    },
  };
};
