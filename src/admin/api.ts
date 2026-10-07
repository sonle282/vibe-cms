/**
 * P7: the browser's calls to /api/cms/* and /api/auth/*, and the plain-words message for each error code. Same-origin
 * fetch with the session cookie; the browser adds the Origin header the server checks on writes.
 */

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFail = { ok: false; status: number; error: string; message: string; data: Record<string, unknown> };
export type ApiResult<T> = ApiOk<T> | ApiFail;
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const createClient = (fetchImpl: Fetch) => {
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
    get: <T>(path: string) => call<T>("GET", path),
    put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
    post: <T>(path: string, body: unknown) => call<T>("POST", path, body),
    delete: <T>(path: string) => call<T>("DELETE", path),
  };
};
export type Client = ReturnType<typeof createClient>;

const MESSAGES: Record<string, string> = {
  network: "Couldn't reach the site. Check your connection and try again.",
  unauthenticated: "Your session has ended. Sign in again — your unsaved changes on this page will be lost.",
  password_change_required: "Choose your own password first.",
  draft_conflict: "This draft was saved in another tab or window. Reload to get the newest version before saving.",
  invalid_content: "Some fields need attention.",
  draft_too_large: "This content is too large to save as one draft.",
  payload_too_large: "This content is too large to save as one draft.",
  origin_forbidden: "The request was refused because it did not come from this site. Reload the page.",
  storage_not_configured: "Drafts can't be saved: the site's database is not set up.",
  not_found: "This content no longer exists.",
};
/** Plain words for an error code; the server's own message for codes the admin does not know (it is written for people too). */
export const humanMessage = (code: string, fallback = "") => MESSAGES[code] ?? (fallback || "Something went wrong. Please try again.");
