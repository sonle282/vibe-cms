# Vibe CMS (`@sonle282/vibe-cms`)

An Astro integration that adds a content editor to a site: `/admin` for the salon owner and staff, `/api/cms/*` for
saving and publishing (commits to the site's GitHub repo). Everything is described by one file, `cms.config.ts`.
Target: Astro 7 on **Cloudflare Workers** (`@astrojs/cloudflare`). The source is public to read; it is not
open source — see [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).

> Status: **0.23.0 · M1–M7, M11, M12 (the Mr Spa CMS: editor, Pages, Media, Drafts, People, Activity, Version history).** Done: config + content checks at build, store (drafts in D1), format-keeping writer, locked
> fields on the server, CMS API + one-commit GitHub publishing, sign-in, and the editor at `/admin` (lists, forms
> generated from `cms.config`, a visual rich-text editor, a live preview of the draft on the real page, drafts, review
> of changes, publish, live status, People, My account), rich text cleaned on the server, images (upload to R2, picker,
> inline images resized by dragging, published in the same commit), and the `vibe-cms` command (setup, migrate, check,
> export / import, update, reset-admin-password), fixed lists / collections, admin-only sections, the Activity log, History (restore an older version as a draft),
> tuples, text patterns / tokens, per-field rich-text tags and site `rules`. Also: importing the people of an older CMS, cropping an image
> into a new copy. Next: moving the first sites onto the package (P13–P18; either-fields and images by name, P12g,
> before the second), then
> moving them onto the package (P13–P18;
> [docs/TRACKER.md](docs/TRACKER.md), design: [docs/DESIGN.md](docs/DESIGN.md)). First release: **v0.19.0** (2026-10-12); latest: **v0.23.0** (2026-10-13).

## Install in a site (5 steps, no token)

Every version is a GitHub Release with a `vibe-cms-X.Y.Z.tgz` file. A site installs it by its public URL, pinned to
that version — no `.npmrc`, no `NODE_AUTH_TOKEN`, on your machine or in Cloudflare Workers Builds.

1. **Install**

   ```bash
   npm i https://github.com/sonle282/vibe-cms/releases/download/v0.23.0/vibe-cms-0.23.0.tgz @astrojs/cloudflare
   ```

   `package.json` then holds
   `"@sonle282/vibe-cms": "https://github.com/sonle282/vibe-cms/releases/download/v0.23.0/vibe-cms-0.23.0.tgz"`
   (and `package-lock.json` its checksum). To upgrade later: `npx vibe-cms update [version]` (below).

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
         phone: f.text({ label: "Phone", locked: "admin" }),   // editors see it, only an admin changes it
         email: f.text({ label: "Email", locked: "admin" }),
         hours: f.hours({ label: "Opening hours", locked: "admin" }),
       },
     }],
     collections: [{
       key: "services", label: "Services", itemLabel: "Service",
       store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
       fields: { name: f.text({ label: "Name", required: true }), price: f.text({ label: "Price", locked: "admin" }) },
     }],
   });
   ```

4. **Give the site its Cloudflare resources** (signed in with `npx wrangler login`; `--site` is the site's short
   name, every resource starts with it):

   ```bash
   npx vibe-cms setup --site mysalon
   ```

   Creates — only if missing — D1 `mysalon-cms`, KV `mysalon-session` and R2 `mysalon-media`, writes the bindings
   (`CMS_DB`, `SESSION`, `CMS_MEDIA`, `CMS_LOGIN_LIMITER`, `CMS_PUBLISH_LIMITER`) into `wrangler.jsonc` (comments and
   everything else kept) and applies the migrations. Running it again changes nothing. To try it without an account:
   `--local` (placeholder ids + the local D1 of `wrangler dev`).

5. **Secrets, then check** — the CLI never handles them:

   ```bash
   npx wrangler secret put VIBE_GITHUB_TOKEN        # see "CMS API and publishing" below
   npx wrangler secret put CMS_BOOTSTRAP_USERNAME   # the first admin (remove both after the first sign-in)
   npx wrangler secret put CMS_BOOTSTRAP_PASSWORD
   npx vibe-cms check
   ```

Then `npm run build`: the log shows `config OK: N files, M collections, content checked`, and `/admin` +
`/api/cms/health` answer in `wrangler dev`. CI runs exactly these steps on the demo site from a packed release
(`npm run install:local`).

## The `vibe-cms` command (P11)

Run in the site's folder (`npx vibe-cms help`). Cloudflare goes through the site's own wrangler and the login of whoever
runs it; `--account <id>` picks another account. No command asks for, prints or stores a token.

| Command | What it does |
|---|---|
| `setup --site <site> [--account <id>] [--local]` | Resources + bindings + migrations, as above. Idempotent; a binding already pointing at another site's database or bucket is refused, never re-pointed. With `--account`: the same on another account (hand-over) — the ids in `wrangler.jsonc` follow |
| `migrate [--local]` | Applies the package migrations to `CMS_DB` (after an update). They only add tables / columns |
| `check [--site <site>]` | What the build checks (config + content), plus: the bindings exist and point only at `<site>-*`, migrations are wired, rate limits are there, the package comes from a release URL |
| `export --out <dir> [--local]` | D1 rows (drafts, audit, people) → `<site>-cms.sql` + `<site>-cms.counts.json` (rows per table, migrations). Keep it private: it holds password hashes. R2 is counted, not copied (copy objects with the bucket's own S3 keys) |
| `import --file <sql> [--local]` | Into a set-up, **empty** CMS database with the same migrations; compares the rows table by table |
| `update [version]` | Points `package.json` at that release (default: the latest), runs `npm install`, prints the CHANGELOG's "Site action" of every version in between. Nothing is written if the release does not exist |
| `import-legacy-users --from <old D1> [--from-config <file>] [--dry-run]` | Moving from the CMS a site ran before: its people come over to the new (empty) database with the **same passwords** — admin → owner, disabled stays disabled, a temporary password still has to be changed. Refuses when the new database already has people |
| `reset-admin-password [--username <name>]` (old name `reset-owner-password`) | An admin forgot their password: a temporary one, shown once; they must change it at the next sign-in, every session is signed out, one audit row |

Moving a site to another Cloudflare account, in this order (the ids in `wrangler.jsonc` point at the account `setup`
last ran on): `export --out backup` (old account) → `setup --site <site> --account <new>` →
`import --file backup/<site>-cms.sql --account <new>` → copy R2 → secrets → deploy (docs/DESIGN.md §E.1b).

### Cloudflare bindings the adapter adds

- **`SESSION` (KV)** — Astro sessions. Leave it for now; P6 declares it as the site's own KV `<site>-session`.
- **`IMAGES`** — only with the adapter's default `imageService`. Vibe CMS sites set `imageService: "compile"` (or
  `"passthrough"`), so the generated `wrangler.json` has **no** `IMAGES` binding (the demo's smoke test checks this).

## What the build checks

All problems are listed at once, each with its place and a fix; warnings are printed but never stop the build.

| Area | Rules |
|---|---|
| Top level | `configVersion` is 1; no unknown settings (typos); `roles` if given is exactly `["admin", "editor"]` |
| `site` | `name` required; `url` a full `http(s)` address; `timezone` a real IANA zone |
| `repo` | `owner` a GitHub user / organisation name; `name` a repository name (no `.git`); `branch` required and a valid git branch name (no space, `..`, `~^:?*[\`, `@{`, `.lock`, empty parts) |
| Keys | file / collection keys: lowercase `a-z0-9-`, unique across files **and** collections; field keys: identifiers, dotted keys allowed (`"about.title"`) but not clashing with a field at the same level; section keys unique; a field in one section only (a field in no section = warning) |
| Paths | relative, `/` separators, no `..`, not absolute, inside `src/data/` or `src/content/` (add more with `contentDirs`); one entry per path; files are `.json` — **YAML is not supported**; `preview` starts with `/` and its `{placeholders}` are fields of the entry |
| Collections | `store.kind` is `"json-array"` (needs `path` to a `.json` file + `idField`) or `"markdown-dir"` (needs `dir` + `slugField`); the id field, if declared, is text; `order.by` is a field; `status.live` ≠ `status.draft` and both are options of a `status` select; `fixed` is true / false; `icon` (its place on the admin rail) is one of `list` (default), `box`, `grid`, `pencil`, `image`, `calendar`, `star`, `tag`, `users`, `file`, `package`, `pen-line`; `under` (the key of another collection, not itself `under` one) shows it as a tab of that collection instead of a place on the rail; `access` (files too) only `"owner"` |
| Sections | `sections: [{ key, label, fields }]` on a file: the page inspector's rows (in page order). `fields` are field keys, or a path into one — an object's field (`"hero.title"`) or an item of a **fixed** list (`"services[0].card"`: one list, a section per item); a field belongs to one section; fields in none go under "Other" (a warning). `f.object({ …, flat: true })`: in the inspector its fields are the section's own |
| Every field | known type; `label` required; no unknown options; `required` is true / false; `locked` only `"admin"` (`"owner"`, its old name, works with one warning) |
| Per type | `text.maxLength` ≥ 1; `select.options` non-empty and unique; `list.of` required (checked too), `min` ≤ `max`, `fixed` true / false (with `min` / `max` = warning); `object.fields` non-empty; `reference.to` names an existing collection (`ordered` without `multiple` = warning); `hours` takes no options; object / list nesting at most **8** levels |
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

## Locked fields (P4)

Fields with `locked: "admin"` are enforced on the server when a draft is saved **and** again at publish: an editor may
not change them (at any depth), may add an item only with its locked fields empty, may re-order items, and may not remove
an item whose locked fields hold a value. A refusal is a 403 `locked_field` with the field paths and labels
("Only an admin can change Price") and one audit row — never the values. Rules in detail: docs/DESIGN.md §C.1.

## Fixed lists, admin-only sections, Activity (P12b)

```ts
groups: f.list(f.object({ label: "Group", fields: { … } }), { label: "Menu groups", fixed: true }), // items: edit only
// a collection:  { key: "services", …, fixed: true }   — no new record
// a file / collection:  { key: "salon", …, access: "admin" }   — editors do not see it
```

- `fixed: true` on a list: nobody (admins included) adds, removes or moves its items — the site's code decides which
  exist; their values stay editable. On a collection: no new record. Checked at save and at publish.
- `access: "admin"`: the whole file / collection is hidden from editors (403 `owner_only`, audited). `locked: "admin"`
  on a field is the softer form: editors see it, greyed out.
- **Activity** (admins, the second tab of People): the last 100 events in plain words — Date · Person · What happened ·
  Change · Result — filtered All · Publishing · Sign-ins · Failed (API: `/api/cms/activity?kind=&limit=1..100`).

## Tuples, patterns, tokens, site rules (P12d)

```ts
items: f.list(f.tuple([f.text({ label: "Service" }), f.text({ label: "Price", locked: "admin", pattern: "\\$\\d+\\+?", patternHint: "a price like $17 or $45+" })], { label: "Service and price" }), { label: "Services" }),
intro: f.text({ label: "Intro", tokens: ["phone", "city"] }),          // only {phone} and {city} between braces
headline: f.richText({ label: "Headline", allow: ["em", "br"] }),       // the toolbar shows italic only
// on a file or collection: the site's own check, at build / save / publish
rules: (value, content) => (value.price || value.note ? [] : [{ path: "price", message: "a price or a note is needed" }]),
```

## A price written once: pick + toggle (P12g)

A `pick` holds one of a list the site computes from the record's own content — e.g. a price written once in the menu
and used elsewhere by its place. The function runs on the server (build, save, publish, the editor's view); the
admin shows the result as a list (grouped by `group`) and keeps a value that is no longer listed, saying so.

```ts
const menuLines = (content) => content.services.flatMap((service) => service.groups.flatMap((group) =>
  group.items.map((line) => ({ value: `${group.id}/${line.id}`, label: `${line.name} · ${line.price}`, group: group.title }))));
fromPrice: f.object({ label: "From price", fields: {
  of: f.pick({ label: "Line of the menu", required: true, choices: menuLines }),   // { "of": "packages/the-essential-reset" }
  plain: f.toggle({ label: "Plain", help: "Show the price without “from”" }),      // true / false, left out until set
} }),
```

## Images by name (P12h)

A site whose build makes its image sizes from a manifest stores images by **name** (`"nails/nails-01"`), not by path:

```ts
media: {
  dir: "assets-src/images/uploads",   // where a publish commits an upload (outside public/: the build makes its sizes)
  base: "/assets/uploads",             // where an upload is served from the bucket until then
  names: { manifest: "src/data/image-manifest.json", root: "assets-src/images", exclude: ["brand/"] },
},
```

The manifest is `{ "nails/nails-01": { width, height, widths: [400, 800, 1600], path: "/assets/img/nails/nails-01" } }`;
an address is `url` (default `"{path}-{width}.webp"`) at the largest size ≤ `width` (default 1600). The admin works
with addresses as on any site; the API turns them into names on save and back on read, so drafts, publish, History
and the files hold names. An upload is named by where it is committed, from `root`: `uploads/2026/10/chair-1a2b3c4d`.
The library lists the manifest (`exclude` hides logos and the like). The build and every save refuse a name that is
neither in the manifest nor an upload.

## Numbers and ids made from a name (P16a)

```ts
priority: f.number({ label: "Order", integer: true, min: 1, max: 99 }),   // a JSON number
id: f.text({ label: "ID", from: "name", pattern: "[a-z0-9]+(?:-[a-z0-9]+)*" }),  // made from "name" while the item is new
```

## Pages, site-wide areas, Search & sharing (M7)

```ts
{ key: "terms", label: "Terms", path: "src/data/terms.json", format: "json", preview: "/terms/", group: "Policies", fields },
{ key: "header", label: "Header", path: "src/data/header.json", format: "json", preview: "/",
  area: true, description: "Logo, phone number and menu", outline: "[data-site-header]", fields },
{ key: "popup", label: "Popup", path: "src/data/popup.json", format: "json", preview: "/",
  area: true, description: "Announcement shown over the website", toggle: "enabled",
  fields: { enabled: f.toggle({ label: "Show on website" }), /* … */ } },
{ key: "seo", label: "Search & sharing", path: "src/data/seo.json", format: "json", area: true,
  description: "How the site looks in Google and when shared", layout: "seo",
  seo: { siteName: "siteName", title: "title", description: "description", image: "image" }, fields },
```

**Pages** is the Mr Spa CMS's: "Main pages" on the left (each with its address), "Across the whole site" (the `area`
files, each with its `description`) and the other `group`s on the right; Live / **Off** (an area whose `toggle` is
off on the website); "Unpublished changes" while a draft is saved; "Find a page". An area opens on the page given by
its `preview`, framed in teal (`outline` = its CSS selector on the page); its `toggle` is the switch "Show on website"
with what visitors see ("On — visitors see this popup.", "Off after you publish — visitors still see it until then."…).
`layout: "seo"` is the **Search & sharing** screen: Search results · Sharing image, the description's "N / 160", the
Google result and the share card.

## Links and phone numbers (M4)

```ts
site: { name: "My Salon", url: "https://mysalon.example", phone: { country: "US" },
        pages: [{ path: "/booking/", label: "Booking" }] },   // more pages a link may open
// …
book: f.link({ label: "Book button", required: true }),  // "/booking/", "https://…", "tel:+12157721111", "mailto:…"
phone: f.phone({ label: "Phone", locked: "admin" }),      // "(215) 772-1111"
```

A **link** is saved as the href the site already has (nothing is rewritten). The editor picks what it opens: **Page**
(the files and collections with a fixed `preview`, then `site.pages`; "Find a page" above more than 8), **Web
address**, **Phone** or **Email**, and always sees where it goes ("Opens: mysalon.example/booking/", "Opens: call (215)
772-1111"). A wrong link is never written: the field says why in plain words, "Opens: … — until this is fixed", and
Save waits ("Fix the link marked in red before saving."). Not `required` = it may be empty ("No link").

A **phone** number follows `site.phone.country`: `"US"` / `"CA"` take an area code + 7 digits and show them as "(215)
772-1111"; any other country, or none, takes the number with its country code ("+44 20 7946 0958"). The build and every
save check both. In the site's code, `phoneHrefValue(phone, "US")` gives the number a `tel:` link calls (`+12157721111`).

## Version history (P12c, M12)

Everyone has **Version history** in the editor's top bar (an admin-only file or collection: admins), a dialog as in the
Mr Spa CMS: the last 10 versions of that file or record, newest first, read from the site's git history (CMS publishes
— from this package or an older CMS — and changes made in the code), each with what restoring it would change
("Changed: Tagline"). **Restore as draft** makes it your draft, published like any other; it asks first only when you
already have a draft. Nothing is migrated: it reads GitHub with the site's token.

## CMS API and publishing (P5)

The integration adds `/api/cms/*` (list, read, save drafts, publish, live version — docs/DESIGN.md §C). Until sign-in
exists (P6) every route answers **503 `auth_not_configured`**. Publishing makes **one commit** on `repo.branch` with only
the changed files, written by the format-keeping writer; the branch is never force-updated. A new draft must send
the `sourceVersion` of the content the user opened, so a publish by someone else in between is caught (409).

The site needs:

- **D1 binding `CMS_DB`** — the site's `<site>-cms` database, with this package's `migrations/` applied.
- **Secret `VIBE_GITHUB_TOKEN`** — a GitHub token that can write to the site's repository and nothing else:
  1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
  2. Resource owner: the account / organisation that owns the site's repository. Expiration: at most 1 year (put the
     date in the calendar).
  3. Repository access: **Only select repositories** → the site's repository only.
  4. Permissions → Repository permissions → **Contents: Read and write** (Metadata: read-only is added automatically).
     Nothing else.
  5. In the site folder: `npx wrangler secret put VIBE_GITHUB_TOKEN` and paste it. Never put it in the repository,
     `cms.config.ts` or `wrangler.jsonc`; for local development only, `.dev.vars` (git-ignored).
  6. To rotate: create the new token, `wrangler secret put` it, then revoke the old one on GitHub.
  7. With `publish.buildCheck` (below): also **Checks: Read-only**, so the admin can see the site's build.

**Publishing in the admin (M6, as in the Mr Spa CMS).** Publish opens **Review changes** (the record's changes by
section, before → after, the changed words marked, images as thumbnails), then **Publish {name}** ("This will publish
to {host}."). The status then says "Publishing… this usually takes {typicalMinutes} minutes" (the time since Publish in
its tooltip), checks at 0, 10, 20, 30, 45 s and then every minute, for at most 20 minutes, also after a reload, and
says "Live on {host}" (the record reloads quietly) or "Still publishing — check again in a few minutes". Unsaved edits
are kept in the browser for 24 hours: opening the record again asks **Restore unsaved changes?**.

```ts
publish: { typicalMinutes: "5–10", buildCheck: "Workers Builds" },  // both optional
```

`buildCheck` = the name of the GitHub check run that builds the site (Cloudflare Workers Builds is "Workers Builds"):
when it fails, the status says "The website build failed for this publish (commit …)" instead of waiting.

## Sign-in and People (P6)

Username + password, the same way as the CMS the package grew out of: PBKDF2-SHA256 (100,000 iterations), a session
cookie backed by KV, roles **admin** / **editor** checked on every request, sign-in and publish rate limits. The site
needs these bindings / secrets (docs/DESIGN.md §F.1):

- `CMS_DB` (D1 `<site>-cms`), `SESSION` (KV `<site>-session`),
- rate limits `CMS_LOGIN_LIMITER` (10 / 60 s) and `CMS_PUBLISH_LIMITER` (20 / 60 s) — required in production,
- `CMS_BOOTSTRAP_USERNAME` + `CMS_BOOTSTRAP_PASSWORD` once, for the first admin (then remove them),
- Workers **Paid** is recommended: a sign-in costs ~16–45 ms CPU, Workers Free allows 10 ms.

Admins manage people on the admin's **People** screen, as in the Mr Spa CMS (API: `/api/cms/users`): the table Person ·
Role · Status · Last sign-in; **Add a person** with a temporary password already filled in (change it if you like, Copy,
share it privately) and the role Editor / Admin; each person's ⋯ has **Reset password** (the admin types the new one)
and **Disable** / **Enable**. Roles are changed through the API (`set-role`). New and reset users must choose their own password
at the first sign-in; anyone can change theirs later with **Change password** (the account menu at the bottom of the
rail). An admin who forgot their password: `npx vibe-cms reset-admin-password` (a temporary one, shown once).

## The editor (P7, P8)

`/admin` signs people in and opens the first page's editor. The admin is the CMS of the first site (Mr Spa) packaged
as it is (docs/DESIGN.md §H): a rail (Pages, one place per collection — `under` makes one a tab of another —, Media,
Drafts; Users and the account at the bottom), a top bar (breadcrumb, Laptop / Tablet / Mobile, the save state, View
live, Version history, Discard draft, Save draft, Publish), and every screen at its own address (`/admin/pages/<file>`,
`/admin/catalog/<collection>/<id>`, `/admin/drafts`, `/admin/media`, `/admin/users`…). Lists have search, and a form
is generated from the fields — every field type, sections, nested lists, ordered references.
Saving makes a **draft** (the website does not change); fields with `locked: "admin"` are shown to editors but cannot
be changed. **Review & publish** lists my drafts with what each changes in plain words ("Price: $35 → $40"); publishing
the ticked ones makes one commit, and the admin says when the website serves them ("Live"). Rich text people type is
cleaned on the server (scripts, event handlers, frames, `javascript:` links… are removed and the editor is told);
text already in the site's files is never changed by it (docs/DESIGN.md §F.2). Rich text and Markdown bodies are edited
in a visual editor with a formatting toolbar and images you can insert, resize by dragging (ratio kept) and describe;
Markdown stays Markdown, in the post's own style (§C.6). The browser code ships with the package
(`@sonle282/vibe-cms/admin`); the site adds nothing.

## Images (P10)

An image field is the **image card** of the Mr Spa CMS (M5): the picture as it is, Desktop | Mobile when it has a phone
version (`f.image({ mobile: true })`), on hover **Replace · Adjust · or drop an image here**, the line "name · W × H · KB
Replace", and ⋯ = Set as main (an image of a list) · Copy image link · Remove image (not for a required image or an
image of a list). `alt: true` adds an **Image description** under the card. **Replace** opens the image sheet: Library
| Upload, search by file name, page or product, the chips **All · Pages · each collection · Not used · Not published
yet**, 40 images at a time ("Load more"), Cancel · Use image; after a change "Image replaced" / "Image added" with Undo.
A file dropped on the card is uploaded at once ("Uploading… 42%").

The browser makes an upload at most 2400 px and WebP; the server checks the real type from the bytes and keeps it in the
site's R2 bucket until a publish puts it into the same commit as the content that uses it. The site needs:

- **R2 binding `CMS_MEDIA`** — the site's `<site>-media` bucket. Without it everything else works and the picker says
  uploading is not set up (images already in `public/` can still be chosen).
- **Adjust** (on the card) makes a **new copy** for the image area — Shape Original / Square 1200 × 1200 / Landscape
  1600 × 900 / Portrait 1200 × 1500, around a focus point — then offers it in the sheet. The original is never changed.
  It is made in the browser; no Cloudflare `IMAGES` binding.
- Optional `media: { dir: "public/assets/uploads", maxBytes: 10 * 1024 * 1024 }` in `cms.config.ts` (these are the
  defaults; `maxBytes` at most 25 MiB).

**Media (M11)** is the Mr Spa CMS's library: chips (All · Pages · each collection | Not used · Not published yet ·
Archived), a detail panel with Rename (a display name), Copy link, Adjust, the facts and **Used on** (opens the
field), **Remove image** (never published, used nowhere), **Archive** (published, used nowhere: no longer offered in
the image sheet), and ⋯ **Remove unused images…** (never published, used nowhere, older than 30 days).

## Preview (P9)

The canvas shows the real page with the draft on it, updated as you type — at the size of a laptop (1280 × 800), a
tablet (768 × 1024) or a phone (390 × 844), scaled down to fit; click something on the page to edit it. Templates say which field each element shows (nothing changes for visitors; docs/DESIGN.md §D):

```astro
<h1 data-cms-field="site.hero.title">{site.hero.title}</h1>
<ul data-cms-list="services">{services.map((service) => (
  <li data-cms-item={`services:${service.id}`}><strong data-cms-field="name">{service.name}</strong></li>
))}</ul>
```

Set `preview: "/"` on files and `preview: "/services/"` or `"/blog/{slug}/"` on collections. The site must allow its
own pages in a frame (`X-Frame-Options: SAMEORIGIN` or `frame-ancestors 'self'`, not `DENY`). No script is added to
public pages.

## Develop this package

```bash
npm ci
npm run check    # typecheck + unit tests (incl. the admin on a fake DOM) + pack contents + store on local D1 + API on local D1 with a fake GitHub + sign-in on local D1 / KV / rate limits + build demo + astro check + local smoke + e2e in headless Chrome + install from a packed release (CLI)
```

`fixtures/demo-site` is an invented salon used by every test — tests never read another site's data. It runs locally
only: no Cloudflare account, no resources, no deploy. The e2e step drives a Chrome / Chromium that is already installed
(`CHROME_PATH`, or the usual install paths) — nothing is downloaded.

Release (after review only): set `version` in `package.json`, add its CHANGELOG section, push the tag `vX.Y.Z` —
`.github/workflows/release.yml` checks everything and publishes the GitHub Release with the `.tgz`.
