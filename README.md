# Vibe CMS (`@sonle282/vibe-cms`)

An Astro integration that adds a content editor to a site: `/admin` for the salon owner and staff, `/api/cms/*` for
saving and publishing (commits to the site's GitHub repo). Everything is described by one file, `cms.config.ts`.
Target: Astro 7 on **Cloudflare Workers** (`@astrojs/cloudflare`). The source is public to read; it is not
open source — see [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).

> Status: **0.4.0 · P3b / P4.** The build checks `cms.config.ts` and the content it declares; the store (drafts in D1,
> content built into the Worker) and the format-keeping writer are in place. `/admin` is still a
> placeholder. The API, editor and publishing come in P4–P11
> ([docs/TRACKER.md](docs/TRACKER.md), design: [docs/DESIGN.md](docs/DESIGN.md)).

## Install in a site (3 steps, no token)

Every version is a GitHub Release with a `vibe-cms-X.Y.Z.tgz` file. A site installs it by its public URL, pinned to
that version — no `.npmrc`, no `NODE_AUTH_TOKEN`, on your machine or in Cloudflare Workers Builds.
(No release is published yet: the first one comes when the core is usable.)

1. **Install**

   ```bash
   npm i https://github.com/sonle282/vibe-cms/releases/download/v0.3.0/vibe-cms-0.3.0.tgz @astrojs/cloudflare
   ```

   `package.json` then holds
   `"@sonle282/vibe-cms": "https://github.com/sonle282/vibe-cms/releases/download/v0.3.0/vibe-cms-0.3.0.tgz"`.
   To upgrade, change the URL to the new version (read the CHANGELOG's "Site action" first) and run `npm install`.

2. **Add it to `astro.config.mjs`** (public pages keep prerendering; only the CMS routes run on demand):

   ```js
   import { defineConfig } from "astro/config";
   import cloudflare from "@astrojs/cloudflare";
   import vibeCms from "@sonle282/vibe-cms";

   export default defineConfig({
     output: "static",
     // imageService: images are processed at build time and served as-is — no Cloudflare IMAGES binding.
     adapter: cloudflare({ imageService: "compile" }),
     integrations: [vibeCms()],
   });
   ```

3. **Create `cms.config.ts`** at the project root:

   ```ts
   import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

   export default defineCmsConfig({
     configVersion: 1,
     site: { name: "My Salon", url: "https://mysalon.example" },
     repo: { owner: "my-org", name: "mysalon.example", branch: "main" }, // branch = production
     files: [{
       key: "site", label: "Salon info", path: "src/data/site.json", format: "json",
       fields: {
         phone: f.text({ label: "Phone", locked: "owner" }),   // editors see it, only the owner changes it
         email: f.text({ label: "Email", locked: "owner" }),
         hours: f.hours({ label: "Opening hours", locked: "owner" }),
       },
     }],
     collections: [{
       key: "services", label: "Services", itemLabel: "Service",
       store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
       fields: { name: f.text({ label: "Name", required: true }), price: f.text({ label: "Price", locked: "owner" }) },
     }],
   });
   ```

Then `npm run build`: the log shows `config OK: N files, M collections, content checked`, and `/admin` +
`/api/cms/health` answer in `wrangler dev`.

### Cloudflare bindings the adapter adds

- **`SESSION` (KV)** — Astro sessions. Leave it for now; P6 declares it as the site's own KV `<site>-session`.
- **`IMAGES`** — only with the adapter's default `imageService`. Vibe CMS sites set `imageService: "compile"` (or
  `"passthrough"`), so the generated `wrangler.json` has **no** `IMAGES` binding (the demo's smoke test checks this).

## What the build checks

All problems are listed at once, each with its place and a fix; warnings are printed but never stop the build.

| Area | Rules |
|---|---|
| Top level | `configVersion` is 1; no unknown settings (typos); `roles` if given is exactly `["owner", "editor"]` |
| `site` | `name` required; `url` a full `http(s)` address; `timezone` a real IANA zone |
| `repo` | `owner` a GitHub user / organisation name; `name` a repository name (no `.git`); `branch` required and a valid git branch name (no space, `..`, `~^:?*[\`, `@{`, `.lock`, empty parts) |
| Keys | file / collection keys: lowercase `a-z0-9-`, unique across files **and** collections; field keys: identifiers, dotted keys allowed (`"about.title"`) but not clashing with a field at the same level; section keys unique; a field in one section only (a field in no section = warning) |
| Paths | relative, `/` separators, no `..`, not absolute, inside `src/data/` or `src/content/` (add more with `contentDirs`); one entry per path; files are `.json` — **YAML is not supported**; `preview` starts with `/` and its `{placeholders}` are fields of the entry |
| Collections | `store.kind` is `"json-array"` (needs `path` to a `.json` file + `idField`) or `"markdown-dir"` (needs `dir` + `slugField`); the id field, if declared, is text; `order.by` is a field; `status.live` ≠ `status.draft` and both are options of a `status` select |
| Every field | known type; `label` required; no unknown options; `required` is true / false; `locked` only `"owner"` |
| Per type | `text.maxLength` ≥ 1; `select.options` non-empty and unique; `list.of` required (checked too), `min` ≤ `max`; `object.fields` non-empty; `reference.to` names an existing collection (`ordered` without `multiple` = warning); `hours` takes no options; object / list nesting at most **4** levels |
| Content | every declared file / folder exists and parses (JSON; Markdown front matter); json-array files hold a list of records with unique ids; each value matches its field — text is a string (`maxLength`), select is one of the options, hours rows are `{ days: [0–6], open: "HH:MM", close: "HH:MM" }` or `{ days, closed: true }` (each day once, close after open), lists respect `min` / `max`, references point to existing ids, images are a path or `{ src, alt }`; missing **required** values are errors; properties the config does not declare are **warnings** |

Example — a real build of the demo site with a price written as a number, an unknown category and an extra property
(`astro build` exits with code 1):

```text
[WARN] Vibe CMS: 1 warning in the content (the build continues):
  - src/data/services.json[2] ("nail-art").popular: is not in cms.config (editors will not see it) → declare a field for it, or ignore if the site sets it in code
[ERROR] Vibe CMS: cms.config.ts does not match the content (2 problems):
  - src/data/services.json[0] ("classic-manicure").price: expected text, got number 20 → write it in quotes: "20"
  - src/data/services.json[1] ("spa-pedicure").category: text "Hair" is not one of the options → use "Nails", "Spa"
```

## Writer and store (P3, P3b)

- **Writer** (`@sonle282/vibe-cms/writer`) — publishing never re-formats a file: unchanged content gives the same
  bytes, one changed value changes one line, added / removed / moved items or keys change only their own lines. It keeps
  the file's indent (2 / 4 spaces or tab), CRLF / LF, final newline, BOM, key order, number spelling (`1.50` stays),
  escapes, one-line arrays and blank lines. Markdown records keep front-matter order, quotes, comments and the body.
- **Store** (`@sonle282/vibe-cms/store`) — `ContentSource` reads the content built into the Worker
  (`virtual:vibe-cms/content`, exact bytes + sha256 versions); drafts are kept per user (internal id) and per file / record in D1 (`cms_draft_index`, migrations
  `0001_draft_index.sql` + `0002_draft_content.sql`), with a revision checked atomically; up to 1.9 MB per draft.
  Writes return `{ text, rewroteWholeFile }` — `true` only when the whole file had to be re-written.

## Develop this package

```bash
npm ci
npm run check    # typecheck + unit tests + pack contents + store on local D1 + build demo + astro check + local smoke
```

`fixtures/demo-site` is an invented salon used by every test — tests never read another site's data. It runs locally
only: no Cloudflare account, no resources, no deploy.

Release (after review only): set `version` in `package.json`, add its CHANGELOG section, push the tag `vX.Y.Z` —
`.github/workflows/release.yml` checks everything and publishes the GitHub Release with the `.tgz`.
