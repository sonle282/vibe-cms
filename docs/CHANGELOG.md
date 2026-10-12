# Changelog — @sonle282/vibe-cms

Semver: patch = fixes; minor = new features, no change to a site's config or data; major = a new `configVersion` or a
migration that is not automatic. Each entry says what a site has to do.

## 0.21.0 — 2026-10-12 (P12g, P12h)

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
