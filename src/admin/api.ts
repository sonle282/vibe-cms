/**
 * P7: the browser's calls to /api/cms/* and /api/auth/*, and the plain-words message for each error code. Same-origin
 * fetch with the session cookie; the browser adds the Origin header the server checks on writes.
 */

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFail = { ok: false; status: number; error: string; message: string; data: Record<string, unknown> };
export type ApiResult<T> = ApiOk<T> | ApiFail;
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * M5: an upload that reports how much is sent (the Mr Spa CMS's "Uploading… 42%"): XMLHttpRequest, where the browser
 * has it. Without it (tests, a fetch passed in) the upload goes through fetch and jumps to the end.
 */
export type ProgressUpload = (path: string, blob: Blob, headers: Record<string, string>, onProgress: (fraction: number) => void) => Promise<{ status: number; text: string } | null>;
export const xhrUpload = (win: Window): ProgressUpload | undefined => {
  const Xhr = (win as unknown as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (typeof Xhr !== "function") return undefined;
  return (path, blob, headers, onProgress) => new Promise((resolve) => {
    const request = new Xhr();
    request.open("POST", path);
    request.withCredentials = true;
    request.setRequestHeader("accept", "application/json");
    request.setRequestHeader("content-type", blob.type || "application/octet-stream");
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => { if (event.lengthComputable && event.total) onProgress(event.loaded / event.total); });
    request.addEventListener("load", () => resolve({ status: request.status, text: request.responseText }));
    request.addEventListener("error", () => resolve(null));
    request.addEventListener("abort", () => resolve(null));
    request.send(blob);
  });
};

export const createClient = (fetchImpl: Fetch, progressUpload?: ProgressUpload) => {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    let response: Response;
    try {
      response = await fetchImpl(path, { method, credentials: "same-origin", headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      return { ok: false, status: 0, error: "network", message: humanMessage("network"), data: {} };
    }
    let data: Record<string, unknown> = {};
    try { data = (await response.json()) as Record<string, unknown>; } catch { /* not JSON */ }
    if (response.ok) return { ok: true, status: response.status, data: data as T };
    const error = typeof data.error === "string" ? data.error : `http_${response.status}`;
    return { ok: false, status: response.status, error, message: humanMessage(error, typeof data.message === "string" ? data.message : ""), data };
  };
  return {
    request: <T>(method: string, path: string, body?: unknown) => call<T>(method, path, body),
    get: <T>(path: string) => call<T>("GET", path),
    put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
    post: <T>(path: string, body: unknown) => call<T>("POST", path, body),
    delete: <T>(path: string) => call<T>("DELETE", path),
    /** P10: raw bytes (an image) with extra headers; the answer is JSON like every other call. */
    upload: async <T>(path: string, blob: Blob, headers: Record<string, string>, onProgress?: (fraction: number) => void): Promise<ApiResult<T>> => {
      if (onProgress && progressUpload) {
        const answer = await progressUpload(path, blob, headers, onProgress);
        if (!answer) return { ok: false, status: 0, error: "upload_interrupted", message: humanMessage("upload_interrupted"), data: {} };
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(answer.text) as Record<string, unknown>; } catch { /* not JSON */ }
        if (answer.status >= 200 && answer.status < 300) return { ok: true, status: answer.status, data: data as T };
        const error = typeof data.error === "string" ? data.error : `http_${answer.status}`;
        return { ok: false, status: answer.status, error, message: humanMessage(error, typeof data.message === "string" ? data.message : ""), data };
      }
      let response: Response;
      try {
        response = await fetchImpl(path, { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": blob.type || "application/octet-stream", ...headers }, body: blob });
      } catch {
        return { ok: false, status: 0, error: "network", message: humanMessage("network"), data: {} };
      }
      let data: Record<string, unknown> = {};
      try { data = (await response.json()) as Record<string, unknown>; } catch { /* not JSON */ }
      if (response.ok) return { ok: true, status: response.status, data: data as T };
      const error = typeof data.error === "string" ? data.error : `http_${response.status}`;
      return { ok: false, status: response.status, error, message: humanMessage(error, typeof data.message === "string" ? data.message : ""), data };
    },
  };
};
export type Client = ReturnType<typeof createClient>;

const MESSAGES: Record<string, string> = {
  network: "Couldn't reach the site. Check your connection and try again.",
  // M5 (Mr Spa): an upload cut off on the way.
  upload_interrupted: "The upload was interrupted. Check the connection and try again.",
  unauthenticated: "Your session has ended. Sign in again — your unsaved changes on this page will be lost.",
  password_change_required: "Choose your own password first.",
  draft_conflict: "This draft was saved in another tab or window. Reload to get the newest version before saving.",
  invalid_content: "Some fields need attention.",
  draft_too_large: "This content is too large to save as one draft.",
  payload_too_large: "This content is too large to save as one draft.",
  origin_forbidden: "The request was refused because it did not come from this site. Reload the page.",
  storage_not_configured: "Drafts can't be saved: the site's database is not set up.",
  not_found: "This content no longer exists.",
  // P8: publishing
  no_draft: "One of these drafts no longer exists (published or discarded elsewhere). Reload the page.",
  too_many_publishes: "You published many times in the last minute. Wait a minute and try again.",
  publisher_not_configured: "Publishing is not set up on this site yet (its GitHub access is missing). Ask whoever set up the site.",
  publish_limiter_missing: "Publishing is not fully set up on this site yet. Ask whoever set up the site.",
  branch_moving: "The website's files kept changing while publishing. Wait a moment and try again.",
  github_rate_limited: "GitHub is busy. Wait a minute and try again.",
  github_unreachable: "GitHub could not be reached. Try again in a moment.",
  github_unauthorized: "The site's GitHub access has expired or was removed. Ask whoever set up the site to renew it.",
  github_forbidden: "The site's GitHub access is not allowed to publish. Ask whoever set up the site.",
  // P10: images
  // M5: the Mr Spa CMS's words.
  unsupported_image: "This file type is not supported. Choose a JPEG, PNG, AVIF or WebP image.",
  empty_file: "This file is empty. Choose another image.",
  too_many_uploads: "Too many uploads in a short time. Please wait a minute and try again.",
  media_not_configured: "Uploading is not set up on this site (its image storage is missing). Ask whoever set up the site.",
  audit_unavailable: "Nothing was published because the activity log could not be written. Try again in a moment.",
};
/** Plain words for an error code; the server's own message for codes the admin does not know (it is written for people too). */
export const humanMessage = (code: string, fallback = "") => MESSAGES[code] ?? (fallback || "Something went wrong. Please try again.");
