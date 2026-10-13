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
3. **Chỉ 2 vai trò: admin, editor** (M2: tên như Mr Spa; mã lưu trong D1 của Admin vẫn là `owner`, config nhận cả `"owner"` — §H.1). Ô `locked: "owner"`: editor thấy nhưng không đổi được — **chặn ở server** (PUT nháp
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
├─ bin/vibe-cms.mjs             # `setup`, `migrate`, `check`, `export` / `import`, `update`, `reset-owner-password` (P11; mã: src/cli; không nhập / in token, secret)
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

`fixtures/demo-site/cms.config.ts` — salon bịa, dùng **mọi kiểu field** (P7 mở rộng): file `site` (SĐT, email, địa chỉ,
giờ — khoá owner; tagline; banner có richText + ảnh + alt; `highlights` = reference nhiều, có thứ tự; `footerLinks` = list
object chứa list; `seo.title` / `seo.description` = key có chấm; 3 section) + collection `services` (giá khoá owner,
select, list có thứ tự, text nhiều dòng), `team` (ảnh dạng đường dẫn và dạng `{ src, alt }`, reference 1 + nhiều),
`posts` (markdown-dir, field `status`, list, thân Markdown).

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
| `GET /drafts` | (P8) nháp của tôi: resource, nhãn, nhóm, lúc lưu, `isNew`, `stale` (nội dung đang chạy đã khác bản nháp bắt đầu) — không có nội dung | `{ drafts }` |
| `GET /media` | (P10) ảnh đã tải lên (mới nhất trước, 200 / trang, `cursor`) + ảnh có sẵn của site (`public/`, lúc build) | `{ uploads, cursor, site, uploadsEnabled, base, maxBytes }` |
| `POST /media` | (P10) 1 ảnh đã chuẩn bị (byte thô; `x-file-name`, `x-image-width` / `-height`) | 201 / 200 (cùng byte → dùng lại) `{ image }` · 413 `image_too_large` · 415 `unsupported_image` · 400 `empty_file` · 429 `too_many_uploads` · 503 `media_not_configured` |
| (sau) `/history`, `/users`, `/api/auth/*` | P6, P8 | |

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
   Đối chiếu với publisher đang chạy thật của site đầu tiên (P5b): cùng endpoint / header / base64 / `force: false`; chỉ 422
   là "nhánh đã đổi" (409 là lỗi); đọc file bằng media type raw (≤ 100 MB, giữ BOM — publisher kia đọc JSON base64 ≤ 1 MB);
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

## C.2 Admin: khung, danh sách, form sinh từ schema (P7)

- **Trang:** `/admin` (1 route, on-demand). Chưa đăng nhập → form đăng nhập; mật khẩu tạm → đổi mật khẩu; đã đăng nhập →
  trình sửa chạy trong trình duyệt (`@sonle282/vibe-cms/admin`, ~40 KB JS, không framework) nhận "boot data" = phần sửa
  được của `cms.config` (nhãn, field, section) + người đang đăng nhập — không token, không binding, không thông tin repo.
  Header: `x-frame-options: DENY`, `frame-ancestors 'none'`, `no-store`, `referrer-policy: same-origin`.
- **Điều hướng bằng hash:** `#/` tổng quan · `#/files/<key>` · `#/collections/<key>` (tìm kiếm, "Add …") ·
  `#/collections/<key>/items/<id>` · `#/collections/<key>/new`. Cột trái: mọi file + collection, người dùng, Sign out.
- **Form** sinh từ field: text (1 dòng / nhiều dòng, đếm `maxLength`), richText (trình soạn thảo trực quan từ P8d, §C.6), image (địa chỉ + alt + ảnh
  điện thoại; giữ dạng chuỗi nếu bản gốc là chuỗi và không có alt), select, hours (ngày, nghỉ, giờ mở / đóng, nhãn, thêm
  / dời / xoá hàng), object, list (thêm / dời ↑↓ nếu `ordered` / xoá, tôn trọng `min` / `max`, lồng nhau), reference (1 =
  ô chọn; nhiều = danh sách + dời nếu `ordered`), key có chấm, section. Bản ghi: ô ID (bản mới: tự điền từ tên, sửa
  được; bản đã có: khoá), `status`, thân Markdown. Form sửa một bản sao: khoá không có trong config và khoá không ai đụng
  giữ nguyên (cả thứ tự) → không sửa = giá trị y hệt.
- **Ô khoá cho editor** (server vẫn chặn, P4): ô / object / list khoá → hiện nhưng disabled + ổ khoá + "Only the owner
  can change this."; editor không xoá được phần tử list còn giữ giá trị khoá (§C.1 luật 4), vẫn dời được; bản ghi mới:
  ô khoá để trống. Owner thấy ghi chú "Editors see this but only an owner can change it."
- **Lưu nháp** (API P5): `PUT` với `expectedRevision` (0 khi chưa có nháp) + `sourceVersion` (version của bản đã mở;
  `new` cho bản ghi mới). Trước khi gửi: kiểm kiểu bằng đúng hàm của server (`checkRecordValues`) + ID hợp lệ, chưa
  trùng → lỗi hiện cạnh ô. Lỗi server: 422 / 403 `locked_field` hiện cạnh ô; 409 `draft_conflict` → "Reload"; 401 →
  đăng nhập lại. Trạng thái: "No changes" / "N unsaved changes" / "Saving…" / "Draft saved · not live yet" / "Needs
  attention". "Discard draft" (hỏi trước). Rời trang khi còn thay đổi chưa lưu → hỏi "Leave without saving?"; Ctrl / ⌘+S
  = lưu. Publish / review / Live: P8 (§C.3).

## C.3 Xem lại + Publish + Live (P8)

- **Đếm nháp:** cột trái có "Review & publish" + số nháp của tôi (`GET /drafts`).
- **Xem lại** (`#/publish`, hoặc `#/publish/<resource>` từ nút "Review & publish" của trình sửa — chỉ bật khi đã lưu
  nháp và không còn thay đổi chưa lưu): mỗi nháp 1 thẻ (tên, nhóm, lúc lưu, "Open") với **tóm tắt thay đổi** so với
  bản đang chạy, bằng nhãn của form: "Price (owner only): $35 → $40", "Featured services: added Nail Art", "Extras:
  new order — …", "New service: Gel Removal". Tóm tắt (`summarizeChanges`, thuần) so qua đúng field của trình sửa:
  object theo từng ô, ảnh tách địa chỉ / alt, giờ mở cửa thành dòng dễ đọc, reference bằng tên bản ghi; phần tử list
  khớp theo `id`, rồi theo nội dung giống hệt, còn lại ghép cặp khi còn chung ≥ 1 giá trị (không thì là xoá + thêm);
  khoá không có trong form vẫn được nêu.
- Tick nháp muốn đưa lên (mặc định: tất cả; vào từ trình sửa: chỉ nháp đó) → **"Publish N drafts"** = `POST /publish`
  = đúng 1 commit. Nháp `stale` (ai đó đã publish sau khi nháp bắt đầu) bị bỏ tick + giải thích: mở, bỏ nháp, sửa lại.
  Lỗi: 409 `source_changed` (nêu tên nháp, viền đỏ thẻ), 403 `locked_field`, 422, 429, lỗi GitHub — bằng lời thường.
  `rewroteWholeFile` → ghi chú "định dạng file không giữ được".
- **Live:** sau publish, cột trái hiện "Publishing… started HH:MM", hỏi `GET /live-version` mỗi 10 giây tới khi bằng
  `expectedLiveVersion` → "Live on the website: …"; quá 15 phút → "Still publishing … Check now". Việc đang chờ được
  nhớ trong `localStorage` của trình duyệt (chỉ version + giờ + tên), tải lại trang vẫn theo dõi tiếp.
- Test: `VIBE_GITHUB_API_URL` chỉ nhận địa chỉ của chính máy (127.0.0.1 / localhost, http) để e2e publish sang GitHub
  giả; giá trị khác bị bỏ qua → token không thể bị gửi đi nơi khác ngoài api.github.com.

## C.4 People + My account (P8b)

- **People** (`#/people`, chỉ owner thấy trong menu; editor mở thẳng địa chỉ → "Only an owner can manage people"):
  bảng người dùng (tên, username, vai trò, trạng thái, "Must choose a password", lần đăng nhập cuối). Thêm người
  (username, tên, vai trò) → **mật khẩu tạm hiện đúng 1 lần** trong khung riêng (nút Copy, "Done — hide it"; rời
  trang là mất, không lưu ở đâu). Đổi vai trò (hỏi trước), Disable (hỏi trước: đăng xuất ngay, nháp giữ nguyên) /
  Enable, Reset password (hỏi trước, hiện mật khẩu tạm mới 1 lần). Không có nút trên chính mình (không tự khoá / tự hạ
  quyền; dùng My account). Server vẫn quyết (owner only, không hạ / khoá owner hoạt động cuối) — lỗi hiện trên bảng.
- **My account** (`#/account`, bấm tên mình ở cột trái): tên, username, vai trò, lần đăng nhập cuối; **đổi mật khẩu
  của tôi** (hiện tại + mới ×2, ≥ 12 ký tự) → phiên khác bị đăng xuất, tab này vẫn đăng nhập (cookie mới). Danh tính dev
  local: không có mật khẩu để đổi.
- Mọi form `method="post"` + có `username` ẩn cho trình quản lý mật khẩu; mật khẩu không vào URL / storage / log.

## C.5 Ảnh (P10)

Cùng cách của CMS cũ (cùng đường dẫn ảnh, giữ tạm ở R2, route xem trước, đưa ảnh vào commit khi publish), khác 1 điểm:
**không dùng binding `IMAGES`** (quyết định 9) → thu nhỏ + đổi định dạng làm **trong trình duyệt**.

- **Ô ảnh:** thumbnail + địa chỉ + alt (+ ảnh cho điện thoại) như P7, thêm nút **Choose image…** (mở sheet) và **Remove**
  (xoá địa chỉ, giữ alt). Chọn xong → con trỏ nhảy vào alt nếu alt còn trống. Ô bị khoá với editor: không có nút.
- **Sheet chọn ảnh** (dialog, Esc / bấm ngoài để đóng): vùng tải lên (kéo thả hoặc chọn file), thư viện = ảnh đã tải
  lên (mới nhất trước, nhãn "Uploaded") + ảnh có sẵn trong `public/` của site (tối đa 3000, đọc lúc build, có SVG — ảnh
  của chính repo), tìm theo tên / đường dẫn. Site thiếu bucket → sheet nói rõ "Uploading is not set up", vẫn chọn được
  ảnh có sẵn.
- **Chuẩn bị ở trình duyệt:** chỉ JPEG / PNG / WebP / AVIF (SVG, GIF bị từ chối); cạnh dài ≤ 2400 px, **WebP q0.82**
  (trình duyệt không ghi được WebP → PNG / JPEG q0.86). Vẽ lại qua canvas nên mất luôn dữ liệu ẩn (GPS của máy ảnh).
- **Server không tin trình duyệt:** loại ảnh + kích thước đọc từ byte đầu file (WebP / JPEG / PNG / AVIF; GIF, SVG,
  HTML → 415); ≤ `media.maxBytes` (mặc định 10 MiB, tối đa 25 MiB); chung rate limit với publish, khoá riêng
  `cms-media:<user>`; same-origin + đăng nhập như mọi lệnh ghi.
- **Tên + chỗ giữ:** `/assets/uploads/YYYY/MM/<slug tên file>-<8 hex đầu sha256>.<ext>` (`media.dir`, mặc định
  `public/assets/uploads`). R2 `CMS_MEDIA` (= `<site>-media`): `staging/<đường dẫn>` (byte + metadata: sha256, cỡ,
  ai, lúc nào, tên gốc) và `upload-index/<sha256>` → cùng byte tải lại dùng lại đường dẫn cũ.
- **Xem trước:** route gói `<base>/[...path]` trả bản trong R2 (đúng mẫu đường dẫn, kiểm lại byte, `nosniff`, CSP
  `sandbox`, cache 60 s). Sau khi site deploy có file thật, file tĩnh trả trước, route không còn được gọi.
- **Publish:** gom mọi đường dẫn upload có trong nháp được publish (ô ảnh, richText, thân Markdown); cái nào nhánh chưa
  có (hỏi GitHub theo thư mục tháng) → thêm **byte chính xác** vào **cùng 1 commit**; không có ở R2 lẫn repo → 409
  `media_missing` + `paths`, không commit gì. Response có `media` (file ảnh đã thêm).
- **Chưa làm (để sau):** dọn `staging/` sau khi publish, đếm "đang dùng ở đâu", xoá ảnh khỏi thư viện.

## C.5b Cắt / đổi cỡ ảnh = bản sao (P12f)

Theo đáp của site đầu tiên (Discovery media adjustments): **A1** tạo bản sao, giữ ảnh gốc; **A2** preset trước (Original,
Square, Landscape 4:3, Wide 16:9, Portrait 4:5) rồi kéo vùng cắt (chuột / phím mũi tên, Shift = bước lớn), "Crop size"
20–100 %, chọn bề rộng (chỉ nhỏ hơn vùng cắt); **A5** lỗi → không tạo / không chọn gì, "Adjustment failed. Your original
image is unchanged". Làm **trong trình duyệt** (đọc ảnh cùng origin → `createImageBitmap` → canvas → WebP, tối đa 2400 px)
→ tải lên như mọi ảnh (P10: R2 staging, kiểm loại thật từ byte, publish cùng commit). Không binding `IMAGES`. Ảnh gốc không
ai dùng không vào commit.

## C.6 Trình soạn thảo trực quan (P8d)

Thay ô gõ HTML / Markdown của P7, giống CMS cũ (thanh định dạng trên vùng soạn `contenteditable`, lệnh `execCommand`
nên Ctrl+Z / Ctrl+Y vẫn chạy, dán chỉ giữ chữ), thêm phần ảnh mà CMS cũ chưa có.

- **Thanh định dạng:** đoạn, H2, H3, đậm, nghiêng, danh sách chấm / số, trích dẫn, link (ô nhập địa chỉ; chỉ nhận
  https:// · / · # · mailto: · tel:), bỏ link, ảnh; nút "Edit HTML" / "Edit Markdown" để xem / sửa mã nguồn.
- **Ảnh trong bài:** nút Image mở sheet chọn ảnh của P10 (tải lên hoặc thư viện) → chèn tại con trỏ, ảnh được chọn,
  con trỏ vào ô alt. Bấm ảnh để chọn: thanh ảnh có Alt text, Width (px), Original size, Replace…, Remove image; khung
  viền + **tay kéo ở góc**: kéo to / nhỏ (tối thiểu 40 px, tối đa bề rộng vùng soạn), phím mũi tên ±10 px (Shift ±50).
  **Tỉ lệ luôn giữ:** chỉ ghi `width`, xoá `height` (CSS `height:auto`). Delete / Backspace xoá ảnh đang chọn.
- **Giá trị:** richText vẫn là HTML; thân bài Markdown vẫn là Markdown (chuyển bằng unified: micromark / mdast / hast,
  có GFM; bộ chuyển chỉ tải khi mở bài Markdown — 184 KB riêng, admin chính 83 KB). Markdown viết lại **theo thói quen
  của bài** (dấu danh sách, `*` / `_`, `**` / `__`, đường kẻ); ảnh có cỡ ghi thành `<img src alt width>` (Markdown
  không có cỡ; Astro hiển thị HTML trong Markdown). Ô chưa sửa thì **không đổi giá trị** (đúng từng byte).
- **Bài không giữ được:** nếu Markdown → HTML → Markdown → HTML ra khác (khối HTML thô, chú thích chân trang…), bài
  mở ở chế độ Markdown kèm ghi chú, không cho chuyển sang trực quan — không âm thầm viết lại bài.
- **An toàn:** giá trị được dựng trong tài liệu "trơ" (`createHTMLDocument`: không tải, không chạy gì) và lọc bằng
  **cùng danh sách** với server (`src/check/rich-text-allow.ts`, dùng chung cho hast ở server và DOM ở trình duyệt);
  `<b>` / `<i>` → `<strong>` / `<em>`, `span` / `font` / `style` bỏ, khối lồng trong `<p>` được tách ra, `&nbsp;`
  thành dấu cách. Thả file / HTML vào vùng soạn bị chặn (ảnh chỉ qua sheet). Server vẫn lọc lại khi lưu (P8c).
- **Xem lại (P8):** dòng thay đổi của richText đọc như chữ thường (bỏ ký hiệu Markdown), và mỗi ảnh có dòng riêng:
  thêm, xoá, đổi cỡ ("438 px wide → original size"), đổi alt; chỉ đổi định dạng → "(new formatting)".

## C.7 List / collection cố định, mục chỉ owner, Activity (P12b)

- **`fixed: true` trên list:** code của site quyết định có những phần tử nào → **không ai** (kể cả owner) thêm / xoá / đổi
  chỗ; giá trị bên trong vẫn sửa được (ô khoá vẫn theo §C.1). So với nội dung nháp bắt đầu (lưu) và với nhánh (publish):
  cùng số phần tử, phần tử có `id` giữ đúng chỗ; list không cố định bên trong phần tử theo luật của nó; phần tử mới (không
  có bản trước) không bị so. Sai → 422 `fixed_list`. Form không có nút thêm / xoá / đổi chỗ và nói lý do.
- **`fixed: true` trên collection:** không tạo bản ghi mới (422 `fixed_collection`, không có nút "Add"); bản ghi có sẵn vẫn sửa.
- **`access: "owner"` trên file / collection:** editor không thấy (overview, điều hướng, nháp, cấu hình trong boot), mọi
  route của mục đó trả 403 `owner_only`; lưu / publish bị từ chối ghi 1 dòng audit `denied` (`reason: owner_only`), đọc
  thì không. Khác `locked: "owner"` (§C.1): ô khoá vẫn hiện cho editor, mờ đi. Site chọn kiểu nào bằng config.
- **Activity (owner):** `GET /api/cms/activity?kind=all|publish|signin|people|denied&before=<id>` — 50 dòng / trang, mới
  nhất trước, không có dòng `started`; kèm tên người (D1 `cms_users`) và nhãn mục (từ cms.config). Màn `#/activity` viết
  thành câu ("Published Salon info (abc1234)", "Refused to save Service · x: Price is for owners only"). Không có nội dung
  (audit không bao giờ giữ nội dung).

## C.9 Kiểu field + luật của site (P12d)

- **`f.tuple(items)`**: mảng JSON độ dài cố định, mỗi chỗ là 1 field thường (ô khoá, pattern, rich text… áp từng chỗ);
  kiểm: đúng số phần tử, từng phần tử theo field của nó. Đường dẫn `items[0][1]`.
- **Text `pattern`** (khớp cả giá trị, biểu thức chính quy Unicode) + **`patternHint`** (câu nói cho người dùng);
  **`tokens`**: chỉ các `{từ}` này được có trong chữ (code của site điền vào).
- **Rich text `allow`**: tập con danh sách thẻ chung (§F.2) — server lọc theo nó, thanh công cụ chỉ hiện nút hợp.
- **`rules` (chỗ cắm plugin):** hàm `(value, content) => [{ path, message, hint?, warning? }]` trên file / collection,
  chạy lúc build (`checkContent`), khi lưu nháp và lại khi publish (Worker). `content` đọc nội dung khác **đang live**
  (không gồm các nháp đang publish cùng). Lỗi hiện cạnh field; `warning` không chặn; hàm ném lỗi = 1 lỗi có tên, không sập.
  Hàm sống trong `cms.config.ts` → Worker nhận qua module ảo; boot của admin (JSON) không mang hàm.
- **P12g — `f.pick` + `f.toggle`:** `pick` = 1 giá trị chữ chọn trong danh sách do site tính **từ chính nội dung của bản ghi**
  (`choices: (content) => [{ value, label, group? }]`) — giá gõ 1 lần trong menu, chỗ khác trỏ tới: `{ "of": "packages/x" }`.
  Hàm chạy ở server (build, lưu, publish, view của editor → `choices` theo **chỗ**: `fromPrice.of`, `highlights[].of`
  (mọi phần tử list), `pair[1]` (chỗ của tuple)); khi lưu nháp, lựa chọn tính từ **nháp** (thêm 1 dòng menu rồi trỏ tới
  ngay được). Admin: ô chọn (nhóm theo `group`), giá trị không còn trong danh sách được giữ + ghi "(not in the list)";
  review hiện tên dòng thay vì id. `toggle` = true / false; bỏ tick 1 giá trị chưa từng có → bỏ hẳn key (JSON không đổi).
- **P16a — `f.number` + text `from`:** `number` = số JSON (`integer`, `min`, `max`; ô số; xoá trống = bỏ key). `from` = id của 1
  phần tử mới được tạo từ field cùng object khi đang gõ tên (slug, thêm `-2` nếu trùng trong list); gõ vào id thì thôi
  theo; id đã có không bao giờ đổi (giá ở chỗ khác trỏ tới nó). Tìm ra khi viết cms.config cho Innovate (P16).
- **P12h — ảnh theo tên (`media.names`):** nội dung giữ **tên** trong manifest của site (`"nails/nails-01"`), build của
  site tạo các kích thước. Admin vẫn làm việc với địa chỉ: API đổi tên → địa chỉ khi đọc (cỡ lớn nhất ≤ `width`, mẫu
  `url` = `"{path}-{width}.webp"`; ảnh upload chưa build → tìm file trong R2) và địa chỉ → tên khi lưu (mọi cỡ của 1 ảnh,
  hoặc địa chỉ upload) → nháp / publish / History / file chỉ có tên. Ảnh upload đặt tên theo chỗ commit tính từ `root`
  (`uploads/2026/10/x-1a2b3c4d`), publish commit file vào `media.dir` (được nằm ngoài public/, kèm `media.base` = địa chỉ
  phục vụ từ R2). Thư viện ảnh = manifest (bỏ `exclude`). Build + mỗi lần lưu từ chối tên không có trong manifest và
  không phải tên upload. Manifest tới Worker qua module ảo `virtual:vibe-cms/images` (`names`).

## C.8 History + Restore as draft (P12c)

- **Nguồn:** lịch sử git của nhánh production (GitHub `GET /commits?sha=<branch>&path=<file>`) → có cả các lần publish
  của CMS cũ và các lần sửa trong code, **không cần chuyển dữ liệu** khi một site bỏ CMS chép sang gói. Tối đa 20 bản.
  Bản ghi trong file JSON chung: đọc file ở từng commit, chỉ giữ commit làm **bản ghi đó** đổi (≤ 21 request GitHub).
- **Ai:** người ghi trong commit của Vibe CMS (`By: usr_… (role) via Vibe CMS` → tên trong `cms_users`), không có thì tác giả commit.
- **Compare:** giá trị ở commit ↔ bản website đang chạy, nói bằng lời như màn review (`summarizeChanges`).
- **Restore as draft:** bản cũ thành nháp của owner (`sourceVersion` = bản đang live, nên publish không bị coi là cũ); đã có
  nháp → 409 `draft_exists` + `needsConfirmation`, gửi lại `replace: true`; giống bản live → 409 `same_as_live`; không còn
  hợp `cms.config` hiện tại → 422 (kiểu field / list cố định); bản ghi không có ở commit đó → 404. Publish đi qua đủ kiểm tra như mọi nháp.
- **Quyền:** chỉ owner (như bản chép trên 2 site pilot). Không thêm hành động audit mới (bảng audit có CHECK cố định);
  việc publish sau đó được audit như thường.

## D. Hợp đồng visual editing (P9)

**Binding:** thuộc tính trong template (quyết định 6), không đổi gì với khách xem trang:

| Thuộc tính | Nghĩa |
|---|---|
| `data-cms-field="site.hero.title"` | field của file (`<key file>.<đường dẫn>`, chỉ số list viết `.0` hoặc `[0]`) |
| `data-cms-field-href` / `data-cms-field-alt` | `href` / `alt` của phần tử lấy từ field |
| `data-cms-item="services:spa-pedicure"` | một bản ghi; `data-cms-field` bên trong là field của bản ghi đó |
| `data-cms-list="services"` | nơi liệt kê bản ghi của collection (bản ghi mới hiện ở đây, là bản sao bản ghi đầu) |
| `data-cms-list="site.footerLinks"` + item `data-cms-item-index="0"` | một field list; field bên trong item tính từ item; list lồng nhau được |
| `data-cms-section="contact"` | phần tử của một section trong `cms.config` (khung 1 px) |

`bind: "<selector>"` trong config cho site cũ phải giữ HTML từng byte: lúc preview, bridge gắn `data-cms-field` vào
phần tử khớp selector (field của file, mọi độ sâu ngoài list).

**Nạp bridge (quyết định 7) — làm ở P9, có chỉnh:** admin mở trang trong `<iframe>` **cùng origin**
(`?cmsPreview=1`, `sandbox="allow-same-origin allow-scripts"`: trang không điều hướng được admin, không mở pop-up,
không gửi form) và **bridge chạy trong JS của admin, thao tác thẳng trên `iframe.contentDocument`**, gắn lại sau mỗi
lần `load`. **Không chèn script vào trang, không `postMessage`** → HTML public không đổi byte nào, CSP của site không
chặn được, không có kênh tin nhắn nào để giả mạo (nên không cần token preview). Cần ở site: cho chính site nhúng trang
của nó (`X-Frame-Options: SAMEORIGIN` hoặc `frame-ancestors 'self'`; không đặt `DENY`) — không được thì pane nói rõ.
Không cần preview loader.

**Việc của bridge** (thay các thông điệp cũ bằng lời gọi hàm): `LOAD_DRAFT` = áp nháp khi gắn; `UPDATE_FIELD` = khi
form đổi, chỉ cập nhật phần tử của field đó (text, richText đã lọc — Markdown chuyển sang HTML, ảnh `src` / `alt`,
link an toàn, reference ra tên, list chữ, giờ mở cửa; item list thêm = bản sao item đầu, bớt = ẩn); `SECTION_MAP` =
`cms.config` sections; `SCROLL_TO_FIELD` = focus field trong form → cuộn + khung (không báo ngược); `FIELD_SELECTED`
= chỉ khi người bấm trong preview → form focus field đó (bấm vào nội dung của bản ghi / file khác → mở bản ghi đó, đúng
field); `CLEAR_SELECTION` = Esc. Link sang site khác và form không chạy trong preview. Khung: field chọn 2 px + chip
"Section · Field", section 1 px nhạt, hover nét đứt; vẽ bằng CSSOM (`element.style`, không thuộc tính `style` → CSP
không chặn), theo khung hình. **Không render lại preview khi gõ**; e2e đo: mỗi phím < 16 ms, trang không tải lại.

**Pane:** cạnh form (cửa sổ ≥ 1 200 px mở sẵn; nút Preview bật / tắt, nhớ lựa chọn), Desktop / Phone (390 px), Reload,
Open live page; trang chỉ tải khi pane được mở lần đầu. Bản ghi mới có trang riêng (`/blog/{slug}/`) → "có trang khi
được publish"; bản ghi mới của collection liệt kê trên 1 trang → hiện ngay trong list.

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
| 6 | GitHub: token / app **chỉ cho 1 repo** (contents RW, metadata R, checks R); `wrangler secret put VIBE_GITHUB_TOKEN` | SonLe | 15 phút |
| 7 | Secret bootstrap → đăng nhập lần đầu tạo **owner** (1 lần, sau đó khoá) | SonLe | 10 phút |
| 8 | Owner tạo **editor** ở People (mật khẩu tạm, đổi lần đầu); xoá secret bootstrap | Owner | 5 phút |
| 9 | Deploy; kiểm production 1 cặp (publish → kiểm → trả lại) + editor sửa ô khoá bị từ chối | Claude + SonLe | 1–2 h |

### E.1b Bàn giao: chuyển 1 site sang account Cloudflare khác

1. Account cũ: `vibe-cms export --out backup` (P11: chỉ dòng dữ liệu của các bảng `cms_*` + file đếm số dòng / migration;
   D1 không trả lời truy vấn trong lúc xuất). Làm trước bước 2 vì id trong `wrangler.jsonc` theo account `setup` chạy sau cùng.
2. Account mới: `vibe-cms setup --site <site> --account <id>` (idempotent; tạo tài nguyên + migration, id đổi theo) →
   `vibe-cms import --file backup/<site>-cms.sql --account <id>`: chỉ nhập vào D1 rỗng có cùng migration, rồi so số dòng
   từng bảng với file đếm.
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

## F.2 Lọc HTML của richText (P8c)

- **Ở đâu:** server, khi lưu nháp (`PUT`) và lại lần nữa khi publish (nháp lưu trước P8c / client khác); cảnh báo lúc
  build (`checkContent`) cho HTML có sẵn trong file mà CMS sẽ lọc khi có người sửa ô đó — build không dừng.
- **Bằng gì:** `hast-util-from-html` + `hast-util-sanitize` + `hast-util-to-html` (parser HTML thật, không cần DOM,
  chạy trong Worker) — **cùng thư viện và cùng danh sách** với CMS đang chạy của site đầu tiên (P21 chuyển sang không
  đổi kết quả). Giữ: a, blockquote, br, code, div, em, figcaption, figure, h2, h3, hr, img, li, ol, p, pre, strong, u,
  ul; thuộc tính `class`, `title`, a: `href` `rel` `target`, img: `alt` `height` `loading` `src` `width`; link chỉ
  http / https / mailto / tel / đường dẫn tương đối, ảnh http / https / tương đối. Bỏ cả nội dung: script, style,
  noscript, iframe, object, embed, form. Thẻ lạ: bỏ thẻ, giữ chữ. Mọi thuộc tính khác (onclick, style, srcdoc, id…)
  và link `javascript:` / `vbscript:` / `data:` bị bỏ. Tối đa 250.000 ký tự / ô (422).
- **Chỉ lọc cái người dùng gõ:** giá trị đã có y hệt trong file của site (bản nháp bắt đầu từ đó) không bị đụng → đổi
  ô khác không làm file đổi theo. Giá trị người dùng đổi luôn được lưu ở dạng parser viết lại (không giữ nguyên văn "vì
  trông sạch": thẻ chưa đóng ở cuối như `<img src=x onerror=…` bị parser bỏ nhưng sẽ thành thẻ thật khi nằm cạnh HTML
  của trang). Thân Markdown chỉ bị viết lại khi thật sự có thứ nguy hiểm bị bỏ (dạng chuẩn thoát `<` `&`, làm hỏng ví
  dụ code).
- **Người dùng thấy gì:** lưu xong, form hiện đúng bản đã lọc + "Saved, with some HTML removed for safety: Banner
  (hero.text) — <script>, a[href=javascript:]"; publish lọc thêm thì màn Published ghi "Safety note"; audit ghi đường
  dẫn ô bị lọc (không ghi nội dung).
- Chưa làm: link `javascript:` viết bằng cú pháp Markdown `[x](javascript:…)` trong thân bài — phụ thuộc cách site
  render Markdown; ghi ở mục rủi ro.

## F.1 Đăng nhập + People (P6)

**Quyết định (SonLe, 2026-09-28): phương án A — giống CMS đang chạy thật của site đầu tiên, dùng chung cho mọi dự án.
Không dùng Cloudflare Access; chế độ "dual" / Access của CMS cũ không đưa vào lõi.** (Phương án B — Cloudflare Access +
vai trò D1 — đã xét ở P6 Bước 0, không chọn.)

### Cơ chế (giữ nguyên như CMS cũ)

| Mục | Cách làm |
|---|---|
| Đăng nhập | Username (3–32 ký tự `a-z 0-9 . _ -`, không phân biệt hoa thường) + mật khẩu (**12–200 ký tự**) |
| Băm | PBKDF2-SHA256, **100.000 vòng** (tối đa của Web Crypto trên Workers), salt 16 byte, `pbkdf2-sha256-v1$100000$<salt>$<digest>`, so sánh thời gian hằng; hash dưới 100.000 vòng bị từ chối |
| Phiên | Token 32 byte ngẫu nhiên trong cookie `vibe_cms_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`), KV `SESSION` (= `<site>-session`) lưu dưới `cms:auth:session:<sha256(token)>`; hạn **30 ngày** (`CMS_SESSION_TTL_SECONDS` 300 … 2.592.000) |
| Đăng xuất mọi nơi | `session_version` tăng khi đổi mật khẩu, đặt lại mật khẩu, khoá → mọi phiên cũ trả 401 |
| Vai trò | Đọc lại từ D1 **mỗi request** → khoá / đổi vai trò có hiệu lực ngay |
| Chống dò | Rate limit binding `CMS_LOGIN_LIMITER` 10 / 60 s theo (username + IP), và theo người dùng khi đổi mật khẩu (kiểm mật khẩu hiện tại — P6b); publish `CMS_PUBLISH_LIMITER` 20 / 60 s theo người dùng; **bản build production thiếu limiter → 503**; lỗi đăng nhập luôn một câu "Username or password is incorrect."; audit `login` / `login_failed` |
| Owner đầu tiên | Secret `CMS_BOOTSTRAP_USERNAME` + `CMS_BOOTSTRAP_PASSWORD` (so mật khẩu thời gian hằng): lần đăng nhập đầu khi chưa có ai → tạo owner, đánh dấu `bootstrap_completed` (dùng 1 lần, kể cả khi bảng users bị xoá sau đó) |
| Owner quên mật khẩu | P11: `npx vibe-cms reset-owner-password [--username]` — mật khẩu tạm 20 ký tự in 1 lần, phải đổi khi đăng nhập, `session_version` + 1 (đăng xuất mọi nơi), audit `user_password_reset` (`{"by":"cli"}`); không sửa D1 bằng tay; owner bị khoá → từ chối |
| Danh tính dev | Giữ như P5: chỉ `import.meta.env.DEV` + localhost + `VIBE_CMS_DEV_USER` |

### Bảng users: CMS cũ → Vibe (migration 0004, `cms_users`)

| CMS cũ (`cms_users`) | Vibe (`cms_users`) | Ghi chú khi chuyển (P21) |
|---|---|---|
| `id INTEGER` | `id TEXT` = `usr_` + 16 ký tự ngẫu nhiên; id cũ → `legacy_id` | Nháp / audit / commit dùng id nội bộ dạng chữ |
| `username` (NOCASE, UNIQUE) | `username` (NOCASE, UNIQUE), lưu chữ thường | Giữ nguyên |
| — | `display_name` | = username khi chuyển |
| `password_hash` | `password_hash` — **cùng định dạng, cùng hàm kiểm** | **Không phải đặt lại mật khẩu** (có test với hash tạo đúng bằng code cũ) |
| `role` admin / editor | `role` owner / editor | admin → owner |
| `status` active / disabled | `status` active / disabled | Giữ nguyên |
| — | `must_change_password` 0 / 1 | = 0 khi chuyển |
| `session_version` | `session_version` | Giữ nguyên (phiên KV cũ không chuyển → đăng nhập lại 1 lần) |
| `created_at`, `updated_at`, `last_login_at`, `password_changed_at` | cùng tên | Giữ nguyên |
| `cms_auth_state` (key, value, updated_at) | `cms_auth_state` cùng cấu trúc | |

Hàm `userFromLegacyRow()` + `insertUser()` trong gói làm việc chuyển; P12e: lệnh `vibe-cms import-legacy-users --from <D1 cũ>`
(đọc `cms_users` + `cms_auth_state` cũ: `password_reset_required:<id>` → `must_change_password`, có owner → đánh dấu
`bootstrap_completed`; 1 dòng audit / người; đích phải rỗng; `--dry-run`). ⚠ Tên bảng trùng với CMS cũ: P21 phải dùng **D1
mới** cho gói rồi nhập users sang (không chạy migration của gói lên D1 cũ).

### Route

| Method | Đường dẫn | Quyền | Trả về / mã lỗi |
|---|---|---|---|
| POST | `/api/auth/login` `{ username, password }` | ai cũng gọi | 200 + cookie `{ user, mustChangePassword }` · 400 `bad_json` · 401 `invalid_credentials` · 403 `origin_forbidden` · 429 `too_many_attempts` (retry-after 60) · 503 `auth_not_configured` / `login_limiter_missing` / `limiter_unavailable` |
| POST | `/api/auth/logout` | có phiên hoặc không | 200, cookie xoá · 403 `origin_forbidden` |
| GET | `/api/auth/me` | có phiên | 200 `{ user, mustChangePassword, expiresAt }` · 401 `unauthenticated` · 503 |
| PUT | `/api/auth/password` `{ currentPassword, newPassword }` | có phiên | 200 + cookie mới (phiên cũ chết) · 400 `wrong_current_password` / `same_password` / `invalid_password` · 401 · 403 `origin_forbidden` · 429 `too_many_attempts` (10 lần / phút / người dùng) |
| GET | `/api/cms/users` | owner | 200 `{ users }` · 403 `owner_only` |
| POST | `/api/cms/users` `{ username, displayName?, role, password? }` | owner | 201 `{ user, temporaryPassword? }` (tạo sẵn 20 ký tự nếu không gửi) · 400 `invalid_username` / `invalid_role` / `invalid_password` / `invalid_display_name` · 409 `username_taken` |
| PATCH | `/api/cms/users/:id` `{ action: disable \| enable \| reset-password \| set-role, … }` | owner | 200 · 400 `cannot_disable_self` / `last_owner` / `invalid_role` / `unsupported_action` · 404 |
| (mọi route `/api/cms/*`) | | có phiên | 401 `unauthenticated` · 403 `password_change_required` (mật khẩu tạm chưa đổi) · 429 `too_many_publishes` · 503 `publish_limiter_missing` |

Người được tạo / được đặt lại mật khẩu (và owner từ bootstrap) phải đổi mật khẩu ở lần đăng nhập đầu. Mọi form của
`/admin` có `method="post"` (JS chưa chạy thì mật khẩu cũng không vào URL / log); mật khẩu tạm 20 ký tự rút đều (không lệch). Mọi thay đổi
People / đăng nhập ghi audit (`stage` auth / people, migration 0005) — không bao giờ ghi mật khẩu, hash hay token.

### Khác CMS cũ (có chủ đích)

1. Id nội bộ dạng chữ `usr_…` (P3–P5) thay id số; vai trò owner thay admin; thêm `display_name`, `must_change_password`,
   `legacy_id`.
2. **Bắt đổi mật khẩu tạm** ở lần đăng nhập đầu (CMS cũ không chặn ở server), áp cả owner từ bootstrap.
3. **Đổi vai trò** trong People (CMS cũ không có); không hạ quyền owner cuối cùng.
4. Đăng nhập với username không tồn tại vẫn tốn đúng 1 lần băm (hash mồi) → không lộ "username có tồn tại" qua thời gian;
   audit không lưu username gõ sai.
5. Mật khẩu tạm có thể do server tạo (20 ký tự, bỏ ký tự dễ nhầm), trả về đúng 1 lần.
6. Cookie tên chung `vibe_cms_session` (mỗi site một domain nên không lẫn); CMS cũ có tên riêng.
7. "Production" = bản build (`import.meta.env.DEV` false) thay cho biến `ENVIRONMENT`.

### CPU mỗi lần đăng nhập

PBKDF2 100k: **~16 ms** CPU trong Node 22; **~42–44 ms** trong workerd local (`wrangler dev --local`, đo bằng endpoint
chỉ băm trừ endpoint rỗng, 3 lần chạy, máy i5-12400). Cả hai đều vượt **10 ms của Workers Free**
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), tra 2026-09-28; Paid mặc định 30 s) →
site dùng gói nên ở **Workers Paid**, hoặc chấp nhận rủi ro lỗi 1102 lúc đăng nhập trên Free (Free cho vượt thỉnh
thoảng, vượt đều thì bị chặn).

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

## H. Admin giống hệt CMS tham chiếu + sản phẩm chung (M0–M15, chốt 2026-10-12)

**Yêu cầu (SonLe, 2026-10-12):** đóng gói UI/UX của CMS Mr Spa **y chang, không chế thêm**; rồi tối ưu thành phần chung để
mọi site dùng cùng một admin, tuỳ biến theo web của họ bằng vài bước đơn giản (mẫu tham khảo: CloudCannon). Nguồn sự
thật: code + ảnh chụp CMS Mr Spa chạy local (2026-10-12; kiểm kê chi tiết trong tài liệu private của Mr Spa).

**Tiêu chuẩn "y chang":** Mr Spa chạy trên gói (P20–P21) phải trông và làm việc **giống CMS hiện tại của nó từng màn
hình** (cùng chữ, bố cục, thứ tự, trạng thái); kiểm bằng ảnh chụp đặt cạnh nhau. Chữ trên giao diện lấy nguyên văn; chỗ
nào là tên / host của site thì lấy từ config.

### H.1 Quyết định (SonLe trả lời phỏng vấn 2026-10-12)

1. **Giữ 4 thứ gói có mà Mr Spa không có:**
   - ô khoá cho admin (`locked` / `access`);
   - publish nhiều nháp một lần (Review & publish);
   - preview cho bản ghi collection;
   - bắt tự đặt mật khẩu khi đăng nhập bằng mật khẩu tạm.

   **Bỏ mọi thứ khác gói tự chế:**
   - nút bật / tắt Preview, Ctrl+S, link "Skip to content";
   - dòng trạng thái dưới top bar, thanh trạng thái trên canvas preview;
   - toast khi lưu / huỷ / publish;
   - bộ đếm ký tự ở mọi ô;
   - ô địa chỉ / alt / ảnh điện thoại dưới thẻ ảnh;
   - cột ID và các ô ID / Status / Text tự thêm vào bản ghi;
   - Crop trong sheet ảnh, preset Wide;
   - màn History riêng (→ hộp thoại), màn My account (→ hộp thoại Change password);
   - đổi vai trò bằng ô chọn, ô Name (optional);
   - lọc People / Refused và "Show older" ở Activity;
   - pill "Draft saved" thay "Live", câu dẫn đầu form, bấm nội dung bản ghi khác trong preview để chuyển trang.

   Các kiểu field mà site thật cần (giờ mở cửa, số, pick, toggle, tuple, reference) **giữ**, vẽ lại theo ngôn ngữ của
   Mr Spa. Những gì SonLe đã yêu cầu riêng trước đây (P8d: kéo đổi cỡ ảnh trong bài) giữ.
2. **Vai trò = Admin / Editor** (như Mr Spa).
   - Config nhận `access: "admin"` / `locked: "admin"`; `"owner"` vẫn chạy và có **một** cảnh báo đổi tên.
   - **Sửa lúc làm M2 (2026-10-12, review sản phẩm):** D1 **không** migrate. `cms_users.role` có `CHECK (role IN
     ('owner','editor'))` → đổi mã phải dựng lại bảng trên D1 đang chạy (Novelle, sau là Innovate) mà người dùng không
     thấy mã này. Mã lưu của vai trò Admin giữ là `owner`; mọi chữ trên màn hình là Admin; API People nhận `"admin"`.
     Đổi mã sau này vẫn làm được bằng một migration riêng nếu cần.
   - CLI có `reset-admin-password`; `reset-owner-password` là bí danh.
3. **Lõi chung + plugin.**
   - Lõi có các khối dùng chung: Link, Phone, Menu nhiều cấp, Price, danh sách có thứ tự + panel, bố cục Record /
     Document / SEO.
   - Logic chỉ một site cần nằm trong plugin ở repo của site: giá "Call for price", Categories "On the Products page",
     menu dropdown riêng, chuyển blog cũ…
   - Plugin admin = module trình duyệt khai trong config, được bundle vào `/admin`.
4. **Dev / agency cài và cấu hình**; chủ site chỉ sửa nội dung. Có thêm `vibe-cms init` để sinh nháp `cms.config.ts` từ
   các file JSON của site.

### H.2 Mô hình chung: mỗi màn của Mr Spa → một khai báo trong config

| Mr Spa | Khai báo chung trong `cms.config.ts` |
|---|---|
| Rail: Pages · Products · Projects · Blog · Media · Drafts · (Users) | Pages = mọi `files`; mỗi collection 1 mục (`icon`, `label`); collection có `under: "<collection>"` thành **tab** của mục cha (Products › Categories / Collections) |
| Pages: "Main pages" / "Across the whole site" / "Policies" | `group` của file (mặc định "Main pages"); `area: true` = khu vực toàn site (vào nhóm "Across the whole site", có `description`) |
| Sửa trang 2 cấp (section theo thứ tự trên trang) | `sections` như hiện nay; thứ tự lấy theo vị trí trên preview, không theo config |
| Header / Footer / Popup xem trên Homepage | `area: true` + `previewOn: "<file>"` |
| Search & sharing (Google + thẻ chia sẻ) | `layout: "seo"` (các field `siteName`, `title`, `description`, `image` ánh xạ bằng `seo: { … }`) |
| Product / Project: mục lục + form + cột phải | collection `layout: "record"` (mặc định); "Ready to publish" = field bắt buộc + `ready` của site; Hide = field trạng thái `status: { field, live, draft, archived }` |
| Blog: giấy + thanh định dạng; Policy: chữ thuần | `layout: "document"` (`body`, `cover`, `title`), `plain: true` cho policy |
| Danh sách: cột, lọc, ⋯ | `list: { columns, filters, search }`; nhãn nút `labels: { add: "Add product" }` |
| Thiết bị Laptop / Tablet / Mobile | cố định 1280 × 800 / 768 × 1024 / 390 × 844 |
| "Live on {host}", "5–10 minutes" | `site.host` + `publish.typicalMinutes` |
| Link Page / Web address / Phone / Email | `f.link()`; danh sách trang = file có `preview` + route của collection |
| SĐT "(215) 772-1111" | `f.phone()` + `site.phone: { country: "US" }` |
| Ảnh Desktop / Mobile 1 thẻ | `f.image({ mobile: "mobileImage" })` |

### H.3 Đặc tả UI (nguyên văn Mr Spa; `{…}` = lấy từ config)

**Khung**
- `/admin` mở thẳng trang đầu (`/admin/pages/<file>`). URL theo đường dẫn, như Mr Spa:
  - `/admin/pages/<file>`
  - `/admin/catalog/<collection>[/<id>|/new]`
  - `/admin/website/<area>`
  - `/admin/media`, `/admin/drafts`, `/admin/users`, `/admin/audit`
  - URL `#/…` cũ chuyển sang URL mới.
- Rail:
  - Ô logo = chữ đầu tên site.
  - Badge đỏ ở Drafts ("Drafts, N saved").
  - Dưới cùng: **Users** (chỉ admin), rồi avatar = 2 chữ đầu username. Menu avatar: tên, vai trò, **Change password**,
    **Sign out**.
  - Tooltip JS 400 ms, hiện ngay khi focus.
- Top bar:
  - Breadcrumb "Pages / Homepage"; mục cha là nút "Back to Pages", có hỏi trước khi bỏ thay đổi chưa lưu.
  - Chip trạng thái:

    | Trạng thái | Chấm | Chữ |
    |---|---|---|
    | none | xám | "No changes" |
    | unsaved | cam | "N unsaved changes" |
    | saved | xanh dương | "Draft saved · not live yet" / "Draft saved · changes not live yet" |
    | published | xanh lá | "Publishing… this usually takes {5–10} minutes · 1m 5s" → "Live on {host}" |
    | problem | đỏ | lỗi |

    Có nhãn ngắn khi top bar < 720 px.
  - Nút icon: View live · Version history (mọi vai trò) · Discard draft · Reload and keep my changes · Check again. Gập
    vào ⋯ khi top bar < 900 px.
  - Save draft hiện khi có bản ghi sửa được; tooltip giải thích vì sao bị tắt.
  - **Publish luôn hiện khi mở bản ghi**, tắt kèm lý do: 10 lý do theo thứ tự của Mr Spa ("Save a draft before
    publishing."…).
- Toast: tối, giữa đáy, 4 s, tối đa 1 hành động (Undo), không icon. Chỉ dùng cho ảnh / media.

**Sửa trang (inspector 360 bên phải)**
- **Cấp 1:**
  - Crumb "Pages", tiêu đề = tên trang.
  - Tip ẩn được: "Click any part of the page, or pick a section below."
  - Hàng section: tên, 1 dòng tóm tắt (tiêu đề → chữ đầu tiên → "2 banners" → "N editable fields"), chấm cam nếu chưa
    lưu, "›".
  - Trang 1 section mở thẳng cấp 2.
- **Cấp 2:**
  - Nút ← ("Close section"), crumb = tên trang, tiêu đề = tên section.
  - Esc về cấp 1 (trừ khi đang gõ); trượt 220 ms; nhớ section đang mở.
- Field:
  - Nhãn là nút có chấm xám, help **ở dưới nhãn, trên ô nhập**.
  - Lỗi đỏ dưới ô; hộp "N validation errors" ở đầu, bấm để nhảy tới ô.
  - Ô `*Href`: "Link destination: not visible in the preview."
- List:
  - "N of M allowed."; thẻ "Banner 1" + tóm tắt hoặc "Untitled"; nút ↑ ↓ ×.
  - Xoá phải xác nhận ("Delete banner 2?").
  - Thẻ đang chọn đi theo preview.
  - Ghi chú preview khi list không dựng lại được trên trang.
  - "Add banner".
- Preview:
  - Viền chọn 2 px + chip "Section · Field": đặt trên viền nếu còn chỗ, không thì nằm trong.
  - Viền section 1 px; hover nét đứt.
  - Khu vực site: viền teal 3 px.
  - Chọn section ở cấp 1 → chỉ viền section + tên.
  - Chỉ cuộn khi ô nằm ngoài màn hình, chớp 1 lần (không chớp khi reduced motion).

**Field Link:**
- Chọn Page · Web address · Phone · Email.
- Có ô "Find a page" khi có hơn 8 trang.
- Dòng "Opens: {host}/about" / "call …" / "email …" / "nothing (no link)".
- Lỗi bằng lời thường; khi link sai: "Opens: … — until this is fixed" và tắt Save.

**Ảnh**
- Thẻ ảnh:
  - Ảnh `contain` trên nền `#F5F5F7`.
  - Hover: Replace · Adjust (ảnh tải lên) · "or drop an image here".
  - **Thả file lên thẻ = tải lên** ("Uploading… N%").
  - Dòng meta: tên cắt giữa · W × H · KB · Replace.
  - ⋯: Set as main · Copy image link · Remove image (không có Remove khi ảnh bắt buộc).
  - Desktop | Mobile ("No mobile image — the desktop image is used").
  - Ô trống: nút nét đứt "Choose image".
- Sheet chọn ảnh:
  - Đầu sheet: dòng ngữ cảnh "Homepage › Showroom", "Choose image for {slot}", gợi ý.
  - Thanh: Library | Upload, tìm "Search by file name, page or product", số ảnh.
  - Chip: All · {nhóm theo config} · Site | Not used · Not published yet.
  - Lưới 5 cột, "Current" đứng đầu, "Load more" 40 ảnh một lần.
  - Chân: "file · 1440 × 990 · 184 KB" / "No image selected" · Cancel · Use image.
  - Sau khi dùng: toast "Image replaced" / "Image added" + Undo.
- Adjust:
  - "Create a new copy for this image area…".
  - Shape: Original / Square / Landscape / Portrait; bấm để đặt điểm lấy nét + 2 thanh trượt.
  - Nút "Create adjusted copy". Bản gốc giữ nguyên (P12f giữ cơ chế, đổi giao diện).

**Lưu / Publish**
- Lưu luôn bằng tay.
- Bản khôi phục cục bộ: lưu 400 ms sau lần gõ cuối, hết hạn sau 24 h. Mở lại → hỏi "Restore unsaved changes?" /
  "Restore changes" / "Discard them".
- Publish = 2 hộp thoại:
  1. **"Review changes"**: "Review the changes to {name} before publishing.", nhóm theo section, "Changed: / Added: /
     Removed:", cũ → mới, chữ đổi được `<mark>`, ảnh thu nhỏ 40 × 28; "Cancel" / "Continue to publish".
  2. **"Publish {name}"**: "This will publish to {host}."; "Cancel" / "Publish".
- Sau publish:
  - Theo dõi live ở 0 / 10 / 20 / 30 / 45 s rồi mỗi 60 s, tối đa 20 phút; vẫn theo khi chuyển màn.
  - Biên nhận lưu localStorage để theo tiếp sau khi tải lại trang.
  - Live → tải lại bản ghi lặng lẽ.
  - "The website build failed for this publish (commit …)" khi có `publish.buildCheck`.
- Rời trang: "Leave without saving?" / "Keep editing" / "Discard changes".
- Huỷ: "Discard your draft?" / "Discard unsaved changes?"; bản ghi mới: "Discard this new {item}?…".
- Xung đột 409: "Reload and keep my changes".

**Màn hình**
- **Pages:**
  - 2 cột ("Main pages" | "Across the whole site" + nhóm khác), 1 cột khi ≤ 1100 px.
  - Hàng: ô icon, tên, đường dẫn / mô tả, pill **Live** / **Off**, ghi chú cam "Unpublished changes", "›".
  - Đếm "N pages · M site-wide areas"; trống: "No page matches that name.".
- **Danh sách collection:**
  - Tab nếu có `under`.
  - Tìm kiếm, ô chọn / nút phân đoạn lọc, đếm "83 products" / "12 of 83 products".
  - Cột theo config (ảnh 44 px); trạng thái Live / Draft / Archived + "Unpublished changes".
  - ⋯ Edit · Duplicate · View on website.
  - Trống: "No products match these filters." / "No products yet.".
- **Record:**
  - Mục lục 168 px, form ≤ 680 px, cột phải 300 px. Dưới 1240 px mục lục thành hàng; dưới 1024 px cột phải xuống dưới.
  - "* Required before you can publish".
  - Cột phải: "On the website" (pill, link, lời ghi chú), "Ready to publish" / "Before you publish · N to do", Duplicate,
    Hide from website / Show on website again.
  - Bản ghi có preview (giữ theo H.1) dùng khung sửa trang.
- **Document:**
  - Giấy 760 px + cột 340 px.
  - Thanh: Paragraph · Heading 2 · Heading 3 · B · I · Bulleted list · Numbered list · Add link · Insert image. Nút
    khác chỉ hiện khi `allow` của field cần.
  - Hộp Add link: "Choose a page" / "Or enter a secure HTTPS URL".
- **Media:**
  - Chip như sheet + Archived.
  - Chi tiết 360 px mở khi bấm (×, Esc):
    - Rename · Copy link · Adjust.
    - Dimensions / Format / File size / Added.
    - **Used on**: bấm để mở đúng ô.
    - Remove image (chỉ ảnh tải lên chưa publish, không dùng), Archive / Unarchive.
  - ⋯ "Remove unused images…" (ảnh tải lên chưa publish, > 30 ngày, không dùng).
- **Drafts:**
  - Thẻ: loại, tên, "N changes: …", "Saved …", pill Live + "Unpublished changes" / Draft + "Not on the website yet".
  - Nút "See changes" (hộp chỉ đọc "Changes in this draft") · Open · ⋯ Discard draft. Publish nhiều nháp giữ (H.1).
  - "Recently published" (admin): mã commit 7 ký tự.
- **People & activity:**
  - People:
    - Bảng Person · Role (chữ) · Status · Last sign-in ("Not yet") · ⋯ (Reset password = hộp admin gõ mật khẩu mới ·
      Disable / Enable).
    - "N users." + Refresh.
    - Panel "Add a person": Username ("e.g. lan.showroom"), Temporary password điền sẵn sửa được + Copy, thẻ vai trò
      Editor / Admin, "Create account".
  - Activity:
    - Lọc All · Publishing · Sign-ins · Failed; "From the last N events." + Refresh, 100 dòng.
    - Cột Date · Person · What happened · Change · Result.
- **Version history = hộp thoại** (mọi vai trò):
  - "Published versions for this resource. Choosing Restore creates a draft only.", 10 bản.
  - Mỗi bản: "Restore as draft"; chỉ hỏi khi đã có nháp ("Replace current draft").
- **Đăng nhập:**
  - "Sign in to {name}" / "Edit the website at {host}".
  - Khi gửi: "Signing in…"; lỗi nằm trên nút.
  - "Forgot your password? Ask an admin to reset it."
  - Change password: "Use 12–200 characters. Your current CMS session will stay active after saving."
- **Màn nhỏ ≤ 900 px:** "Open on a laptop"; không che trang đăng nhập.

### H.4 Thứ tự làm — 3 track (review sản phẩm 2026-10-12, NL-DECISION-VIBECMS-001)

**Vì sao đổi thứ tự.** Làm M1→M15 tuần tự (~170–250 giờ) thì không site nào nhận được gì cho tới cuối, trong khi vẫn
phải giữ 2 CMS chép tay (Mr Spa gốc + bản của Innovate): mỗi lỗi sửa 2 nơi. Innovate và Novelle **không có collection
nào** — họ chỉ dùng phần lõi của Mr Spa (sửa trang theo section, Link, ảnh, SEO, lưu / publish, Media, Users). Sản
phẩm, blog, danh mục, menu nhiều cấp chỉ Mr Spa cần. Trong 12 tháng tới gói phục vụ các site hiện có **và khách salon
của Mr Spa** (SonLe 2026-10-12); site thứ 4 đã có: **Modern Nails Lounge** (đang live, chưa có CMS, nội dung trong
`src/data/*.ts`) — khách đầu tiên cài mới hoàn toàn, đúng bài kiểm tra "cắm vào web nào cũng được".

| Track | Task | Kết quả | Release |
|---|---|---|---|
| **A — lõi chung → Innovate** | M2, M3, **M3b**, M4, M5, M6 → M7, M11, M12 | Innovate chuyển sang gói (P17), gỡ bản chép (P18) — **bản chép đầu tiên biến mất** | v0.22.0 sau M6 (+ Novelle); v0.23.0 sau M12 |
| **C — cài mới → Modern** | M15 (`vibe-cms init`) → P23–P25 | Modern có CMS từ con số 0 bằng các bước trong README; đo thời gian | v0.24.0 |
| **B — phần riêng Mr Spa** | M8, M9, M10, M13, M14 → P19–P22 | Mr Spa chạy trên gói, gỡ CMS cũ — **hết bản chép** | v0.25.0 |

Track C đi trước B: Modern là giá trị mới (chủ tiệm chưa có CMS) và chứng minh sản phẩm cho khách salon kế tiếp; Mr Spa
đã có CMS chạy tốt, hoãn chỉ tốn công giữ bản gốc. M3b (sau M3): chụp **CMS chép của Innovate** (giao diện Mr Spa) và
**admin của gói** trên cùng nội dung Innovate, chạy ở máy, đặt cạnh nhau — bằng chứng "y chang" cho từng task về sau
(script ở repo site, không đụng production). Test của gói vẫn kiểm **chữ nguyên văn** bằng DOM giả; e2e chụp từng màn.

### H.5 Đo lường, tiêu chí dừng, việc không làm

**Chỉ số chính**
- **Số CMS chép tay còn lại:** 2 hôm nay → 1 sau P18 → 0 sau P22.
- **Độ y chang:** số màn đạt / 32 màn đã kiểm kê của Mr Spa (ảnh M3b đặt cạnh nhau, SonLe duyệt).
- **Sau khi một site chuyển:** số lần chủ tiệm / nhân viên tự publish mỗi tháng (audit log, không tính người làm web) và
  thời gian publish → live.
- **Track C:** **thời gian tới lần publish đầu** của một site mới (từ `npm i` tới publish đầu tiên trên production),
  đếm cả việc chuyển nội dung sang JSON — ghi lại ở Modern để làm mức cho khách salon kế tiếp.

**Tiêu chí dừng**
- Một màn tốn quá **2× giờ ước lượng** để giống từng pixel → dừng ở mức "đủ giống", ghi khác biệt vào §H (không chạy theo).
- Track A trễ quá **2 tuần** so với mốc → cắt phạm vi (ví dụ dời M11 Rename / Archive) để chuyển Innovate trước.
- Sau P17, 30 ngày mà chủ Innovate **không tự publish lần nào** → dừng thêm tính năng, hỏi chủ tiệm vướng ở đâu trước.
- Track C: thời gian tới publish đầu của Modern quá **2 ngày công** → sửa `init` / README trước khi nhận khách tiếp.

**Không làm lúc này** (cân lại mỗi khi một track xong)
- API cho trợ lý AI tự tạo nháp (người duyệt publish): hướng dài hạn — giữ API chung, có tài liệu, để sau này cắm vào được; chưa xây.
- SEO riêng từng trang, thêm / đổi chỗ carousel ngay trên preview (Mr Spa còn để ngỏ).
- Sửa nội dung trên điện thoại (Mr Spa chặn < 900 px), đa ngôn ngữ cho admin, dark mode.
- Nhiều khách trên một hệ thống (SaaS), thanh toán: chỉ xét khi có ≥ 3 khách salon trả tiền.
- Thêm vào gói những gì 1 site cần mà không site thứ 2 nào cần — đó là việc của plugin (M14).

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
| **P6** | Auth + People như CMS cũ (§F.1): mật khẩu PBKDF2, phiên KV, owner / editor, bootstrap, rate limit | tạo owner bằng bootstrap, owner tạo editor | test auth + People |
| **P7** | Admin shell + danh sách + form sinh từ schema (§C.2) | sửa mọi field demo | test form + e2e Chrome headless |
| **P8** | Review / change summary + Save → review → Publish + trạng thái Live (§C.3) | luồng đủ trên demo | e2e + test change summary |
| **P8b** | Màn People trong admin (thêm người + mật khẩu tạm hiện 1 lần, khoá / mở, đặt lại mật khẩu, đổi vai trò; API P6) + My account (tự đổi mật khẩu) (§C.4) | owner tạo editor bằng giao diện | test DOM + e2e |
| **P8c** | Lọc HTML của richText ở server (lưu nháp + publish): chỉ giữ thẻ / thuộc tính an toàn, link an toàn (§F.2) | HTML nguy hiểm không vào nháp / commit | test sanitizer (≥ 1 ca mỗi kiểu tấn công) |
| **P8d** | Trình soạn thảo richText trực quan (§C.6): thanh định dạng; chèn / xoá ảnh trong bài, kéo đổi cỡ giữ tỉ lệ (`width`), alt; dán chỉ giữ chữ; ảnh từ bộ chọn của P10 | sửa bài blog demo có chèn, xoá, đổi cỡ ảnh mà không gõ HTML | test DOM + e2e (kéo đổi cỡ) |
| **P9** | Bridge trên iframe cùng origin (§D: chạy trong admin, không script trên trang), `data-cms-*` + selector, SECTION_MAP, khung 2 cấp, không render khi gõ | preview demo chọn / hover / focus đúng, HTML public không đổi | test bridge + đo khi gõ |
| **P10** | Ảnh: upload R2 staging, sheet chọn ảnh, alt (§C.5) | đổi ảnh demo + publish | test upload pipeline |
| **P11** | CLI `setup` (idempotent, `--account`) / `migrate` / `check` / `export` + `import` / `update` / `reset-owner-password` (đặt mật khẩu tạm cho owner quên mật khẩu, không sửa D1 tay) + tài liệu cài | cài demo từ đầu theo tài liệu **bằng URL release, không token**; `setup` lần 2 = không đổi gì; `update` đổi URL sang bản mới | chạy local (miniflare); xuất / nhập D1 demo khớp số dòng |
| P12b–P12f | (Viết lại 2026-10-12: 2 site pilot đã chạy CMS chép tay) tuỳ chọn / plugin chung mà site thật cần: list / collection cố định, mục chỉ owner, Activity (P12b, §C.7); History đọc từ git (P12c); plugin kiểu field riêng (P12d); CLI nhập users từ CMS chép (P12e); cắt / đổi cỡ ảnh = bản sao (P12f) | mỗi mục chạy trên demo | test + e2e demo |
| P13–P18 | Site 2 (chưa go-live) trước rồi site 1: config trên JSON có sẵn + plugin, chạy song song CMS chép ở local, chuyển (D1 mới + nhập users), dọn CMS chép | **mỗi site: Workers Builds build xanh không có biến môi trường token nào** (gói cài từ URL release) + 1 cặp publish + **lưu và đọc lại 1 nháp > 100 KB trên D1 THẬT** | so HTML public; Workers Builds log |
| M1–M15 | Admin giống hệt CMS tham chiếu rồi tách phần chung (§H), theo 3 track (§H.4): A lõi → Innovate, C cài mới → Modern (`init`), B phần riêng → Mr Spa | mỗi màn đúng chữ + bố cục §H.3 trên demo; ảnh đặt cạnh nhau (M3b) | test DOM (chữ nguyên văn) + e2e chụp ảnh từng màn |
| P23–P25 | Site cài mới đầu tiên (Modern Nails Lounge): nội dung → JSON, `init` + config, bật CMS | thời gian tới publish đầu ≤ 2 ngày công (§H.5) | so HTML public; ghi thời gian |
| P19 | Plugin catalog + redirects-check | test plugin trên fixture catalog nhỏ | test plugin |
| P20–P22 | Site cũ chuyển sang gói (config đầy đủ → bật, HTML public giống từng byte → dọn CMS cũ) | CMS mới làm được mọi việc CMS cũ làm | so HTML + kiểm production |

---

## Phụ lục — Đã xét, không chọn

CMS có sẵn (giá tra 2026-09-28): [CloudCannon](https://cloudcannon.com/pricing/) (khoảng 55 USD/tháng, sửa trên trang),
[TinaCloud](https://tina.io/pricing) (khoảng 24 USD/site/tháng), [Keystatic](https://keystatic.com/docs/cloud) (không sửa
trên trang), [Sveltia](https://sveltiacms.app/en/docs/intro) / [Decap](https://decapcms.org/docs/intro/) (miễn phí, người
sửa cần GitHub). Không chọn: muốn tự chủ sản phẩm, dùng chung cho nhiều site và bán lại về sau. CloudCannon là mẫu tham
khảo (collections, `_inputs`, `_structures`, editable regions).
