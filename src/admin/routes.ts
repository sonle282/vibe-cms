/**
 * M1: the admin's addresses, by path like the Mr Spa CMS (one server route, /admin/[...path], serves them all):
 *   /admin                                  the first page's editor (Mr Spa: /admin → /admin/pages/homepage)
 *   /admin/pages · /admin/pages/<file>      Pages · edit a file
 *   /admin/catalog/<collection>             the records of a collection (its tabs: the collections `under` it)
 *   /admin/catalog/<collection>/new         a new record · /admin/catalog/<collection>/<id> edit a record
 *   /admin/media · /admin/drafts            Media · My drafts
 *   /admin/drafts/review[/<resource>]       review my drafts and publish several at once (kept, DESIGN §H.1)
 *   /admin/users · /admin/audit[/<kind>]    People & activity (admins)
 *   /admin/history/<resource> · /admin/account
 * The hash addresses of before (#/files/site…) still open the same screen.
 */

export const ADMIN_BASE = "/admin";

export type AdminRoute =
  | { kind: "home" }
  | { kind: "pages" }
  | { kind: "file"; key: string }
  | { kind: "list"; key: string }
  | { kind: "new"; key: string }
  | { kind: "item"; key: string; id: string }
  | { kind: "media" }
  | { kind: "drafts" }
  | { kind: "review"; resource?: string }
  | { kind: "users" }
  | { kind: "audit"; filter?: string }
  | { kind: "history"; resource: string }
  | { kind: "account" }
  | { kind: "unknown" };

const part = (text: string) => encodeURIComponent(text);

/** Where each screen lives. */
export const adminHref = {
  pages: () => `${ADMIN_BASE}/pages`,
  file: (key: string) => `${ADMIN_BASE}/pages/${part(key)}`,
  list: (key: string) => `${ADMIN_BASE}/catalog/${part(key)}`,
  newItem: (key: string) => `${ADMIN_BASE}/catalog/${part(key)}/new`,
  item: (key: string, id: string) => `${ADMIN_BASE}/catalog/${part(key)}/${part(id)}`,
  media: () => `${ADMIN_BASE}/media`,
  drafts: () => `${ADMIN_BASE}/drafts`,
  review: (resource?: string) => `${ADMIN_BASE}/drafts/review${resource ? `/${part(resource)}` : ""}`,
  users: () => `${ADMIN_BASE}/users`,
  audit: (filter?: string) => `${ADMIN_BASE}/audit${filter ? `/${part(filter)}` : ""}`,
  history: (resource: string) => `${ADMIN_BASE}/history/${part(resource)}`,
  account: () => `${ADMIN_BASE}/account`,
};

const decode = (text: string) => { try { return decodeURIComponent(text); } catch { return text; } };

/** The screen for an address ("/admin/catalog/services/gel-off" → an item). */
export const parseAdminPath = (pathname: string): AdminRoute => {
  const path = pathname.replace(/\/+$/, "");
  if (path === ADMIN_BASE || path === "") return { kind: "home" };
  if (!path.startsWith(`${ADMIN_BASE}/`)) return { kind: "unknown" };
  const parts = path.slice(ADMIN_BASE.length + 1).split("/").map(decode);
  const [first, second, third] = parts;
  const count = parts.length;
  if (first === "pages" && count === 1) return { kind: "pages" };
  if (first === "pages" && count === 2) return { kind: "file", key: second };
  if (first === "catalog" && count === 2) return { kind: "list", key: second };
  if (first === "catalog" && count === 3) return third === "new" ? { kind: "new", key: second } : { kind: "item", key: second, id: third };
  if (first === "media" && count === 1) return { kind: "media" };
  if (first === "drafts" && count === 1) return { kind: "drafts" };
  if (first === "drafts" && second === "review" && count <= 3) return third ? { kind: "review", resource: third } : { kind: "review" };
  if (first === "users" && count === 1) return { kind: "users" };
  if (first === "audit" && count <= 2) return second ? { kind: "audit", filter: second } : { kind: "audit" };
  if (first === "history" && count === 2) return { kind: "history", resource: second };
  if (first === "account" && count === 1) return { kind: "account" };
  return { kind: "unknown" };
};

/** The new address of a hash address of before ("#/files/site" → "/admin/pages/site"), or undefined. */
export const legacyHashPath = (hash: string) => {
  if (!hash.startsWith("#/")) return undefined;
  const parts = hash.slice(2).split("/").filter((segment, index, all) => segment || index < all.length - 1).map(decode);
  const [first, second, third, fourth] = parts;
  if (!first) return adminHref.pages();
  if (first === "files" && second) return adminHref.file(second);
  if (first === "collections" && second && !third) return adminHref.list(second);
  if (first === "collections" && second && third === "new") return adminHref.newItem(second);
  if (first === "collections" && second && third === "items" && fourth) return adminHref.item(second, fourth);
  if (first === "publish") return adminHref.review(second);
  if (first === "drafts") return adminHref.drafts();
  if (first === "media") return adminHref.media();
  if (first === "people") return adminHref.users();
  if (first === "activity") return adminHref.audit(second);
  if (first === "history" && second) return adminHref.history(second);
  if (first === "account") return adminHref.account();
  return undefined;
};
