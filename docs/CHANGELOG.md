# Changelog — @sonle282/vibe-cms

Semver: patch = fixes; minor = new features, no change to a site's config or data; major = a new `configVersion` or a
migration that is not automatic. Each entry says what a site has to do.

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
