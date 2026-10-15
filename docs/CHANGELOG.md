# Changelog — @sonle282/vibe-cms

Semver: patch = fixes; minor = new features, no change to a site's config or data; major = a new `configVersion` or a
migration that is not automatic. Each entry says what a site has to do.

## Unreleased

**M16 — what a site's own controls need from the form.** Site action: none (new optional settings).

- `f.image({ mobile: "<key>" })`: the phone version is the sibling image field of that name (plain addresses, Mr Spa's
  `image` + `mobileImage`) — one card with Desktop | Mobile, the help of the version shown; the sibling is not a card of
  its own. Checked: a sibling image field, not paired itself, not paired twice; an image of a list keeps `mobile: true`.
- A field's `hidden: true`: not shown on its own (another field's control edits it); still checked, saved, published.
- Plugin controls: `setAt(path, value)` (write and show another field of the record) and `standardAt(path)` (another
  field's standard box). `@sonle282/vibe-cms/admin` exports `linkOpensText`, `formatPhone`, `phoneHrefValue`,
  `phoneProblem` for plugins.

## 0.27.0 — 2026-10-15 (a site that had a CMS keeps its Cloudflare set-up)

**P21 (package part) — a site that had a CMS keeps its names.** Site action: none (new optional settings; a site
without an older CMS sees no change).

- `bindings: { db?, session?, media?, loginLimiter?, publishLimiter? }` and `secrets: { githubToken? }`: the names the
  site's Worker already uses (Mr Spa: R2 `MEDIA`, secret `CMS_GITHUB_TOKEN`). Read by the Worker (`siteEnv`), the media
  route, the admin page and every CLI command — no new resources, no data copied, no secret entered again.
- The preview reads a template's `data-cms-bind` / `-href` / `-alt` (the Mr Spa CMS's) as `data-cms-field` of the file
  being edited — in the preview only; the page's HTML is unchanged. A whole list bound so is only marked, not redrawn.
- The old CMS's D1 kept as the site's `CMS_DB`: its tables with the package's names (cms_users, cms_auth_state,
  cms_draft_index, cms_audit_log) are renamed `legacy_cms_*` in place by `setup` / `migrate --rename-legacy` (without
  it they stop and change nothing; every row kept, nothing deleted); `import-legacy-users --from CMS_DB` reads
  `legacy_cms_users`. `setup` keeps the KV namespace the `SESSION` binding already uses, whatever its title.

## 0.26.1 — 2026-10-14 (installing the CMS no longer changes a site's build tools)

- **Site action:** none — no data change, no D1 migration.
- The package no longer has Vite as a peer dependency: npm added the newest Vite at the top of a site that only had
  the copies inside Astro, and de-duplicated onto it (Mr Spa: Vite 8.2.1 → 8.3.4, rolldown 1.2.4 → 1.2.14) — a
  different build only because the CMS was installed. The package now uses the site's own Vite (its Astro's) to load
  cms.config.ts, and a local `normalizePath`. `yaml` accepts ^2.8.0. On Mr Spa, adding the package changes no
  existing package version but a types-only one.

## 0.26.0 — 2026-10-14 (P20: stores for content that is not one list per file — json-object, pointer, keep; round-trip in vibe-cms check)

- **Site action:** none — no data change, no D1 migration. New optional settings: `store.kind: "json-object"`, `pointer` (stores and files), `keep`, `f.image({ caption: true })`, `redirectsCheck({ allow })`; `npx vibe-cms check` now also round-trips every record.

**P20 (package part) — stores for content that is not one list per file.** Nothing to do on a site.

- `store: { kind: "json-object", path, idField }`: records keyed by id in one object (`{ "privacy-policy": { "slug":
  "privacy-policy", … } }`); each record holds its id too, and the build says so when it does not match its key.
- `pointer: "projects"` on "json-array" and "json-object": the list (or object) inside the file's object; the other
  keys of the file stay as they are.
- `pointer: "header"` on a file: the record is that key of the file's object, so one JSON file can hold several
  records — several file entries share it (Mr Spa: site-settings.json → Header, Footer, Search & sharing, Popup;
  policies.json → each policy under Pages › Policies). Each has its own version: publishing Header does not make a
  Footer draft stale. Entries on one file may not overlap, nor share it with a whole-file entry.
- `keep: ["sizeGuide", "hero.imageAlt", "items[].id"]` on a file or collection: keys the site owns, kept as they are
  and not shown, without a "not in cms.config" warning (a declared field cannot be kept).
- The store, the build check, the API (read, save, publish, history, Hide / Show) and the format-keeping writer use
  them: a publish changes only the record's lines (line endings and the rest of the file byte for byte).
- `f.image({ caption: true })`: the image holds a caption too (`{ src, alt, caption }`), edited under it.
- `redirectsCheck({ allow: ["/category/pedicure-chairs"] })`: sources that may redirect although they look like a
  record's page (a record the site shows at another address).
- `npx vibe-cms check` does a round-trip: every record written back unchanged by the writer publish uses must give
  its file byte for byte ("… records round-trip byte for byte (N files)"); a record that would not is an error.
  On Mr Spa's content: 172 records in 13 files, all 83 products among them, byte for byte.
- Fixed: a record whose undeclared status field was `status.archived` stopped the build.

## 0.25.0 — 2026-10-14 (M8–M10, M13, M14, P19: the Mr Spa CMS's lists, record and document editors, menus and prices; admin and site plugins)

- **Site action:** none — no data change, no D1 migration. Visible in every site's admin: the Mr Spa lists (M8), a collection without a `preview` now opens in the record editor (M9), and every rich text has the Mr Spa toolbar and Add link dialog (no "Edit HTML / Markdown" button, M10). New optional settings: `layout`, `sections`, `ready`, `document`, `f.menu`, `f.price`, `sameAs`, `admin.plugins`, `plugins`.

**P19 — site plugins: checks of the whole site.** Nothing to do on a site; new optional `plugins` (README → Site
plugins).

- `plugins: [...]` in cms.config.ts: `{ name, files?, check(site) }`, run on the whole site as it will be — at build,
  at publish (the drafts being published put in; the plugins' `files` read from the branch) and at Hide / Show.
  Errors stop the build / refuse with 422 `site_check_failed` ("The site's checks refused this: …", nothing
  committed); warnings come back with the publish. A plugin that throws is an error naming it.
- `@sonle282/vibe-cms/plugins`:
  - `catalogPlugin({ listed?, liveReferences?, references? })`: every Live record of a collection listed (once) in
    given places ("Table Two is Live but not on the Products page."), Live records pointing to hidden ones (warning),
    and at publish the other records' references still leading somewhere.
  - `redirectsCheck({ file?, statuses?, trailingSlash?, limits? })`: the Mr Spa `_redirects` rules (form, 301,
    duplicates, exact before dynamic, one hop, destinations Live, no rule hiding a Live page) and Cloudflare's limits.
- The demo uses both, with a small `public/_redirects`.

**M14 — admin plugins.** Nothing to do on a site; a site may add its own admin code (README → Admin plugins).

- `admin: { plugins: [...] }` in cms.config.ts: browser modules (paths from cms.config.ts, or package names) bundled
  into `/admin` through `virtual:vibe-cms/admin-plugins`; a missing file stops the build with its path.
- `defineAdminPlugin({ name, controls, panels })` from `@sonle282/vibe-cms/admin`:
  - `controls`: a field with `control: "<name>"` is shown by the plugin's control. It gets the field, its value,
    `set`, `record()` and `standard()` (the standard box, to wrap).
  - `panels`: cards above a collection's list (`where: "list"`, told the rows) or in the record / document editor's
    right column after "Ready to publish" (`where: "record"`, told the record after every change).
- A plugin that throws is shown as "The <name> plugin could not show this: …" in its place; the rest of the CMS works.
- The demo's plugin: the Mr Spa CMS's "Show “Call for price” instead" on a service's price (its rule accepts "Call for
  price"), "On the Services page" above the list, "Profile" in a team member's column.

**M13 — shared blocks like the Mr Spa CMS.** Nothing to do on a site; new optional field builders (README → Menus,
prices, a field that copies another).

- `f.menu({ label, min?, max?, dropdown? })`: the Mr Spa CMS's menu cards. Closed, a card is its label and "Opens: …"
  (a dropdown: "Dropdown · 2 links"); open, "Editing link 2 of 5" (a click closes it), ↑ ↓ ("Move Services up", disabled
  at the ends), ⋯ → Remove (no question; off at `min` with "This list keeps at least 2 links."), then Label and Opens
  (the Link field) and the dropdown's own cards. "+ Add link" adds "New link" opening "/", open with its label focused;
  off at `max` ("This list holds at most 8 links."). One card open at a time. Any list of objects with a text and a link
  field can be shown this way (`menu: true`).
- `f.price({ label })`: a text value with "$" in front of the box (`inputmode="decimal"`, "0.00"); a plain amount is
  saved "$1,299" / "$1,299.50", anything else ("From $980", "$5+") as typed; "Shoppers will see $1,299.".
- `sameAs: "<path>"` on any field: no box of its own — the other field's value, "<label> comes from <section> ›
  <field>" and Edit (goes to it); it takes the other field's value whenever that one changes. Checked: the path exists,
  same type, not itself, not a copy of a copy, not inside a list item.
- The demo's salon info gets a Menu (with a "More" dropdown, drawn by the layout) and a footer phone that is the salon's
  phone; services' price is an `f.price`.

**M10 — the document editor like the Mr Spa CMS.** Nothing to do on a site; new optional settings (README → Document
editor). Rich text everywhere gets the Mr Spa toolbar.

- `layout: "document"` with `document: { title, body, cover?, plain? }`, for collections and files: the paper (760 px;
  the formatting bar on top, sticky; the cover; the title in 34 px; the text in 17 px; "Pasting keeps text only; HTML
  code is not accepted.") and a 340 px column: **On the website**, **Post details** / **Page details** (the other fields
  and **Web address** — fixed, or for a new post filled in from the title until shortened: "Page address" on the Ready
  list), **In Google** (`host › blog › slug`, "<title> | <site name>", the first lines, 217 characters + "…"), **Ready to
  publish**. No ID or Status box; no page on the canvas.
- `plain: true` (a policy): no formatting bar; "Plain text · the sections stay as they are" and "N words" above the
  title; the sections' text boxes as the page's text; "No empty section" on the Ready list.
- The rich text toolbar is the Mr Spa CMS's: Paragraph · Heading 2 · Heading 3 · B · I · Bulleted list · Numbered list
  · Add link · Insert image, plain text buttons. Quote only for a field whose `allow` has `blockquote`; Unlink and the
  "Edit HTML / Edit Markdown" button are gone (a Markdown post the visual editor cannot keep still opens as Markdown).
- **Add link** is the Mr Spa dialog: "Choose a page" (the site's pages) or "Or enter a secure HTTPS URL"; "Choose a
  page or enter an HTTPS URL." / "Use a valid HTTPS URL."; Cancel / Insert link.
- Fixed: saving in the record editor (M9) a record that is a draft on the website left its status as one unsaved change.
- The change lists (Review changes, Drafts, history) name the status "Status" for records whose editor has no Status
  box. The demo's blog uses the document editor and gains a plain "Privacy policy" page (group Policies).

**M9 — the record editor like the Mr Spa CMS.** Nothing to do on a site; new optional settings (README → Record
editor).

- `layout: "record"` (the default for a collection without a `preview`): the sections on the left (168 px, they follow
  the scroll; a row above below 1240 px), the form in cards (≤ 680 px) under "* Required before you can publish", and
  a 300 px column: **On the website** (the pill Live / Draft / Archived, the record's address when Live, and its note —
  "The website shows this version." / "You have unsaved changes. …" / "You have a saved draft. …" / "Not on the website
  yet. Publish adds it." / "Hidden from the website. …"), **Ready to publish** / **Before you publish · N to do** (the
  `ready` fields, by default the required ones and lists with a `min`, then "No errors"; each goes to its field; when
  all are done but Publish waits, why), **Duplicate <item>** (`list.duplicate`) and **Hide from website** / **Show on
  website again** (`status.archived`). Below 1024 px the column goes under the form.
- No ID or Status box in the record editor: the id comes from the name; saving keeps the record Live (or Archived when
  hidden).
- New `POST /api/cms/collections/:key/items/:id/visibility` `{ action: "archive" | "unarchive" }`: one commit of the
  status only (`cms: hide <name> from the website`), audited and rate limited like Publish; the person's own draft
  follows the new status and version.
- Collections take `sections` (as files do) and `ready`; `layout: "page"` needs a `preview`. The demo's team uses the
  record editor.

**M8 — collection lists like the Mr Spa CMS.** Nothing to do on a site; new optional settings (README → Collection
lists).

- The list: a 44 px thumbnail and the name (+ an optional second line, `list.detail: "SKU {sku}"`), the columns of
  `list.columns`, the status **Live** / **Draft** / **Archived** with "Unpublished changes" (and its "Draft saved …"
  tooltip) when you have a draft, a ⋯ per record: **Edit**, **Duplicate** (`list.duplicate`), **View on website**
  (only when Live). The ID column is gone; a new record's draft is on Drafts, not a row, until it is published.
- The toolbar: search (every word, in the name, id, columns and `list.search`), the filters of `list.filters`
  (buttons up to 5 choices, a dropdown above), the count "3 services" / "1 of 3 services"; empty: "No services yet." /
  "No services match these filters.". The top bar's button reads **Add service** (`labels.add`, e.g. "New post").
- Duplicate: asks first ("Create a new, unpublished service from …? … Create copy"), then opens a draft named
  "Copy of …" (id from that name, unique), status draft, without the `clear` fields.
- `status.archived`: a third status value (a record hidden from the website, kept in the CMS). The API's list answers
  each record's `status`, the `values` its list shows and `draftSavedAt`.


- **`npx vibe-cms init`:** a site whose `astro.config` builds its pages as files (`build: { format: "file" }`, pages at
  `/about` with no trailing slash) gets previews written the same way (`preview: "/about"`); other sites keep
  `"/about/"`. The `TODO: preview` examples follow the site's format too. Found on Modern Nails Lounge (P24).

## 0.24.0 — 2026-10-14 (M15: `npx vibe-cms init` — a first cms.config.ts from a site's JSON content)

- **Site action:** none — no data change, no D1 migration. New: `npx vibe-cms init` for a site that has no `cms.config.ts` yet.

**M15 — `npx vibe-cms init`: a site without a CMS gets a first `cms.config.ts`.** Nothing to do on a site that has one.

- Reads every JSON file of `src/data` and `src/content` (or `--data <folders>`, written into `contentDirs`). A JSON
  object → a page: key and label from the file name, `preview` when `src/pages` has a page of that name, policies in
  the "Policies" group, header / footer / popup / banner files "Across the whole site" (`area: true`), `seo.json` with a
  title and a description → Search & sharing (`layout: "seo"`), sections = its groups. A list of records with a unique
  `id` / `slug` / `key` → a collection (`json-array`).
- Every value → a field, guessed from its key and values: text (multiline past 160 characters or with a line break, a
  date pattern for 2026-10-14), rich text (HTML), image (a path or `{ src }`), link, phone (US numbers set
  `site.phone.country`), number (integer), toggle, opening hours, object, list. Labels from keys ("heroTitle" → "Hero
  title", "seo" → "SEO").
- The draft is checked against the content as it is (the build's check): a guess the content does not fit becomes
  plain text; empty values, mixed kinds and keys that cannot be a field name are left out — all listed at the top of
  the file and in the output. Only a draft the config check accepts is written.
- Preview hints: where a template prints a value of an imported JSON file (`{home.hero.title}`), the
  `data-cms-field="home.hero.title"` to add there; elements bound already are left alone.
- `--dry-run` prints the draft; `--name`, `--url`, `--repo <owner/name>`, `--branch` (default: package.json,
  `site:` of astro.config, git's origin and its default branch). It never replaces `cms.config.ts` without `--force`.
- README → Install: step 3 is now `npx vibe-cms init`.

## 0.23.0 — 2026-10-13 (M7, M11, M12: Pages, Media, Drafts, People, Activity and Version history like the Mr Spa CMS)

- **Site action:** none — no data change, no D1 migration. Optional: the new file settings `group`, `area` + `description`, `outline`, `toggle` and `layout: "seo"` (M7, README).

**M12 — People, Activity, Version history and sign-in like the Mr Spa CMS.** Nothing to do on a site (no D1
migration, no config change).

- **People:** the tabs People | Activity; "N users." + Refresh; the table Person (initials + username) · Role · Status ·
  Last sign-in ("Not yet") with a ⋯ per person: **Reset password** (the admin types the new one, 12–200 characters —
  the person chooses their own at the next sign-in) and **Disable** / **Enable** (asked first). On the right **Add a
  person**: Username ("e.g. lan.showroom"), a temporary password already filled in (4 × 4 letters and digits that are
  not mixed up; change it if you like; Copy), the role cards Editor / Admin, **Create account**. Every outcome is said
  in the status line ("User created.", "Password reset.", "You cannot disable your current account."). The role menu
  and "Name (optional)" are gone from the screen (roles: the API's `set-role`).
- **Activity:** the last 100 events — Date · Person · What happened · Change (the commit) · Result (Done / Failed);
  filters **All · Publishing · Sign-ins · Failed**; "From the last N events." + Refresh. API: `?kind=failed`,
  `?limit=1..100` (50 by default).
- **Version history** is a dialog over the editor (the History screen is gone; its address opens the editor with the
  dialog) and is there **for every role** — an admin-only file or collection stays admins only: "Published versions for
  this resource. Choosing Restore creates a draft only.", the last 10, each "by …", what restoring it would change and
  **Restore as draft**; it asks only over a draft ("Replace current draft"). API: `GET /history?limit=1..25`
  (10 by default) `&contents=1` (each version's value + the live one); editors may read and restore.
- **Sign-in:** "Signing in…" on the button while it works; a problem is said just above the button. At 900 px and below
  the editor says "Open on a laptop"; the sign-in page is no longer covered.

**M11 — Media and Drafts like the Mr Spa CMS.** Nothing to do on a site (no D1 migration).

- **Media:** search, chips **All · Pages · each collection | Not used · Not published yet · Archived**, 4:3 tiles
  ("1440 × 990 · 184 KB · Salon info +2"), Load more; top bar **⋯ Remove unused images…** and **Upload images**.
  The **detail panel** (360 px, × / Esc): Rename · Copy link · Adjust; Dimensions / Format / File size / Uploaded;
  **Used on** (each row opens the editor at that field; a saved draft that uses it is listed too); **Remove image**
  (an upload never published and used nowhere — for good), **Archive / Unarchive** (a published upload used nowhere;
  archived images are not offered in the image sheet).
- **Rename** = a display name (1–120 characters); the image address never changes. Names and archive dates are small
  notes in the R2 bucket (`media-note/…`), so no new D1 table.
- **Remove unused images…:** uploads never published, used nowhere (live content, the publish branch, everyone's saved
  drafts), uploaded more than 30 days ago — counted first, then asked. The server checks again before Remove, Archive
  and this, and refuses when it cannot tell.
- New API: `GET /media/usage?src=`, `POST /media/name`, `/media/archive`, `/media/unarchive`, `/media/cleanup`
  (`{ dryRun }`), `DELETE /media?src=`; `GET /media` answers `notes`; usage places say their field (`resource`,
  `path`, `detail`). Draft stores have `using(text)`.
- **Drafts:** one card per draft — its kind ("Page", "Service", "New service"), its name, "N changes: a, b, c and K
  more", "Saved Oct 13, 2026, 2:20 PM", **Live** + "Unpublished changes" / **Draft** + "Not on the website yet";
  **See changes** (the review, read-only: "Changes in this draft" · Close), **Open**, ⋯ **Discard draft**.
  "Recently published" (admins): the last 5, "Published by … · Oct 13" and the 7-character commit. The Publish button
  on each card is gone (the Mr Spa CMS publishes from the editor); "Review & publish all" stays.

**M7 — Pages, site-wide areas and Search & sharing like the Mr Spa CMS.** Nothing to do on a site; new optional
settings of a file in `cms.config.ts`:

- **Pages:** two columns — "Main pages" | "Across the whole site" ("Changes here show on every page") and the other
  groups (one column at 1100 px and less). A row: the file icon, its name, its address (an area: its `description`),
  **Live** / **Off**, "Unpublished changes" while a draft is saved. "1 page · 2 site-wide areas"; "Find a page" matches
  the name and the second line and hides empty groups; "No page matches that name.".
- **`group`** (e.g. "Policies"), **`area: true`** + **`description`**: a part of every page, opened on its `preview`
  page; the inspector says "Across the whole site" and "{description}. Applies site-wide.".
- **`outline`**: the area's CSS selector on the page — framed in teal 3 px while it is edited.
- **`toggle`**: the area's on / off toggle field — the switch "Show on website" with the Mr Spa CMS's four sentences
  (draft against website); Pages says "Off" while it is off on the website (`GET /api/cms/content` answers `off`).
- **`layout: "seo"`** + **`seo: { title, description, siteName?, image? }`**: the Search & sharing screen — cards
  "Search results" and "Sharing image", the description's "N / 160" (amber above 160), the Google result and the share
  card (the site's host), "Social apps can take a few days to show a new image." No page on the canvas.

## 0.22.0 — 2026-10-13 (M1–M6: the Mr Spa CMS editor — frame, roles, inspector, sections, links, images, publishing)

- **Site action:** none — no data change, no D1 migration. Optional: write the role name `"owner"` as `"admin"` in `cms.config.ts` (`roles`, `locked`, `access`; the old name only warns); `cms.config.ts` `site` now refuses unknown keys; for `publish.buildCheck` the GitHub token also needs Checks: read.

**M6 — saving and publishing like the Mr Spa CMS.** Nothing to do on a site; new optional settings.

- **Publish = two dialogs:** "Review changes" ("Review the changes to {name} before publishing.") — the changes by
  section, "Changed: / Added: / Removed: {label}", before → after with the changed words marked, images as 40 × 28
  thumbnails — then "Publish {name}" ("This will publish to {host}."). Publish reads "Publishing…" while it runs; the
  outcome is the status, not a toast. The Drafts screen's Publish uses the same two dialogs.
- **After Publish:** checks at 0, 10, 20, 30, 45 s, then every 60 s, for at most 20 minutes from the publish (it was
  every 10 s for 15 minutes); the receipt stays until the change is live, so a reload checks again. The chip's tooltip
  counts the time ("· 1m 5s").
- **`publish: { typicalMinutes, buildCheck }`** in `cms.config.ts`: "Publishing… this usually takes 5–10 minutes";
  with `buildCheck` (the GitHub check run that builds the site, e.g. "Workers Builds"; the token needs Checks: read)
  a failed build says "The website build failed for this publish (commit …). The website still shows the previous
  version." — Check again looks once more. `GET /api/cms/live-version?commit=<sha>` answers `build`.
- **Unsaved edits are kept in this browser** (400 ms after the last edit, at once when the page goes away; 24 h;
  removed on Save / Discard / Publish / sign-out). Opening the record again on the same website version asks "Restore
  unsaved changes?" — Restore changes / Discard them.
- No toast after discarding a draft on the Drafts screen.

**M5 — images like the Mr Spa CMS.** Nothing to do on a site; the content does not change shape.

- **Image card:** the picture as it is (contain, on #F5F5F7), Desktop | Mobile ("No mobile image — the desktop image is
  used"), on hover Replace · Adjust · "or drop an image here"; the meta line "name · 1920 × 1280 · 193 KB · Replace"
  (a long name is cut in the middle); ⋯ = Set as main (an image of a list that is not the first: moved to the front) ·
  Copy image link · Remove image (none for a required image or an image of a list). An empty image is the dashed
  "Choose image". The address boxes under the card are gone; `alt` is an **Image description** box under it.
- **Drop a file on the card** = it is checked ("This file type is not supported…", "larger than 10 MB", empty), uploaded
  with its progress ("Uploading… 42%") and used — "Image added" / "Image replaced" with Undo.
- **Image sheet:** "Homepage › Showroom" over "Choose image for {area}"; Library | Upload; "Search by file name, page or
  product"; "N images (found)"; chips **All · Pages · each collection · Not used · Not published yet**; 5 columns, the
  current image first ("Current"), uploads not on the website yet marked "Not published yet", "Used on" under a tile
  ("Salon info +1"); "Load more" (40 at a time); Cancel · Use image; arrows / Home / End / Enter, double-click, Esc.
  An upload is selected in the Library (it is not used until Use image). `GET /api/cms/media` now also says where the
  live content uses each image (`usage`).
- **Adjust** replaces Crop / resize: the "Adjust image" dialog (Shape Original / Square / Landscape / Portrait, the
  focus point — click the preview or the Horizontal / Vertical focus sliders — "Create adjusted copy"); the copy is a
  new upload named `{image}-{shape}`, then offered first in the sheet. `cropRect` / `outputSize` / `CROP_PRESETS` /
  `RESIZE_WIDTHS` are now `adjustRect` / `adjustSize` / `ADJUST_SHAPES`.
- Upload errors in the Mr Spa CMS's words ("Too many uploads in a short time…", "The upload was interrupted…").

**M4 — the Link and Phone fields of the Mr Spa CMS.** Nothing to do on a site; new in `cms.config.ts`:

- **`f.link`**: saved as the href the site already uses (an existing link comes back byte for byte). The editor picks
  **Page · Web address · Phone · Email**; Page lists the files and collections with a fixed `preview`, then the new
  `site.pages` (`[{ path, label }]`), with **Find a page** above more than 8. One line says where it goes ("Opens:
  mysalon.example/about", "Opens: call (215) 772-1111", "Opens: nothing (no link)"). A wrong link is never written: the
  field says why in plain words ("Enter a full web address, like https://example.com or /about."), "Opens: … — until
  this is fixed", and **Save is off** ("Fix the link marked in red before saving."). In the page inspector: "Link
  destination: not visible in the preview." The build and every save check the links of the content.
- **`f.phone`** + **`site.phone: { country }`**: `"US"` / `"CA"` numbers need their area code and are shown "(215)
  772-1111" once typed; other countries take the number with its country code. `tel:` links follow the same rule.
- `phoneHrefValue`, `formatPhone`, `parseHref`, `toHref`, `linkProblem`, `linkOpensText` are exported for a site's code.
- Unknown keys under `site` are now refused by the build (allowed: name, url, timezone, phone, pages).

**M3c — sections like the Mr Spa CMS's, for any shape of content.** Nothing to do on a site; new possibilities in
`cms.config.ts`:

- A section's `fields` may point **into** a field: an object's field (`"hero.title"`) or an item of a **fixed** list
  (`"services[0].card"`, `"services[0].highlights"`) — one list of services gives a section per service ("Head Spa ·
  Card & facts", "Head Spa · Highlights"…). The rest of the list is kept as it is. The build refuses a path into a list
  that is not fixed (its items could move), a path that leads nowhere, and a field listed both whole and in parts.
- `f.object({ …, flat: true })`: in the page inspector its fields show as the section's own, with their own labels (no
  group around them). An object that is a section's only field is always shown so.
- The row's one-line summary reads the texts inside a section's objects too (its title / heading first).

**M3 — the page inspector of the Mr Spa CMS (two levels).** Nothing to do on a site; `sections` in `cms.config.ts` are
what it lists (a page without sections opens straight at its fields).

- **Level 1:** crumb "Pages" (or the collection), the page's name; the tip "Click any part of the page, or pick a
  section below." (× hides it, remembered); one row per section **in the order the page shows them** — its name, one
  line of what it holds (its title / heading, else its first text, else "2 banners", else "N editable fields"), an
  orange dot when it has unsaved changes, "›".
- **Level 2:** ← "Close section", crumb = the page, title = the section; Esc goes back to its row (not while typing);
  a 220 ms slide; the open section is remembered for the session. A click on the page or a validation problem opens
  the field's section. Each field: its label (a small dot), its help, then the input; the one being edited is blue.
- **Validation summary:** "N validation errors" at the top, one button per problem that goes to its field.
- **Lists:** "Banner 1" over the item's own words (or "Untitled"); ↑ ↓ × buttons; **deleting asks first** ("Delete
  banner 2?", red Delete); "2 of 3 allowed." (a fixed set has no count); "Add banner"; a click on a card shows the
  item on the page.
- **Preview:** the chip "Section · Field" sits above the outline, or just inside when there is no room; the page
  scrolls only when the field is out of sight, then the outline flashes once (not with reduced motion); opening a
  section outlines it with its name.
- Gone: the character counter under every text field (the input holds at most `maxLength`; the Mr Spa CMS counts only
  the search description, M7).

**M2 — roles are Admin / Editor** (the Mr Spa CMS's names). Nothing to do on a site; its data stays as it is.

- Every screen says **Admin** (account menu, People, Activity, field notes "Only an admin can change this.", the review
  "(admin only)", sign-in "Ask an admin to reset it."). The People note and role cards are the Mr Spa CMS's words.
- `cms.config`: **`locked: "admin"`**, **`access: "admin"`**, `roles: ["admin", "editor"]`. **`"owner"` still works**
  (its old name): the build prints one warning listing where — rename when convenient.
- The CMS database is not migrated: the Admin role keeps its stored code `owner` (never shown). The People API takes
  `"admin"` (and `"owner"`).
- CLI: **`vibe-cms reset-admin-password`**; `reset-owner-password` still works.
- **Change password** in the account menu opens the Mr Spa dialog ("Change your password": current, new, confirm;
  this session stays signed in) — the My account screen is gone (`/admin/account` opens the dialog). A temporary
  password still has to be replaced at the first sign-in.

**M1 — the frame of the Mr Spa CMS** (docs/DESIGN.md §H; released with M2–M6 as 0.22.0). Nothing to change on a
site: its config, content and data stay as they are.

- **Addresses by path**: `/admin` opens the first page's editor; every screen has its own address
  (`/admin/pages/<file>`, `/admin/catalog/<collection>[/new|/<id>]`, `/admin/drafts`, `/admin/media`, `/admin/users`,
  `/admin/audit`) — a link opens in a new tab, a reload stays. The `#/…` addresses of before still open the same screen.
  The admin route is now `/admin/[...path]`.
- **Rail**: the site's mark; Pages, one place per collection, Media, Drafts (its count); Users (owners) and the account
  menu (two letters of the username) at the bottom. New: a collection's **`under`** shows it as a tab of another
  (Products · Categories · Collections); icons `package` and `pen-line`.
- **Top bar**: the breadcrumb's parent is a button back ("Back to Pages"); **Laptop / Tablet / Mobile** in the middle
  (the page is shown at that size, scaled to fit the canvas; the choice is remembered); the **one save state** ("No
  changes", "N unsaved changes", "Draft saved · not live yet", "Publishing… this usually takes a few minutes", "Live on
  <host>", "Still publishing — check again in a few minutes", problems in red; shortened on a narrow bar); icons **View
  live**, **Version history**, **Discard draft** (a saved draft, or unsaved changes only), **Reload and keep my changes**
  (a save met a newer version), **Check again** — folded into ⋯ on a narrow bar; **Publish is always there**, off with
  the reason in its tooltip ("Save a draft before publishing.", "No changes to publish yet."…).
- **Tooltip**: one tooltip for the admin (400 ms on hover, at once on keyboard focus). **Toast**: no icon, 4 seconds,
  for image and media actions only — saving and publishing speak through the save state.
- Gone (not in the Mr Spa CMS): the Preview toggle (the page is always on the canvas), the line under the top bar,
  Ctrl+S, the "Skip to content" link, the bar over the preview, the form's lead sentence. The admin page's title is
  "<site> CMS".

## 0.21.0 — 2026-10-12 (P12g, P12h, P16a)

- **`f.number`** (P16a): a JSON number — `integer`, `min`, `max`; a number input in the admin; emptied, the value
  is left out. For an offer's order or a card's stamps.
- **Text `from`** (P16a): an item's id made from another field of the same object while the item is new
  (`id: f.text({ label: "ID", from: "name" })`: "Classic Manicure" → `classic-manicure`, `-2` when the list already has
  it); typing the id stops it; an existing id never changes (prices elsewhere point to it).
- **Text `tokens: []`** (P16a): this text holds no {words} at all — a leftover {word} would be printed to visitors.
- **Deeper content** (P16a): object / list nesting up to 8 levels (was 4) — a real menu is services › menu parts ›
  packages › what is included.
- **Images by name** (`media.names`): for a site whose build makes its image sizes from a manifest, content holds
  names (`"nails/nails-01"`); the admin shows and sends addresses and the API converts both ways; an upload is named
  by where the publish commits it (`media.dir`, which may now be outside public/ with `media.base` = where it is
  served until the build has it). The library lists the manifest (`exclude` hides folders); the build and every save
  refuse an unknown name.
- New: `media.base`; `media.dir` may be any folder of the repository when `base` is set.
- **`f.pick`**: a value chosen from a list the site computes from the record's own content (`choices`), for a price
  written once in the menu and used elsewhere by its place (`{ "of": "packages/the-essential-reset" }`). Checked at
  build, save and publish; the admin shows the choices grouped and keeps a value that is no longer listed; the review
  shows the line's name.
- **`f.toggle`**: yes / no, stored as true / false (left out until it is set).
- Site action: none.

## 0.20.0 — 2026-10-12 (U1–U4: the Mr Spa CMS design system)

- **The Mr Spa CMS screens** (U4):
  - **Pages**: one row per page — its name, its address on the website, Live / Draft saved — with "Find a page" and
    a count. Collections are on the rail, not here.
  - **Lists** (each collection): the record's picture (its first image), name, ID and status; "+ New service" in
    the top bar.
  - **Drafts** (new): every draft waiting to publish — what it changes ("2 changes: Photo, Specialty"), when it was
    saved; **Open**, **Publish** (the review dialog of that draft) and ⋯ Discard draft; owners also see what was
    recently published, with View history. "Review & publish all" opens the review of all drafts (published in one
    change, as before).
  - **Media** (new, on the rail): the whole library — uploads first, then the website's own images — with search,
    All / Uploaded / Website, the chosen image's details (dimensions, format, file size, Copy link) and **Upload
    images** (several at once, made smaller in the browser like in the image sheet).
  - **People & activity**: one place with two tabs. People has the add-a-person form beside the list, the role as
    two cards (Editor / Owner) and initials for each person; Activity has Date · Person · What happened · Change ·
    Result (Done / Failed).
  - **History**: one card, the newest version marked Current.
  - **Sign in to <site>** with the site's mark and address; "Forgot your password? Ask an owner to reset it."
  - **Smaller than 900 px**: "Open on a laptop" instead of the editor (and a link to the website).
  - The list API gives each record's first image (`image`), for the thumbnail.
- **The Mr Spa CMS components** (U3):
  - **Dialogs instead of the browser's confirm()**: a card over a dimmed page; Escape, Cancel or a click outside
    changes nothing; the safe choice has focus; a destructive button is red ("Leave without saving?" → Keep editing /
    Discard changes, "Discard your draft?", disable a person, reset a password, restore a version).
  - **Publish in the editor** opens the review of that draft — what changes, then "Publish to website"; a problem is
    shown in the dialog with a link to Review & publish. The Drafts screen still publishes several drafts at once.
  - **Toasts** at the bottom centre with an icon (info, success, error) and at most one action: "Image replaced ·
    Undo", "Image removed · Undo".
  - **Tooltips** on every icon button (Version history, Reload, Open live page, Move up / down, Remove…).
  - **The image card**: the picture as it is (not cropped), its file name and size; hover / focus shows Replace, a
    click on the picture replaces it; ⋯ = Copy image link · Remove image; Desktop / Phone when the field has a phone
    image. The address can still be typed under it.
  - **The image sheet**: "Choose image for Photo", Library / Upload tabs and search, the current image marked; a click
    selects, a double-click or **Use image** uses it; Crop / resize is in the footer for the selected image.
- **The Mr Spa CMS frame** (U2): a 64 px rail — the site's mark, **Pages** (every file, the old Overview), one place
  per collection, **Drafts** with the number waiting; People and Activity (owners) at the bottom, and the avatar with
  the account menu (My account, Sign out). A 56 px top bar: `Pages / Homepage` crumbs, the preview's Desktop / Phone
  switch in the middle, the save state and the screen's buttons on the right — **Publish is the one primary button**
  (Save draft next to it), Version history is an icon. In the editor the page fills the canvas (padding 24, the page
  in a white frame with rounded corners) and the form is in a 360 px inspector on the right; without the preview the
  form is centred as before. The window itself never scrolls — only the canvas and the inspector. "Publishing… / Live"
  is a line under the top bar on every screen.
- New, optional: a collection's `icon` on the rail — `list` (default), `box`, `grid`, `pencil`, `image`,
  `calendar`, `star`, `tag`, `users`, `file` (Lucide shapes); anything else is a config error.
- **The admin uses the Mr Spa CMS design system** (one look for every site's CMS): the same role-based colour tokens
  and values (text, text-secondary, canvas, surface, hairline, input border, accent, success, warning, danger), Geist
  Variable self-hosted for the admin only (the website and the preview keep their own fonts), the type roles (dialog
  18/600 · section 16/600 · body 14 · label 13/500 · help 12), spacing 4–40, radius chip 6 · button / input 10 · image 12 ·
  card 14 · dialog 16, controls input 40 · button 36 · compact 30, status pills with a 6 px dot (Live green, Draft saved
  blue, Unsaved changes amber, Off grey, Failed rose), the 2 px focus ring, and no motion when the system asks for less.
- Site action: none.

## 0.19.0 — 2026-10-12 (P12f · first release: everything below, P1–P12f)

- **Crop / resize = a new copy.** In the image sheet every image (the site's own or an upload) has "Crop / resize":
  pick a shape first (Original, Square, Landscape 4:3, Wide 16:9, Portrait 4:5), then move the crop (drag, or the arrow
  keys; Shift = bigger steps), make it smaller with "Crop size", and choose the width of the copy (only widths smaller
  than the crop). "Save as a new image" makes it in the browser (canvas → WebP, at most 2400 px), uploads it like any
  image and chooses it — the original is never changed, and an original nobody uses is not committed. A failure changes
  nothing: "Adjustment failed. Your original image is unchanged — try again." No Cloudflare `IMAGES` binding.
- Site action: none (uploads must be on: the site's R2 bucket).

## 0.18.0 — unreleased (P12e)

- **`npx vibe-cms import-legacy-users --from <old D1> [--from-config <file>] [--local] [--dry-run]`** — the people of
  the CMS a site ran before (the first site's hand-copied CMS: numeric ids, roles admin / editor) into this site's
  set-up, empty CMS database. Same password hashes → **nobody resets a password**; admin → owner; disabled stays
  disabled; "must change the temporary password" carries over; the old id is kept as `legacy_id`; with an owner, the
  bootstrap is marked as used. One audit row per person. Refuses (and writes nothing) when the target already has
  people, the source is already a Vibe CMS database, or a row cannot come over as it is (unknown hash format, bad
  username, role…). `--dry-run` lists who would come over.
- Site action: none.

## 0.17.0 — unreleased (P12d)

- **`f.tuple([...], { label })`** — a fixed-length list stored as a JSON array, one field per place: e.g. a menu line
  `["Manicure", "$17"]` = `f.tuple([f.text({ label: "Service" }), f.text({ label: "Price", locked: "owner" })])`. Every
  place is a normal field (locks, patterns, rich text…); the form shows them side by side; the review reads per place.
- **Text `pattern` + `patternHint`** — the whole value must match (`pattern: "\\d{2}:\\d{2}"` in cms.config.ts,
  `patternHint: "a time like 09:30"`); the form says the format.
- **Text `tokens`** — the {words} the site's code fills in (`tokens: ["phone", "city"]`): any other `{word}` is refused;
  the form lists them.
- **Rich text `allow`** — the tags one field may hold (a part of the shared list, e.g. `["em", "br"]`): the server cleans
  to it and the toolbar shows only the tools that fit.
- **`rules` on a file or a collection — the plugin seam:** a function `(value, content) => problems` in cms.config.ts
  for checks the field types cannot say (a price that must point at an existing package…). `content.file(key)` /
  `content.items(key)` read the site's other content. Runs at build, when a draft is saved and again at publish; problems
  appear next to the field; `warning: true` does not block. A rule that throws is an error naming it, never a crash.
- Site action: none.

## 0.16.0 — unreleased (P12c)

- **History** (owners): "History" in the editor of a file or record lists its versions, newest first, from the site's
  git history — publishes made in the CMS (this package or an older CMS) and changes made in the website's code. A
  record of a shared JSON list shows only the commits that changed that record. Who: the person named in a Vibe CMS
  commit, otherwise the commit's author. Nothing is copied or migrated: it reads GitHub.
- **Compare** says in plain words what restoring a version would change on the website (or that it is what the website
  shows now). **Restore as draft** makes that version my draft (asks before replacing a draft I already have); it goes
  live only when published, through the usual checks (field types, fixed lists, locks). A version the current
  `cms.config` no longer accepts is refused with the reason.
- API: `GET /api/cms/history?resource=`, `GET /api/cms/history/version?resource=&commit=`,
  `POST /api/cms/history/restore` (owners; 403 `owner_only` for editors). Up to 20 versions; a record of a JSON list reads
  the file at each of them (≤ 21 GitHub requests).
- Site action: none (the GitHub token already reads the repository).

## 0.15.0 — unreleased (P12b)

- **Fixed lists:** `f.list(…, { fixed: true })` — the site's code decides which items exist: nobody (owner included)
  adds, removes or moves them; their values stay editable, and lists inside the items keep their own rules. Checked
  when a draft is saved and again at publish (422 `fixed_list`); the form shows no add / delete / move buttons and says
  why.
- **Fixed collections:** `fixed: true` on a collection — no new record (422 `fixed_collection`, no "Add" button);
  existing records stay editable.
- **Owner-only sections:** `access: "owner"` on a file or a collection — editors do not see it (not in the navigation,
  overview, drafts or the admin's config) and get 403 `owner_only`; a refused save or publish writes one audit row
  (`denied`, reason `owner_only`). Use it for a section editors should not open at all; `locked: "owner"` on fields
  still shows them to editors, greyed out.
- **Activity** (owners): the audit log in plain words — publishes, sign-ins, people changes and what was refused —
  50 at a time, with filters All · Publishing · Sign-ins · People · Refused. API: `GET /api/cms/activity?kind=&before=`.
  Contents are never shown (the audit never holds them).
- Site action: none. Add `fixed` / `access` to `cms.config.ts` where the site needs them.

## 0.14.0 — unreleased (P11)

- **The `vibe-cms` command** (`npx vibe-cms help`, run in the site's folder):
  `setup --site <site> [--account <id>] [--local]` creates — only if missing — D1 `<site>-cms`, KV `<site>-session`,
  R2 `<site>-media`, writes the five CMS bindings into `wrangler.jsonc` (comments, order and other bindings kept) and
  applies the migrations; a second run changes nothing. A binding that already points at another site's database or
  bucket is refused. `migrate`, `check` (config + content + bindings point only at `<site>-*`), `export` / `import`
  (D1 rows + a counts file; import only into an empty database with the same migrations, rows compared),
  `update [version]` (release URL in package.json + `npm install`, prints the "Site action" notes in between) and
  `reset-owner-password` (temporary password shown once, must be changed, sessions signed out, audited).
- Cloudflare goes through the site's own wrangler and the signed-in user; the CLI never handles tokens or secrets.
- New runtime dependency (MIT, CLI only): `jsonc-parser`.
- CI installs the packed package from a local release URL with no token and runs the README steps on the demo site.
- Site action: none to upgrade. A new site uses `npx vibe-cms setup --site <site>` instead of writing the bindings
  by hand; an existing site can run it once (it keeps what is right and says what it changed).

## 0.13.0 — unreleased (P9)

- **Preview next to the form.** The real page, in a same-origin frame, shows the draft as it is typed: no reload, only
  the elements of the changed field are updated (measured: under 16 ms a key). Text, rich text (cleaned; Markdown
  shown as HTML), images, links, references, lists of text, opening hours. List items follow the form (added items
  are copies of the first, removed ones are hidden). A new record shows where its collection is listed.
- Click something on the page to edit it: the form opens that field (another record's content opens that record).
  Focusing a field outlines it on the page with "Section · Field". Links to other sites and forms do nothing.
- Desktop / phone width, reload, open the live page. Open by default on wide windows; the Preview button remembers
  the choice. The page loads only when the pane is first shown.
- Nothing is added to public pages: the admin works on the framed page directly (no script injected, no message
  channel). Templates mark their fields with `data-cms-field`, `data-cms-field-href`, `data-cms-field-alt`,
  `data-cms-item`, `data-cms-list`, `data-cms-item-index` and `data-cms-section` (docs/DESIGN.md §D); old templates
  can use `bind: "<selector>"` in cms.config instead.
- Site action: add `data-cms-*` attributes to templates (or `bind` selectors), set `preview` paths in cms.config, and
  let the site frame its own pages (`X-Frame-Options: SAMEORIGIN` or `frame-ancestors 'self'`, not `DENY`).

## 0.12.0 — unreleased (P8d)

- **Visual editor for rich text and Markdown bodies.** A toolbar replaces the raw HTML / Markdown box: paragraph,
  heading, subheading, bold, italic, bulleted / numbered list, quote, link (web, site, mail or phone addresses only),
  remove link, image. "Edit HTML" / "Edit Markdown" shows the source. Paste keeps only the text. Undo works.
- **Images in the text:** insert from the image sheet (upload or library), then click an image to set its alt text,
  replace it, remove it, or resize it by dragging its corner, typing a width or with the arrow keys. The ratio is
  always kept: only `width` is written.
- Rich text stays HTML. A Markdown body stays Markdown and keeps the post's own style (list marker, `*` / `_`, `**` /
  `__`). A resized image is written as `<img src alt width>` inside the Markdown. A field nobody edits is never
  re-written. A post the editor could not show without changing it (HTML blocks, footnotes) opens as Markdown, with
  a note.
- What the editor shows is built in an inert document and cleaned with the same allow-list as the server (now shared:
  `src/check/rich-text-allow.ts`). The server still cleans on save.
- The review screen reads rich-text changes as plain words and lists each image added, removed, resized or
  re-described.
- New runtime dependencies (MIT, admin only; the Markdown part loads only when a Markdown body is opened):
  `mdast-util-from-markdown`, `mdast-util-to-hast`, `hast-util-from-dom`, `hast-util-to-mdast`,
  `mdast-util-to-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`.
- Fixed: a People test pinned to a calendar date ("Oct 8, 2026") failed from the next day on.
- Site action: none. Sites that show Markdown bodies must render HTML inside Markdown (Astro does by default) for
  resized images; CSS `img { max-width: 100%; height: auto; }` keeps their ratio on small screens.

## 0.11.0 — unreleased (P10)

- **Images.** Image fields get **Choose image…** and **Remove**. The sheet uploads a photo (drop or choose a file) or
  picks one from the library: uploads (newest first) and the site's own images under `public/` (listed at build).
  Search by name. After choosing, the cursor moves to the alt text when it is empty.
- The browser prepares each upload: longest edge at most 2400 px, WebP (PNG / JPEG where WebP cannot be written).
  Re-encoding drops hidden data such as the camera's GPS. Only JPEG, PNG, WebP and AVIF are accepted; SVG and GIF are not.
- The server checks the real type and pixel size from the bytes. It refuses anything else (415) and anything larger
  than `media.maxBytes` (413). Uploads share the publish rate limit, with their own key per person. The same bytes
  uploaded again reuse the same file.
- Uploads go to `/assets/uploads/YYYY/MM/<name>-<hash8>.<ext>` and wait in the site's R2 bucket (binding
  `CMS_MEDIA`). Until the site is deployed with the file, an injected route serves the waiting copy at that address.
- **Publishing adds every uploaded image the published content uses** (image fields, rich text, Markdown bodies) to
  the same single commit, byte for byte, unless the branch already has it. An image that is neither waiting nor in the
  repository stops the publish (409 `media_missing`, nothing committed).
- New API: `GET /api/cms/media`, `POST /api/cms/media`; publish responses have `media`. New export
  `@sonle282/vibe-cms/media`. New virtual module `virtual:vibe-cms/images`.
- New optional config `media: { dir?, maxBytes? }`. The default is `public/assets/uploads`, 10 MiB.
- Site action: to allow uploads, add an R2 bucket `<site>-media` as binding `CMS_MEDIA` (the P11 `setup` will do this).
  Without it, everything else works and the sheet says uploading is not set up.

## 0.10.0 — unreleased (P8c)

- **Rich text is cleaned on the server** when a draft is saved and again at publish, with the same HTML parser and
  allow-list as the CMS the package grew out of (hast): paragraphs, h2 / h3, lists, links (http / https / mailto / tel /
  relative), bold, italic, underline, quotes, code, figures, images (http / https / relative), class + title. Scripts,
  styles, frames, objects, forms (with their content), event handlers, `style`, `javascript:` / `data:` links and every
  other unknown tag or attribute are removed; unknown tags keep their text. Markdown bodies too (only re-written when
  something unsafe was removed). Max 250,000 characters per value (422).
- Only what a user changed is cleaned: text already in the site's files stays byte for byte. A changed value is stored
  as the parser writes it (an unfinished tag at the end is never kept as typed).
- The editor shows what was saved and where HTML was removed ("Saved, with some HTML removed for safety: Banner
  (hero.text) — <script>"); publish adds a safety note; the PUT response has `cleaned`, publish `warnings` code
  `sanitized`; the audit records the field paths. The build warns (never fails) about rich text in the site's files
  that the CMS would clean once edited.
- New runtime dependencies: `hast-util-from-html`, `hast-util-sanitize`, `hast-util-to-html` (MIT; the CMS routes only).
- Site action: none (not released). Sites that render rich text with `set:html` keep doing so; what the CMS writes is safe.

## 0.9.0 — unreleased (P8b)

- **People screen** (owners; menu "People"): everyone with role, status, "must choose a password" and last sign-in.
  Add a person → their **temporary password is shown once** (Copy; hidden on "Done" or when the page is left; never
  stored). Change role, disable / enable, reset a password (shows a new temporary password once) — each asks first and
  says what happens (signed out at once, drafts kept). No buttons on yourself; the server's refusals (owner only, last
  active owner) are shown on the list. Editors do not see People.
- **My account** (click your name): name, username, role, last sign-in; **change my password** (current + new twice,
  12+ characters) — other sessions end, this one stays signed in. Before P8b a password could only be changed when a
  temporary one forced it.
- Every form posts and carries a hidden username for password managers. `peopleScreen`, `accountScreen`, `ROLE_HELP`
  exported from `@sonle282/vibe-cms/admin`; the admin client gained `request(method, …)`.
- Tests: test/people.test.mjs on happy-dom against the real sign-in + People code (node:sqlite, real session cookies):
  the shown temporary password really signs in, role / disable / enable / reset take effect at once, refusals shown,
  editors kept out, my password change. e2e: the owner adds the editor on the People screen; the editor changes their
  password on My account (50 checks).
- Site action: none (not released).

## 0.8.0 — unreleased (P8)

- **Review & publish in the admin.** The navigation counts my drafts. The review screen shows, for each draft, what it
  changes against the website in the form's words ("Price (owner only): $35 → $40", "Featured services: added Nail Art",
  "Extras: new order", "New service: Gel Removal"); tick drafts and **Publish** — one commit. The editor's "Review &
  publish" opens it for that draft (after saving). Drafts that started before someone else published are unticked and
  explained; refusals (someone published first, owner-only fields, invalid content, rate limit, GitHub) in plain words.
- **Live status:** after publishing, "Publishing…" until `/live-version` serves the published content ("Live on the
  website"), or "Still publishing — Check now" after 15 minutes; remembered across a reload (browser storage: version,
  time, names only).
- API: `GET /api/cms/drafts` (my drafts: label, group, saved at, new, stale — no content). `summarizeChanges`,
  `describeChange`, `formatHours`, `editorFields` exported from `@sonle282/vibe-cms/admin`.
- Tests only: `VIBE_GITHUB_API_URL` redirects publishing to a GitHub on the same machine (loopback http only — any other
  value is ignored, so the token cannot be sent elsewhere). The e2e publishes to a fake GitHub on 127.0.0.1.
- Site action: none (not released).

## 0.7.0 — unreleased (P7)

- **The editor at `/admin`**: navigation of every file and collection, an overview with draft badges, collection
  lists (search, "Add …", Live / Draft saved / New), and a **form generated from `cms.config`** for every field type —
  text (single / multiline, `maxLength` counter), richText (HTML box), image (address, alt, phone image; a plain path
  stays a path), select, hours (days, closed, open / close, label, rows), object, list (add, ↑↓ when `ordered`, delete,
  `min` / `max`, nested), reference (one / many, ordered), dotted keys, sections; records get their ID (filled from the
  name for a new record, fixed once it exists), status and Markdown body. Keys the config does not know are kept.
- **Locked fields for editors** are shown but disabled (any depth), with a lock and "Only the owner can change this.";
  an editor cannot delete a list item that holds owner-only values. The server still enforces it (P4).
- **Save draft** through the P5 API (`expectedRevision`, `sourceVersion`); the same type check as the server runs
  first and problems show next to their fields; 409 / 403 / 422 / 401 explained in plain words; Discard draft; asks
  before leaving with unsaved changes; Ctrl / ⌘+S. Publishing from the admin comes in P8.
- `/admin` is never framed (`x-frame-options: DENY`, `frame-ancestors 'none'`) or cached; the change-password form
  carries a hidden username for password managers.
- New export `@sonle282/vibe-cms/admin` (browser code, started by the injected route; `adminBoot` / `bootJson` also from
  `/api`). Demo site: collections `team` and `posts` (Markdown), more fields — every field type is used.
- Tests: form + shell on a fake DOM (happy-dom, the shell talks to the real API in memory); `npm run e2e` — headless
  Chrome (playwright-core, no browser download) on the built demo in `wrangler dev --local`. Dev dependencies only.
- Site action: none (not released). `/admin` replaces the P6 sign-in-only page.

## 0.6.1 — unreleased (P6b: review of P6)

- Changing the password checks the current one at most **10 times a minute per user** (same `CMS_LOGIN_LIMITER`;
  429 `too_many_attempts`) — a stolen session can no longer guess the password at full speed.
- The bootstrap password is compared in constant time (`sameSecret`); temporary passwords are drawn evenly from the
  54-character alphabet (no modulo bias).
- `/admin`: the sign-in and change-password forms are `method="post"` — if the script has not run, the password goes
  in a POST body, never in the URL (history, logs).
- Site action: none (not released).

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
