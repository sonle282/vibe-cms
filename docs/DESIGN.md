# Vibe CMS — thiết kế (bản công khai)

> Thiết kế chung của gói `@sonle282/vibe-cms`. Repo này **công khai** (từ 2026-09-28): tài liệu chỉ nói về gói, không
> chứa thông tin riêng của site khách (account / tên tài nguyên Cloudflare thật, repo khách, URL workers.dev, kiểm kê CMS
> cũ, phân tích từng site) — phần đó nằm trong tài liệu riêng (private) của từng dự án. Tiến độ: [TRACKER.md](TRACKER.md).
> Nguồn: bản thiết kế v2 (2026-09-28) + các chỉnh đã chốt ở dưới.

## 0. Quyết định đã chốt

1. **Tự xây gói**, không dùng CMS thuê ngoài (CloudCannon / Tina / Keystatic…; CloudCannon chỉ là mẫu tham khảo — Phụ lục).
2. Gói là **Astro integration** `vibeCms()`: site thêm vào `astro.config` + 1 file `cms.config.ts` → gói gắn `/admin` và
   `/api/cms/*`. Đích triển khai duy nhất: **Cloudflare Workers** (static assets + `@astrojs/cloudflare`); trang public
   vẫn prerender, chỉ route CMS chạy on-demand.
3. **Chỉ 2 vai trò: owner, editor.** Ô `locked: "owner"`: editor thấy nhưng không đổi được — **chặn ở server** (PUT nháp
   + publish), audit `denied`, có test. Khoá mặc định cho mọi site: **giá, giờ mở cửa, SĐT, email, địa chỉ** (chốt
   2026-09-28).
4. CMS publish = commit thẳng vào **nhánh production** khai trong `repo.branch` của site (mỗi publish là 1 deploy thật)
   → kiểm tra trên production theo quy tắc publish → kiểm → trả lại.
5. Mỗi site **tài nguyên riêng**: D1 `<site>-cms`, R2 `<site>-media`, KV `<site>-session`; nhiều site có thể chung 1
   account Cloudflare (rủi ro + cách giảm ở §F). `setup` idempotent, chạy lại được ở account khác; có xuất / nhập D1 + R2.
   Worker đang chạy của site được **giữ và dùng lại** (không tạo worker mới, không xoá gì).
6. **Binding visual editing:** site mới / site đang làm lại gắn **`data-cms-*` thẳng vào template**. Selector trong
   config (`bind`) chỉ dùng khi một site cũ bắt buộc giữ HTML public giống từng byte (dự kiến P20–P21).
7. **Preview:** P9 thử trước cách **admin tự inject bridge vào iframe cùng origin** (0 đổi HTML public). Chỉ khi không
   làm được mới dùng preview loader (~1 KB script trên trang) — khi đó hỏi SonLe duyệt trước.
8. **Phân phối:** mỗi bản là 1 **GitHub Release** có file `vibe-cms-x.y.z.tgz`; site cài bằng URL release công khai —
   **không cần token** ở máy dev lẫn Workers Builds (§E.0).
9. **Ảnh:** không dùng binding Cloudflare `IMAGES`. Site khai `imageService` rõ ràng (`"compile"` = xử lý lúc build, hoặc
   `"passthrough"`); binding `SESSION` (KV) do P6 khai thành `<site>-session` (§E.3).

---

## A. Kiến trúc gói

### A.1 Repo gói

```
vibe-cms/
├─ package.json                 # "@sonle282/vibe-cms", semver, exports: ".", "./config", "./routes/*", sau này "./plugins/*", "./bridge"
├─ src/
│  ├─ integration.ts            # Astro integration: injectRoute /admin, /api/cms/*, /api/auth/*; middleware; nạp + kiểm cms.config
│  ├─ config/                   # defineCmsConfig, kiểu field, kiểm config
│  ├─ check/                    # kiểm nội dung thật ↔ config (nền cho lệnh `vibe-cms check`)
│  ├─ routes/                   # route Astro của gói (phát hành dạng mã nguồn, Astro của site biên dịch)
│  ├─ server/                   # (chạy trong Worker) store (bundled + nháp trong D1 — nguồn sự thật, P3b), writer JSON giữ định dạng,
│  │                            #   publish GitHub + audit, auth owner / editor, locks (chặn ở server), media R2
│  ├─ admin/                    # giao diện: shell, danh sách, form sinh từ schema, review, People; fields/*
│  ├─ bridge/                   # visual bridge (2 khung section / field, không render khi gõ, chỉ nhận bản live đúng version)
│  └─ styles/                   # CSS admin (token)
├─ migrations/                  # D1 (audit, users, auth_state, draft_index, media_metadata, …)
├─ plugins/                     # tuỳ chọn: catalog (kiểm chéo quan hệ), redirects-check
├─ bin/vibe-cms.mjs             # `setup`, `migrate`, `check`, `export`, `update` (in lệnh / hướng dẫn, không nhập mật khẩu hộ)
├─ fixtures/demo-site/          # site Astro mẫu, nội dung bịa — nền của mọi test
└─ test/                        # unit + contract + e2e trên fixtures/demo-site
```

### A.2 Ranh giới gói ↔ site

| Của **gói** (nâng cấp theo version) | Của **site** (repo site giữ) |
|---|---|
| Route `/admin`, `/api/cms/*`, `/api/auth/*`; middleware bảo vệ | `cms.config.ts` (schema nội dung, nhãn, ô khoá, repo + nhánh) |
| Form, danh sách, review, publish, lịch sử, People, ảnh | File nội dung (`src/data/*.json`, `src/content/**/*.md`) |
| Bridge, khung section / field, mượt khi gõ, bản live đúng version | Template Astro + thuộc tính `data-cms-*` |
| Migration D1, audit, session, vai trò | `wrangler.jsonc` (binding D1 / KV / R2 riêng site), secret |
| Plugin tuỳ chọn | Chọn bật plugin nào; kiểm tra riêng của site |

Điều kiện kỹ thuật: route của gói chạy on-demand → site cần adapter `@astrojs/cloudflare`. Site đang `output: "static"`
giữ nguyên static cho trang public; worker riêng sẵn có của site (vd form liên hệ) chuyển thành route API Astro hoặc bọc
quanh worker của adapter.

---

## B. Đặc tả `cms.config`

### B.1 Schema

```ts
import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

type Locked = "owner";                     // 1 mức khoá duy nhất
type FieldBase = { label: string; help?: string; required?: boolean; locked?: Locked; bind?: string };
// Kiểu field (P1–P2): text({ maxLength, multiline }) | richText | image({ alt, mobile }) | select({ options })
//   | hours | object({ fields }) | list(of, { ordered, min, max, itemLabel }) | reference({ to, multiple, ordered })
// Dự kiến thêm khi form cần: number, boolean, link({ allow }), date, slug({ from, fixedAfterPublish }).
type Section = { key: string; label: string; fields: string[] };   // nhóm ô = cấp 1 của inspector

export type CmsConfig = {
  configVersion: 1;
  site: { name: string; url: string; timezone?: string };
  repo: { owner: string; name: string; branch: string };           // branch = nhánh production (commit thẳng)
  roles?: ["owner", "editor"];                                      // cố định
  contentDirs?: string[];                                           // thêm vào mặc định ["src/data", "src/content"]
  files: Array<{ key; label; path; format: "json"; preview?; sections?: Section[]; fields: Record<string, Field> }>;
  collections: Array<{
    key; label; itemLabel;
    store: { kind: "json-array"; path: string; idField: string }    // 1 file JSON mảng
         | { kind: "markdown-dir"; dir: string; slugField: string }; // 1 file .md / bản ghi (frontmatter)
    status?: { field: string; live: string; draft: string }; preview?: string; order?: "file" | { by: string };
    fields: Record<string, Field>;
  }>;
  media?: { bucketPrefix: string; maxBytes: number };
};
```

Luật kiểm chi tiết (P2) ở README / `src/config/validate.ts`; lỗi config = build đỏ, gom mọi lỗi một lần, mỗi lỗi có
đường dẫn + gợi ý sửa. **YAML không hỗ trợ** (khuyên JSON; Markdown chỉ cho bài viết).

Quy tắc lưu: **không sửa gì = giống từng byte; sửa 1 ô = 1 dòng** (writer vá đúng giá trị, giữ thụt lề / thứ tự khoá /
xuống dòng cuối).

### B.2 Site mẫu

`fixtures/demo-site/cms.config.ts` — salon bịa: file `site` (SĐT, email, địa chỉ, giờ — khoá owner; tagline; banner) +
collection `services` (giá khoá owner, select, list có thứ tự).

### B.3 Mô tả được gì bằng field chung

Catalog (quan hệ bằng `reference`, thứ tự bằng `list` / `reference({ ordered })`, ẩn bằng field), trang chủ (section +
list banner), menu lồng nhau (list của object chứa list). Phần **không** biểu diễn được bằng schema → plugin: kiểm chéo
toàn catalog khi publish, màn gộp nhiều bản ghi, kiểm `_redirects`.

---

## C. Hợp đồng API chung + luồng publish / audit

Đã làm ở P5 (`src/api`, route `/api/cms/[...path]`). Mọi route: JSON, `cache-control: no-store`, **cần danh tính**
(chưa có đăng nhập P6 → 503 `auth_not_configured`); mọi GET có header `x-cms-live-version`; PUT / POST / DELETE phải
có `Origin` của chính site (không có hoặc lạ → 403 `origin_forbidden`); body tối đa 2 MB (413). Lỗi luôn là
`{ error: <mã>, message, … }`, không có token hay stack trace.

| Method + route | Việc | Trả về / lỗi |
|---|---|---|
| `GET /content` | file + collection theo cms.config: nhãn, số bản ghi, nháp của tôi | 200 |
| `GET /files/:key` | nội dung live + `version` + nháp của tôi (`stale` nếu nguồn đã đổi) | 200 · 404 |
| `PUT /files/:key` | lưu nháp `{ content, expectedRevision, sourceVersion }` — `sourceVersion` = version của bản đã MỞ, bắt buộc khi tạo nháp mới; nháp đã có giữ `sourceVersion` gốc (P5b) | 400 `expected_revision_required` / `source_version_required` / `bad_json` · 422 `invalid_content` (P2) · 403 `locked_field` (P4) · 409 `draft_conflict` · 413 |
| `DELETE /files/:key` | bỏ nháp của tôi | `{ deleted }` |
| `GET /collections/:key` | danh sách bản ghi (id, nhãn, version, có nháp) + bản ghi mới chỉ có trong nháp | 200 · 404 |
| `GET·PUT·DELETE /collections/:key/items/:id` | như trên cho 1 bản ghi; id mới = bản ghi mới (`expectedRevision: 0`) | như trên; id trong nội dung phải bằng id trên URL |
| `POST /publish` | `{ resources: [...] }` (1–50 nháp của tôi) → **đúng 1 commit** | 200 `{ commitSha, files, expectedLiveVersion, warnings, attempts }` · 404 `no_draft` · 409 `source_changed` · 403 `locked_field` · 422 · 502 `branch_moving` / `github_*` · 503 (`github_rate_limited` + `retryAfter`, …) |
| `GET /live-version` | version của nội dung Worker đang phục vụ | `{ liveVersion, branch }` |
| (sau) `/history`, `/assets`, `/users`, `/api/auth/*` | P6, P8, P10 | |

**Luồng publish (P5):**
1. Danh tính, Origin, kích thước body; đọc nháp của từng resource (thiếu → 404 `no_draft`).
2. Audit **`started`** cho từng resource (không ghi được → 503, không publish).
3. Đọc HEAD nhánh `repo.branch` + đúng các file liên quan (bytes chính xác).
4. So `sourceVersion` của nháp với bản trên nhánh (file: sha256 cả file; bản ghi json-array: sha256 của bản ghi —
   bản ghi khác đổi không chặn) → khác = 409 `source_changed`, audit `failed`, không commit.
5. **Ô khoá** với vai trò hiện tại (P4) → 403 + audit `denied`.
6. Kiểu theo schema (P2) → 422 + audit `failed`.
7. Writer P3 ghi từng file (nhiều bản ghi của 1 file áp lần lượt); `rewroteWholeFile` → cảnh báo trong response +
   audit.
8. GitHub: blob → tree (base = HEAD) → commit (cha = HEAD, tác giả "Vibe CMS" + email noreply, message = nhãn + id
   người dùng nội bộ) → cập nhật ref **không force**. Nhánh đã có commit mới → đọc lại từ bước 3, tối đa 3 lần, rồi
   502 `branch_moving`.
   Đối chiếu với publisher đang chạy thật của Mr Spa (P5b): cùng endpoint / header / base64 / `force: false`; chỉ 422
   là "nhánh đã đổi" (409 là lỗi); đọc file bằng media type raw (≤ 100 MB, giữ BOM — Mr Spa đọc JSON base64 ≤ 1 MB);
   GitHub giới hạn tốc độ (403 / 429 + `retry-after` / `x-ratelimit-*`) → chờ 1 lần nếu ≤ 10 giây, không thì 503
   `github_rate_limited` + `retryAfter`.
9. Audit **`succeeded`** (sha commit, số lần thử, cảnh báo); xoá nháp của người publish; trả `expectedLiveVersion`
   (version live sau khi site build lại). Client theo dõi `live-version` (P8).

Token GitHub: secret `VIBE_GITHUB_TOKEN` của site (fine-grained, chỉ 1 repo, Contents read/write — README). D1:
binding `CMS_DB` (= `<site>-cms`, migrations của gói).

### C.1 Ô khoá — quy tắc cho editor (P4)

Reviewer đặt mặc định 2026-09-28 (SonLe im lặng = đồng ý). Owner được làm mọi thứ. Editor:

| # | Quy tắc | Được | Không được |
|---|---|---|---|
| 1 | Giá trị ô `locked: "owner"` không đổi — ở mọi cấp (object, list, item collection, key có chấm). Object / list bị khoá thì khoá cả khối. `""`, `null`, thiếu, `[]`, `{}` coi là như nhau | sửa ô không khoá cạnh đó | sửa giá, giờ, SĐT, email, địa chỉ… |
| 2 | Thêm item mới (bản ghi collection hoặc phần tử list) khi **mọi ô khoá trong item để trống** (chờ chủ điền) | thêm dịch vụ giá trống | thêm dịch vụ đã có giá |
| 3 | Đổi thứ tự item: bản ghi collection so theo id (`idField` / `slugField`), không theo vị trí; phần tử list so theo `id` nếu có, không có thì theo nội dung giống hệt (dời nguyên khối), còn lại theo vị trí | kéo đổi thứ tự | tráo giá giữa 2 phần tử đứng yên (= đổi giá) |
| 4 | Không xoá item đang có giá trị ở ô khoá | xoá item chưa có giá | xoá item đã có giá |

Áp ở **2 chỗ**: lưu nháp (`saveDraftChecked`) và publish (`checkPublishLocks`, kiểm lại với vai trò lúc publish vì vai trò
có thể đổi giữa chừng). Vi phạm → 403 `locked_field` `{ fields: [{ path, field, label, reason, message }] }` + 1 dòng
audit `denied` (bảng `cms_audit_log`, migration 0003 — chỉ đường dẫn / nhãn / lý do, không có giá trị); nháp bị từ chối
không được ghi. Giới hạn đã biết: phần tử list **không có `id`** vừa bị dời chỗ vừa sửa trong cùng 1 lần lưu có thể bị
coi là đổi giá → lưu 2 lần (dời rồi sửa), hoặc thêm `id` cho phần tử.

## D. Hợp đồng visual editing

**Binding:** thuộc tính trong template — `data-cms-field="site.phone"`, danh sách `data-cms-list="services"` + mỗi item
`data-cms-item-index="2"`, section `data-cms-section="contact"`, link `data-cms-field-href`, ảnh `data-cms-field-alt`.
Đây là cách mặc định (quyết định 6). `bind: "<selector>"` trong config chỉ cho site cũ phải giữ HTML từng byte — bridge gắn
thuộc tính lúc chạy trong preview.

**Nạp bridge (quyết định 7):** P9 thử trước: admin mở trang trong `<iframe>` **cùng origin**, đợi `load`, tự chèn script
bridge vào `iframe.contentDocument` → HTML public không đổi byte nào. Rủi ro cần đo ở P9: trang điều hướng trong iframe
(phải chèn lại mỗi lần `load`), CSP của site chặn script chèn, trang tải lâu (bridge vào muộn). Chỉ khi cách này không đạt
mới thêm preview loader (~1 KB, không làm gì ngoài khung CMS) — **hỏi SonLe duyệt** trước khi đổi HTML public.

**Thông điệp bridge** (`postMessage` cùng origin + token preview): admin → preview: `SECTION_MAP`, `LOAD_DRAFT`,
`UPDATE_FIELD` (không bao giờ post ngược `FIELD_SELECTED`), `SCROLL_TO_FIELD` (`scrollOnly`, `itemIndex`, `section`),
`CLEAR_SELECTION`, `HIGHLIGHT_SITE`; preview → admin: `EDITOR_READY`, `FIELD_SELECTED` (chỉ khi người bấm trong
preview), `DRAFT_APPLIED`. Khung: field 2 px + chip "Section · Field", section 1 px nhạt, hover nét đứt cấp phần tử; vẽ
lại theo khung hình, không transition vị trí; không render lại preview khi gõ.

---

## E. Cài, phân phối, nâng cấp

### E.00 Lưu nháp (P3b)

KV chỉ nhất quán dần (một lần ghi có thể mất tới ~60 giây mới thấy ở vùng khác) → kiểm xung đột revision trên KV không
an toàn. **D1 là nguồn sự thật của nháp**: bảng `cms_draft_index` giữ cả nội dung (migration 0002); lưu có
`expectedRevision` là 1 câu lệnh nguyên tử (`UPDATE … WHERE revision = ?`, 0 dòng đổi = xung đột 409; tạo mới =
`INSERT … ON CONFLICT DO NOTHING`). Giới hạn D1: 2.000.000 byte / dòng, 100 KB / câu SQL (nội dung đi bằng tham số
bind, không nằm trong câu SQL), 100 tham số / câu; gói giới hạn nháp ở 1.900.000 byte (`MAX_DRAFT_BYTES`) — file nội
dung lớn nhất đã gặp ~750 KB. KV `<site>-session` chỉ còn phiên đăng nhập. `user_id` là id nội bộ (P6 cấp), không bao
giờ là email. Writer trả `rewroteWholeFile` khi phải viết lại cả file (P5 ghi audit + báo người dùng).

### E.0 Phân phối gói (GitHub Release, không token)

GitHub Packages đòi token kể cả với gói public → **không dùng**. Thay vào đó:

- Mỗi bản = 1 **GitHub Release** `vX.Y.Z` có file `vibe-cms-X.Y.Z.tgz` (kết quả `npm pack`: `dist/`, `src/routes/`,
  README, LICENSE, CHANGELOG). Workflow `.github/workflows/release.yml` chạy khi push tag `v*`: `npm ci` → `npm run check`
  → kiểm tag = `package.json` version → `npm pack` → tạo Release kèm file `.tgz` + sha256. Không tạo tag bằng tay khi
  chưa được duyệt (bản đầu tiên phát hành khi lõi đủ dùng — reviewer báo).
- Site cài bằng URL công khai, ghim đúng phiên bản:
  `"@sonle282/vibe-cms": "https://github.com/sonle282/vibe-cms/releases/download/vX.Y.Z/vibe-cms-X.Y.Z.tgz"`.
  `package-lock.json` ghi `integrity` → build lại ra đúng file đó. **Không `.npmrc`, không `NODE_AUTH_TOKEN`** ở máy dev
  lẫn Workers Builds.
- Nâng cấp: đổi URL sang bản mới (P11: lệnh `vibe-cms update [version]` đổi URL + `npm install`), đọc CHANGELOG mục "Site
  cần làm gì".

### E.1 Cài site mới (người làm: SonLe + Claude; chủ tiệm chỉ nhận tài khoản)

| # | Bước | Ai | Thời gian |
|---|---|---|---|
| 1 | Repo site: `git status` sạch, pull nhánh production; thay đổi lạ → DỪNG hỏi | Claude | 5 phút |
| 2 | Tách nội dung ra JSON (HTML public giống từng byte) | Claude | 6–16 h |
| 3 | Cài gói bằng URL release (§E.0), thêm vào `astro.config`, thêm adapter nếu site static, khai `imageService` | Claude | 1–4 h |
| 4 | `cms.config.ts` + `data-cms-*` + ô khoá; `vibe-cms check` xanh | Claude | 4–10 h |
| 5 | `vibe-cms setup --site <site>`: tạo nếu chưa có D1 `<site>-cms`, R2 `<site>-media`, KV `<site>-session`, migration, ghi binding vào `wrangler.jsonc` | SonLe chạy (Claude soạn) | 30 phút |
| 6 | GitHub: token / app **chỉ cho 1 repo** (contents RW, metadata R, checks R); `wrangler secret put CMS_GITHUB_TOKEN` | SonLe | 15 phút |
| 7 | Secret bootstrap → đăng nhập lần đầu tạo **owner** (1 lần, sau đó khoá) | SonLe | 10 phút |
| 8 | Owner tạo **editor** ở People (mật khẩu tạm, đổi lần đầu); xoá secret bootstrap | Owner | 5 phút |
| 9 | Deploy; kiểm production 1 cặp (publish → kiểm → trả lại) + editor sửa ô khoá bị từ chối | Claude + SonLe | 1–2 h |

### E.1b Bàn giao: chuyển 1 site sang account Cloudflare khác

1. Account mới: `vibe-cms setup --site <site> --account <id>` (idempotent).
2. **D1:** `wrangler d1 export <site>-cms --remote --output <site>-cms.sql` → `wrangler d1 execute <site>-cms --remote
   --file <site>-cms.sql` ở account mới; so số dòng từng bảng.
3. **R2:** chép mọi object `<site>-media` (khoá R2 chỉ đọc bên nguồn, chỉ ghi bên đích); so số object + byte + checksum mẫu.
4. **KV:** không chuyển (chỉ có phiên) — đăng nhập lại sau. Nháp nằm trong D1 nên đi theo bước 2.
5. Đặt lại secret; đổi custom domain; kiểm HTML public + 1 cặp publish; xoá tài nguyên cũ chỉ khi chủ cho phép rõ.

### E.2 Nâng cấp gói

- **Semver**: patch = sửa lỗi; minor = thêm tính năng, không đổi config / dữ liệu; major = đổi `configVersion` hoặc
  migration không tự động. CHANGELOG ghi "Site cần làm gì".
- Site ghim bản bằng URL release (§E.0); nâng từng site một, site nhỏ trước.
- Migration D1 trong gói; `vibe-cms migrate` chỉ thêm bảng / cột, không xoá dữ liệu.
- Kiểm trước khi nâng: test gói xanh; ở site `vibe-cms check` + so HTML public trước ↔ sau (local ↔ local) + 1 cặp publish.

### E.3 Binding do adapter Cloudflare tự thêm

`@astrojs/cloudflare` tự thêm vào `wrangler.json` sinh ra:
- **`SESSION` (KV)** cho Astro sessions → P6 khai rõ KV `<site>-session` trong `wrangler.jsonc` (cùng tên binding).
- **`IMAGES`** khi `imageService` mặc định (`"cloudflare-binding"`) → **không dùng**. Site khai
  `cloudflare({ imageService: "compile" })` (ảnh `astro:assets` xử lý lúc build, lúc chạy trả nguyên file) hoặc
  `"passthrough"` (không xử lý). Test của gói kiểm `wrangler.json` sinh ra **không có** `images`.

---

## F. Bảo mật

- **Repo gói công khai:** không bao giờ commit secret, `.env`, `.dev.vars`, token, thông tin riêng khách. CI quét secret
  toàn bộ lịch sử git (gitleaks) mỗi push / PR. Báo lỗi bảo mật: [SECURITY.md](../SECURITY.md).
- **GitHub (của site):** mỗi site 1 token fine-grained **chỉ cho 1 repo** (contents RW, metadata R, checks R) hoặc GitHub
  App cài riêng từng repo; không token cấp tổ chức; hết hạn tối đa 1 năm → owner thấy cảnh báo trước 14 ngày.
- **Secret:** chỉ qua `wrangler secret put`; không trong repo / `cms.config` / `/api/cms/schema`. Bootstrap xoá sau khi
  tạo owner.
- **Vai trò:** owner (mọi ô, People, publish) · editor (sửa + publish **trừ ô `locked: "owner"`**), chặn ở server.
- **Nhiều site chung 1 account Cloudflare:** API token Cloudflare không khoá được theo từng worker → 1 token deploy lộ ra
  sửa được mọi site trong account. Giảm: (1) CMS trong Worker **không dùng token Cloudflare** — chỉ binding, và binding chỉ
  trỏ tài nguyên `<site>-*` của đúng site (`vibe-cms check` kiểm); (2) deploy bằng **Workers Builds từ GitHub** (không có
  token deploy nằm ngoài); (3) token tay (setup, xuất D1) ngắn hạn, quyền tối thiểu, xoá sau khi dùng; (4) khoá R2 S3 (nếu
  cần) giới hạn theo bucket, chỉ đọc khi xuất; (5) chỉ SonLe vào dashboard; bán / bàn giao → chuyển sang account riêng.
- **Tách dữ liệu giữa site:** Worker / D1 / KV / R2 riêng; cookie phiên tên theo site (`<site>_cms_session`); không đăng
  nhập chung giữa site; repo riêng; token riêng.
- Hash mật khẩu, session version (đổi mật khẩu = đăng xuất mọi nơi), rate limit publish / đăng nhập, Origin check,
  sanitizer rich text, giới hạn kích thước file, kiểm link an toàn.

---

## F.1 Đăng nhập (P6 Bước 0 — đề xuất, chờ SonLe chọn)

> Khảo sát 2026-09-28, chỉ đọc. Chưa có code. Tài liệu Cloudflare tra cùng ngày:
> [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) ·
> [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) ·
> [Access cho workers.dev (1 click)](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) ·
> [Session](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) ·
> [Seat](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/).

### Hiện trạng: CMS đang chạy thật của site đầu tiên (tái dùng được)

| Mục | Cách làm |
|---|---|
| Loại | Tên đăng nhập + mật khẩu (chế độ `password`). Có sẵn code Cloudflare Access (chế độ `dual`: phiên mật khẩu trước, rồi JWT Access + danh sách email) nhưng production đang tắt |
| Băm | PBKDF2-SHA256, **100.000 vòng** (mức tối đa Web Crypto trên Workers), salt 16 byte, chuỗi `pbkdf2-sha256-v1$…`; so sánh thời gian hằng |
| Lưu | D1 `cms_users` (username, password_hash, role admin/editor, status, `session_version`) + `cms_auth_state` (đánh dấu bootstrap đã xong) |
| Phiên | Token ngẫu nhiên 32 byte trong cookie `HttpOnly; Secure; SameSite=Lax`; KV lưu theo sha256(token); hạn 30 ngày (cấu hình 5 phút–30 ngày); đổi mật khẩu / khoá người dùng → tăng `session_version` = đăng xuất mọi nơi |
| Chống dò | Rate limiting binding: 10 lần / phút / (username + IP); thông báo lỗi chung "Username or password is incorrect"; audit đăng nhập thành công / thất bại; production thiếu limiter → 503 |
| Quên mật khẩu | Không có tự phục vụ. Admin đặt lại (mật khẩu tạm ngẫu nhiên), người dùng đổi lần đầu. Admin quên → phải can thiệp D1 / bootstrap |
| People | Chỉ admin: xem, thêm (mật khẩu tạm), khoá / mở, đặt lại mật khẩu; không cho khoá admin cuối cùng |
| Owner đầu tiên | Secret bootstrap (username + password) → lần đăng nhập đầu tạo admin, rồi khoá bootstrap |
| CPU mỗi lần đăng nhập | PBKDF2 100k đo được **~16 ms CPU** (Node 22, i5-12400, 7 lần 15–16 ms); Workers dùng cùng họ mã hoá gốc nên cùng bậc. **Gói Workers Free: 10 ms CPU / request** (có dư một chút cho lần vượt hiếm; vượt đều → lỗi 1102). **Paid: mặc định 30 s, tối đa 5 phút.** Site đầu tiên đang ở gói nào: công cụ chỉ đọc hiện có không đọc được gói → SonLe xác nhận ở dashboard (Workers & Pages → Plans) |

### Hai phương án cho Vibe CMS

**A. Tự làm (tái dùng code site đầu tiên):** bảng `cms_users` với id nội bộ `usr_…`, mật khẩu PBKDF2, phiên trong KV
`<site>-session`, cookie `<site>_cms_session`, rate limiting binding, bootstrap owner bằng secret, People (owner thêm /
khoá / đặt lại mật khẩu editor), đổi mật khẩu.

**B. Cloudflare Access (Zero Trust) chắn `/admin` + `/api/cms`:** đăng nhập bằng email + mã một lần (OTP 6 số, hết hạn 10
phút) — hoặc tài khoản Cloudflare. Access đặt JWT vào header `Cf-Access-Jwt-Assertion`; gói kiểm chữ ký RS256 bằng JWKS
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` + `aud` (tag của Access app) + `iss` + hạn (code kiểm JWT của
site đầu tiên dùng lại được). Vai trò owner / editor lưu ở D1: email → id nội bộ `usr_…` → role. Không lưu mật khẩu.

| | A. Tự làm | B. Cloudflare Access |
|---|---|---|
| Viết + test | **18–28 h**: bảng users + migration, login / logout / me / đổi mật khẩu, People (4 thao tác), bootstrap, limiter, cookie + CSRF, identity cho API, test (kể cả local D1 + KV + limiter) | **10–16 h**: kiểm JWT (port ~150 dòng) + JWKS cache, bảng users email → id → role, People (thêm email + role, gỡ), trang "chưa được cấp quyền", tài liệu setup, test với JWKS giả |
| Bảo trì | 1–2 h / tháng / 3 site: quên mật khẩu, bị khoá, admin mất quyền → SonLe can thiệp D1 | ~0,5 h / tháng: thêm / bớt email trong policy; Cloudflare lo đăng nhập, chống dò, phiên |
| An toàn | Giữ hash mật khẩu (PBKDF2 100k — thấp hơn khuyến nghị OWASP 600k vì Workers giới hạn 100k); chống dò bằng limiter tự viết; lỗi code = lỗ hổng của mình | Không có mật khẩu để lộ; đăng nhập / chống dò / phiên do Cloudflare; gói chỉ kiểm chữ ký. Rủi ro còn lại: hộp thư email của người dùng; kiểm JWT sai (có test) |
| Chi phí | 0 đ thêm; nhưng **~16 ms CPU / lần đăng nhập > 10 ms của Workers Free** → đăng nhập có thể lỗi 1102 nếu site ở gói Free (cần Paid 5 USD / tháng / account hoặc giảm vòng băm — không nên) | Zero Trust Free: 0 đ; mỗi người đã đăng nhập chiếm 1 seat (tính chung cả account, 3 site × 2–3 người ≈ 9 seat); **số seat của gói Free: cần xác nhận trên trang giá / dashboard** (hay được ghi là 50, tài liệu tra hôm nay không nêu con số). Đăng ký Zero Trust cần nhập phương thức thanh toán dù chọn Free. Seat không tự nhả (bật hết hạn seat 1–12 tháng) |
| Trải nghiệm chủ tiệm | Nhớ mật khẩu ≥ 12 ký tự; quên → gọi SonLe; đăng nhập 1 bước; phiên 30 ngày | Không mật khẩu: nhập email → mở mail lấy mã 6 số (mất ~30 s trên điện thoại, phải chuyển app mail); phiên tới 1 tháng (cấu hình); trang đăng nhập của Cloudflare (mang tên team, không phải thương hiệu tiệm) |
| Chủ tiệm tự thêm nhân viên | **Có** (màn People, mật khẩu tạm) | **B1 (khuyên):** không — SonLe thêm email vào policy (1 phút; hoặc lệnh setup gọi API với token ngắn hạn), chủ tiệm chỉ chọn role trong CMS. **B2:** policy cho mọi email qua OTP, CMS tự chặn email không có trong D1 → chủ tiệm tự thêm, nhưng người lạ cũng lấy được mã và chiếm seat |
| SonLe làm khi cài site mới | Secret bootstrap + rate limiting binding + KV; lần đầu đăng nhập tạo owner | Bật Access cho workers.dev / domain (1 click hoặc API), policy email owner + nhân viên, chép AUD + team domain vào vars; owner được tạo sẵn trong D1 bằng lệnh setup. Domain riêng phải nằm trên Cloudflare (Innovate hiện vẫn dùng workers.dev, được) |
| Chạy local / dev | Đăng nhập thật được ở local (D1 + KV giả lập) | Không có Access ở local → dùng danh tính dev (`import.meta.env.DEV` + localhost, như P5); test bằng JWT ký bằng khoá test + JWKS giả |

### Khuyến nghị

**B1 — Cloudflare Access + vai trò trong D1**, vì: ít code phải giữ hơn (không mật khẩu, không phiên, không limiter tự
viết), an toàn hơn, không vướng giới hạn 10 ms CPU của gói Free, và mỗi tiệm chỉ 1–2 người nên việc thêm nhân viên hiếm
(SonLe làm trong 1 phút). A chỉ nên chọn nếu chủ tiệm bắt buộc phải tự thêm nhân viên mà không qua SonLe, hoặc không muốn
đăng nhập bằng mã qua email. CMS site đầu tiên giữ nguyên cách hiện tại tới P21.

Cần SonLe trả lời trước khi làm P6: (1) chọn A / B1 / B2; (2) các site đang ở Workers Free hay Paid; (3) account đã có
Zero Trust org (team domain) — dùng chung cho mọi site?; (4) số seat thực tế của gói Zero Trust đang có.

---

## G. Rủi ro chung

1. Form sinh từ schema kém hơn màn làm riêng → giữ khả năng plugin có màn riêng.
2. Site static cần thêm adapter + gộp worker riêng (vd form liên hệ) → thử trên bản preview trước.
3. Inject bridge vào iframe có thể vướng CSP / điều hướng → loader nhỏ là phương án dự phòng (cần duyệt).
4. Chạy song song CMS cũ + gói ở site cũ trong thời gian chuyển → "đóng băng tính năng" CMS cũ.
5. Writer giữ định dạng cho Markdown frontmatter khó hơn JSON → ưu tiên JSON.
6. Phụ thuộc 1 người hiểu code → tài liệu + test hợp đồng trên fixture bắt buộc từng task.
7. Publish = deploy production → kiểm production luôn theo publish → kiểm → trả lại.

---

## I. Task (1 task = 1 commit; mỗi task: REPORT → DỪNG)

Test của gói **không đọc dữ liệu site khách**. Task sửa repo site: đầu task `git status` sạch + pull nhánh production;
thay đổi lạ → DỪNG hỏi. Chi tiết riêng từng site nằm trong tài liệu private của dự án đó.

| Task | Việc | Xong khi | Cách kiểm |
|---|---|---|---|
| **P1** | Khung integration + nạp / kiểm `cms.config` + `/admin` tạm + `/api/cms/health` + demo-site + CI | demo build, `/admin` 200, health đúng | typecheck, unit, build, smoke `wrangler dev --local` |
| **P2** | Kiểm config đầy đủ + kiểm nội dung thật lúc build + workflow release + `imageService` | config / nội dung sai → build đỏ đúng chỗ, gom mọi lỗi | unit test mỗi luật ≥ 1 ca sai |
| **P3** | Store: nguồn bundled + nháp + draft index D1; writer JSON giữ định dạng (P3b: nháp chuyển hẳn sang D1) | round-trip: không sửa = giống từng byte, 1 ô = 1 dòng | test round-trip mọi kiểu field |
| **P4** | Ô khoá theo vai trò ở server (PUT + publish) + audit `denied` | editor đổi ô khoá → 403 + audit; owner được | ≥ 8 ca (object / list / collection) |
| **P5** | API chung files / collections + publish GitHub + audit + header version | demo publish qua GitHub giả lập | test hợp đồng §C + mock GitHub |
| **P6** | Auth + People (owner / editor, bootstrap, session tên theo site; KV `<site>-session`) | tạo owner bằng bootstrap, owner tạo editor | test auth + People |
| **P7** | Admin shell + danh sách + form sinh từ schema | sửa mọi field demo | test form + e2e Chrome headless |
| **P8** | Review / change summary + Save → review → Publish + trạng thái Live | luồng đủ trên demo | e2e + test change summary |
| **P9** | Bridge: inject vào iframe cùng origin (dự phòng loader), `data-cms-*` + selector, SECTION_MAP, khung 2 cấp, không render khi gõ | preview demo chọn / hover / focus đúng, HTML public không đổi | test bridge + đo khi gõ |
| **P10** | Ảnh: upload R2 staging, sheet chọn ảnh, alt | đổi ảnh demo + publish | test upload pipeline |
| **P11** | CLI `setup` (idempotent, `--account`) / `migrate` / `check` / `export` / `update` + tài liệu cài | cài demo từ đầu theo tài liệu **bằng URL release, không token**; `setup` lần 2 = không đổi gì; `update` đổi URL sang bản mới | chạy local (miniflare); xuất / nhập D1 demo khớp số dòng |
| P12–P15 | Site pilot 1: tách nội dung → JSON; adapter cho route gói; cài gói + config + ô khoá; setup + kiểm production | **P15: Workers Builds của site build xanh không có biến môi trường token nào** (gói cài từ URL release) + 1 cặp publish + **lưu và đọc lại 1 nháp > 100 KB trên D1 THẬT** | so HTML public; Workers Builds log |
| P16–P18 | Site 2: như trên | như P15 | như P15 |
| P19 | Plugin catalog + redirects-check | test plugin trên fixture catalog nhỏ | test plugin |
| P20–P22 | Site cũ chuyển sang gói (config đầy đủ → bật, HTML public giống từng byte → dọn CMS cũ) | CMS mới làm được mọi việc CMS cũ làm | so HTML + kiểm production |

---

## Phụ lục — Đã xét, không chọn

CMS có sẵn (giá tra 2026-09-28): [CloudCannon](https://cloudcannon.com/pricing/) (khoảng 55 USD/tháng, sửa trên trang),
[TinaCloud](https://tina.io/pricing) (khoảng 24 USD/site/tháng), [Keystatic](https://keystatic.com/docs/cloud) (không sửa
trên trang), [Sveltia](https://sveltiacms.app/en/docs/intro) / [Decap](https://decapcms.org/docs/intro/) (miễn phí, người
sửa cần GitHub). Không chọn: muốn tự chủ sản phẩm, dùng chung cho nhiều site và bán lại về sau. CloudCannon là mẫu tham
khảo (collections, `_inputs`, `_structures`, editable regions).
