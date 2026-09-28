# Changelog — @sonle282/vibe-cms

Semver: patch = fixes; minor = new features, no change to a site's config or data; major = a new `configVersion` or a
migration that is not automatic. Each entry says what a site has to do.

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
