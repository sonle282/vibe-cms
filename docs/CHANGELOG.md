# Changelog — @sonle282/vibe-cms

Semver: patch = fixes; minor = new features, no change to a site's config or data; major = a new `configVersion` or a
migration that is not automatic. Each entry says what a site has to do.

## 0.6.0 — unreleased (P6)

- **Sign-in + People** (option A, same mechanism as the CMS already running on the first site): username + password,
  PBKDF2-SHA256 100,000 iterations (same hash format — old users import without a password reset:
  `userFromLegacyRow`, `insertUser`), session cookie `vibe_cms_session` (32-byte token, HttpOnly Secure SameSite=Lax)
  with the session in KV `SESSION` under sha256(token), 30 days, `session_version` ends every session on password
  change / reset / disable; roles owner / editor read from D1 on every request; login rate limit 10 / min per
  username + IP and publish 20 / min per user (bindings `CMS_LOGIN_LIMITER`, `CMS_PUBLISH_LIMITER`; missing in a
  production build → 503); first owner from `CMS_BOOTSTRAP_USERNAME` / `CMS_BOOTSTRAP_PASSWORD` once.
- Routes: `/api/auth/login`, `/logout`, `/me`, `/password`; People `/api/cms/users` (owner only: list, add with a
  temporary password, disable / enable, reset password, change role; never the last active owner). Temporary
  passwords must be changed at the first sign-in (403 `password_change_required` elsewhere). Everything audited
  (stage auth / people), never passwords, hashes or tokens. `/admin`: minimal sign-in page.
- The CMS API uses the real identity: no session → 401 (the dev identity of P5 is unchanged).
- Migrations `0004_users.sql` (`cms_users`, `cms_auth_state`), `0005_audit_log_auth.sql` (audit table rebuilt with
  the wider action / stage / role lists; rows kept). `createSiteRuntime` = the production wiring (routes + tests).
- Site action: none (not released). For P11 / P15: bind `CMS_DB`, `SESSION`, the two rate-limit bindings, set the
  bootstrap secrets once. Workers Paid recommended (a sign-in hashes for ~16–45 ms CPU; Free allows 10 ms).

## 0.5.0 — unreleased (P5)

- **CMS API** (`@sonle282/vibe-cms/api`, route `/api/cms/[...path]` injected by the integration): `GET /content`,
  `GET·PUT·DELETE /files/:key`, `GET /collections/:key`, `GET·PUT·DELETE /collections/:key/items/:id`,
  `POST /publish`, `GET /live-version`; `x-cms-live-version` on every GET. PUT needs `expectedRevision` (400 without),
  checks types (P2) and locks (P4). Publish: one or more drafts → exactly one commit; source-version check (409), locks
  again with the current role, format-keeping writer, audit started / succeeded (commit sha) / failed (code) / denied,
  `rewrote_whole_file` warning, publisher's drafts cleared.
- `GitPublisher` + `createGitHubPublisher` (REST: blobs → tree → commit → ref update without force; bounded retry when
  the branch moved). Token: site secret `VIBE_GITHUB_TOKEN`. D1 binding: `CMS_DB`.
- Safety: every route needs an identity — until P6 the API answers 503 `auth_not_configured` (a local dev identity only
  with `import.meta.env.DEV` on localhost); same-site `Origin` for writes; 2 MB body limit; JSON errors without
  internals.
- Pure value checker `checkRecordValues` (runs in the Worker; the build-time content check uses it).
- **P5b:** `sourceVersion` is required when a draft is created (the version the user opened; 400
  `source_version_required` without it) and an existing draft keeps its original `sourceVersion` — a publish by
  someone else between opening and saving is caught (409). Publisher checked against the first site's production publisher:
  only 422 means "branch moved" (409 is an error); raw reads (files up to 100 MB, BOM kept); GitHub rate limits
  (403 / 429 + `retry-after` / `x-ratelimit-*`) wait once when short, else 503 `github_rate_limited` + `retryAfter`.
- Site action: none (not released). For P11 / P15: set `VIBE_GITHUB_TOKEN`, bind D1 as `CMS_DB`.

## 0.4.0 — unreleased (P3b, P4)

- **P3b — drafts in D1.** KV is eventually consistent, so drafts (content included) now live in D1 table
  `cms_draft_index` (migration `0002_draft_content.sql`, column `content`); a save with `expectedRevision` is one atomic
  statement (0 rows = `DraftConflictError`). New API: `createD1DraftStore(db)`, `createMemoryDraftStore()`,
  `DraftStore.save / get / discard / clearAfterPublish / mine / forResource`, `MAX_DRAFT_BYTES` (1,900,000; D1 row limit
  2,000,000) + `DraftTooLargeError`, `INTERNAL_USER_ID` (user ids are internal ids, never emails). Removed:
  `createKvDraftStore`, `createMemoryKv`, `createD1DraftIndex`, `createMemoryDraftIndex`, `createDrafts`.
- Writer: `writeFile`, `writeArrayItem`, `moveArrayItem`, `writeMarkdownItem` return `{ text, rewroteWholeFile }`;
  `patchJsonDetailed`, `patchMarkdownDetailed`, `finishJsonPatch`, `finishMarkdownPatch`. `rewroteWholeFile` = the
  format-keeping patch could not reproduce the content, so the whole file was re-written in its own style.
- **P4 — locked fields on the server** (`@sonle282/vibe-cms/locks`): `checkLocks({ config, role, target, before,
  after })` → violations `{ path, field, label, reason, message }` ("Only the owner can change Price"); editor rules:
  locked values never change (any depth), new items only with locked fields empty, re-order allowed (records by id),
  no removing items that hold locked values; owner may do anything. `saveDraftChecked` (draft not written when refused)
  and `checkPublishLocks` (re-check with the role at publish time) → `LockedFieldError` (403) + an audit `denied` row;
  `lockedFieldResponse`. Audit log: `createD1AuditLog`, `createMemoryAuditLog`, migration `0003_audit_log.sql`.
- Site action: none (not released). KV `<site>-session` holds sessions only.

## 0.3.0 — unreleased (P3)

- Writer (`@sonle282/vibe-cms/writer`): `patchJson`, `writeFile`, `writeArrayItem`, `moveArrayItem`, `patchMarkdown`,
  `writeMarkdownItem`. Unchanged content = the same bytes; one changed value = one changed line; added / removed / moved
  items and keys change only their own lines. Keeps indent (2 / 4 spaces, tab), CRLF / LF, final newline, BOM, key
  order, number spelling, escapes (\uXXXX-only files stay ASCII), one-line arrays / objects, blank lines between items;
  Markdown keeps front-matter order, quote style, comments and the body.
- Store (`@sonle282/vibe-cms/store`): `ContentSource` (content built into the Worker via `virtual:vibe-cms/content`,
  with sha256 versions per file and per record), `DraftStore` (KV, one draft per user + resource, revision number,
  conflict check), `DraftIndex` (D1) and `createDrafts()` keeping both in step; in-memory versions for tests.
- D1 migration `migrations/0001_draft_index.sql` (table `cms_draft_index`), shipped in the package.
- `/api/cms/health` also reports `sources` (content files built into the Worker).
- Site action: none yet (the store is used from P5). When P6 / P11 set up the site: KV `<site>-session` holds drafts
  (keys `draft:…`), D1 `<site>-cms` gets migration 0001.

## 0.2.0 — unreleased (P2)

- The build checks the whole `cms.config.ts` (every field type and option, keys, paths, repo / branch, collections,
  sections, references, nesting ≤ 4) **and the content files it declares** (exist, parse, values match the field types;
  missing required = error, undeclared property = warning). All errors at once, each with its place and a fix.
- New exports: `checkCmsConfig`, `checkContent`, `checkSite`, `formatProblem`, `formatWarnings`, `MAX_DEPTH`,
  `DEFAULT_CONTENT_DIRS`; `CmsConfigError.problems` is now `{ path, message, hint }[]`. Config option `contentDirs`.
- Distribution: GitHub Release with `vibe-cms-X.Y.Z.tgz` (workflow on tag `v*`), installed by URL — no token;
  GitHub Packages dropped. Runtime dependency: `yaml` (Markdown front matter).
- Demo site: `imageService: "compile"` (no `IMAGES` binding), locked email + address.
- Site action: fix what the build reports; add `imageService: "compile"` to `cloudflare()`; content must live under
  `src/data/` or `src/content/` (or list the folder in `contentDirs`).

## 0.1.0 — unreleased (P1)

- Astro integration `vibeCms()`: loads and checks the site's `cms.config.ts` (clear message with the place of each
  mistake), injects `/admin` (placeholder: "Vibe CMS — config OK: N files, M collections") and `/api/cms/health`
  (package, version, site, files, collections). Public pages keep prerendering.
- `@sonle282/vibe-cms/config`: `defineCmsConfig`, field builders `f.text / richText / image / select / hours / object /
  list / reference`, `locked: "owner"`.
- `fixtures/demo-site` (invented content), unit tests, local smoke test, CI.
- Site action: none (not published yet).
