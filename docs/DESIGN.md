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
- **Form** sinh từ field: text (1 dòng / nhiều dòng, đếm `maxLength`), richText (ô HTML), image (địa chỉ + alt + ảnh
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
| Owner quên mật khẩu | P11: lệnh CLI đặt mật khẩu tạm cho owner (không sửa D1 bằng tay) |
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

Hàm `userFromLegacyRow()` + `insertUser()` trong gói làm việc chuyển. ⚠ Tên bảng trùng với CMS cũ: P21 phải dùng **D1
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
| **P8b** | Màn People trong admin (thêm người + mật khẩu tạm hiện 1 lần, khoá / mở, đặt lại mật khẩu, đổi vai trò; API P6) | owner tạo editor bằng giao diện | test DOM + e2e |
| **P8c** | Lọc HTML của richText ở server (lưu nháp + publish): chỉ giữ thẻ / thuộc tính an toàn, link an toàn | HTML nguy hiểm không vào nháp / commit | test sanitizer (≥ 1 ca mỗi kiểu tấn công) |
| **P9** | Bridge: inject vào iframe cùng origin (dự phòng loader), `data-cms-*` + selector, SECTION_MAP, khung 2 cấp, không render khi gõ | preview demo chọn / hover / focus đúng, HTML public không đổi | test bridge + đo khi gõ |
| **P10** | Ảnh: upload R2 staging, sheet chọn ảnh, alt | đổi ảnh demo + publish | test upload pipeline |
| **P11** | CLI `setup` (idempotent, `--account`) / `migrate` / `check` / `export` / `update` / `reset-owner-password` (đặt mật khẩu tạm cho owner quên mật khẩu, không sửa D1 tay) + tài liệu cài | cài demo từ đầu theo tài liệu **bằng URL release, không token**; `setup` lần 2 = không đổi gì; `update` đổi URL sang bản mới | chạy local (miniflare); xuất / nhập D1 demo khớp số dòng |
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
