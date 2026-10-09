# Vibe CMS — Tracker (P1–P22)

> Nguồn: [DESIGN.md](DESIGN.md) §I. Quy tắc: 1 task = 1 commit; mỗi task REPORT → DỪNG chờ review. Test của gói **không đọc
> dữ liệu site khách**. Task có sửa repo site: đầu task `git status` sạch + pull nhánh production của site; có thay đổi
> lạ → DỪNG hỏi. Chi tiết riêng từng site nằm trong tài liệu private của dự án đó. Cập nhật lần cuối: 2026-10-09 (P8d).

| Task | Việc | Giờ | Trạng thái |
|---|---|---:|---|
| **P1** | Khung Astro integration (`vibeCms()`, nạp + kiểm `cms.config.ts`, `/admin` tạm, `/api/cms/health`) + `fixtures/demo-site` + test + CI | 16–24 | ✅ Xong (duyệt 2026-09-28; ec5cd02 + 44a8f57, CI 36372154008) |
| **P2** | Kiểm config đầy đủ + kiểm nội dung lúc build + workflow release + `imageService` | 12–18 | ✅ Xong (duyệt 2026-09-28; 5750418 an toàn + aff3cae, CI 36376837159) |
| **P3** | Store: nguồn bundled + nháp + draft index D1 (migration 0001); writer JSON / Markdown giữ định dạng | 16–24 | ✅ Xong (duyệt 2026-09-28; b91d59c, CI 36394874058) |
| **P3b** | Nháp chuyển hẳn sang D1 (revision nguyên tử, migration 0002, nội dung ≤ 1,9 MB), user id nội bộ, cờ `rewroteWholeFile` của writer | 3–5 | ✅ Xong (duyệt 2026-09-28; 513c56b, CI 36396950422) |
| **P4** | Ô khoá theo vai trò ở server (lưu nháp + publish) + audit `denied` (migration 0003) | 8–12 | ✅ Xong (duyệt 2026-09-28; 21f912e, CI 36398543782) |
| **P5** | API chung (files / collections / nháp / publish / live-version) + publish GitHub (1 commit, không force, thử lại) + audit | 24–34 | ✅ Xong (duyệt 2026-09-28; 91cf66a, CI 36402119201) |
| **P5b** | `sourceVersion` bắt buộc khi tạo nháp (giữ bản gốc); publisher GitHub đối chiếu Mr Spa: 422 = nhánh đổi, raw ≤ 100 MB, giới hạn tốc độ | 3–5 | ✅ Xong (duyệt 2026-09-28; 22252a8, CI 36405197944) |
| **P6** | Auth + People — phương án A (giống CMS cũ, SonLe chốt 2026-09-28): mật khẩu PBKDF2 100k, phiên KV 30 ngày, owner / editor, bootstrap, rate limit, People, bắt đổi mật khẩu tạm | 18–28 | ✅ Xong (review 2026-10-07: P6 review → P6b sửa 4 điểm; c550b79, CI 36408128831 + P6b 24f1e3b, CI 37642092177) |
| **P7** | Admin shell + danh sách + form sinh từ schema (mọi kiểu field), lưu nháp qua API P5, ô khoá cho editor; demo dùng đủ mọi kiểu field; test DOM giả + e2e Chrome headless | 40–60 | ✅ Xong (merge 2026-10-08; 21ea0a8, CI 37643742576) |
| **P8** | Review / change summary + Save → review → Publish + Live (`GET /drafts`, tóm tắt thay đổi, publish nhiều nháp = 1 commit, theo dõi live-version) | 20–30 | ✅ Xong (merge 2026-10-08; 3359d15, CI 37713179876) |
| **P8b** | Màn People trong admin (SonLe chốt 2026-10-08: tách khỏi P8): thêm người + mật khẩu tạm 1 lần, vai trò, khoá / mở, đặt lại mật khẩu; + My account (tự đổi mật khẩu) | 6–10 | ✅ Xong (merge 2026-10-08; 29ffc13, CI 37714369737) |
| **P8c** | Lọc HTML richText ở server (SonLe chốt 2026-10-08: tách khỏi P8): hast + cùng danh sách với CMS cũ, lưu nháp + publish + cảnh báo lúc build | 4–8 | ✅ Xong (merge 2026-10-08; 3414a26, CI 37715518893) |
| **P8d** | Trình soạn thảo richText trực quan (SonLe thêm 2026-10-08): thanh định dạng (đoạn, H2 / H3, đậm, nghiêng, danh sách, trích dẫn, link) thay ô HTML; **chèn / xoá ảnh trong bài**, **kéo đổi cỡ ảnh giữ nguyên tỉ lệ** (ghi `width`), sửa alt; dán chỉ giữ chữ. Chèn ảnh từ thư viện / tải lên dùng bộ chọn ảnh của P10 | 12–20 | 🔎 Chờ review (commit + CI: xem PR) |
| P9 | Bridge chung (inject vào iframe cùng origin, dự phòng loader; `data-cms-*` + selector, SECTION_MAP, U23, F-15) | 16–24 | ⏳ |
| **P10** | Ảnh (upload R2 staging, sheet chọn ảnh, alt) — SonLe duyệt làm trước P8d (2026-10-08) | 16–24 | ✅ Xong (merge 2026-10-09; 9be4829, CI 37717835049) |
| P11 | CLI `vibe-cms setup` (idempotent, `--account`) / `migrate` / `check` / `export` / `update` (đổi URL release) + `reset-owner-password` (owner quên mật khẩu → mật khẩu tạm, không sửa D1 tay) + tài liệu cài không token | 16–24 | ⏳ |
| P12 | Innovate Bước 0 + tách nội dung → JSON (HTML public giống từng byte) | 10–16 | ⏳ |
| P13 | Innovate: adapter Cloudflare cho route gói, gộp worker form liên hệ | 8–14 | ⏳ |
| P14 | Innovate: cài gói (URL release) + `cms.config` + `data-cms-*` + ô khoá | 10–16 | ⏳ |
| P15 | Innovate: setup tài nguyên + token 1 repo + owner / editor + G.2; Workers Builds xanh không biến môi trường token nào; lưu + đọc 1 nháp > 100 KB trên D1 THẬT | 8–12 | ⏳ |
| P16 | Novelle Bước 0 + tách nội dung → JSON | 8–12 | ⏳ |
| P17 | Novelle: cài gói + config + `data-cms-*` + ô khoá | 10–16 | ⏳ |
| P18 | Novelle: setup + G.2 (Workers Builds, không token) | 8–12 | ⏳ |
| P19 | Plugin catalog + redirects-check | 16–24 | ⏳ |
| P20 | Mr Spa: `cms.config` đầy đủ (chưa bật) | 16–24 | ⏳ |
| P21 | Mr Spa: bật gói thay CMS cũ, HTML public giống từng byte | 20–32 | ⏳ |
| P22 | Mr Spa: dọn code CMS cũ | 8–15 | ⏳ |

## Ghi chú

- **P6 review (2026-10-07):** `npm run check` xanh trước khi sửa (204 test, store 24, API 50, auth 19 kiểm; PBKDF2 ~16 ms
  trong workerd local). Đối chiếu §F.1 đủ: PBKDF2 100k, phiên KV 30 ngày, owner / editor, bootstrap 1 lần, rate limit,
  People, bắt đổi mật khẩu tạm; audit không có mật khẩu / hash / token. P6b sửa: (1) form `/admin` thiếu
  `method="post"` → JS chưa chạy thì mật khẩu vào URL; (2) đổi mật khẩu không giới hạn số lần đoán mật khẩu hiện tại
  → 10 / phút / người dùng; (3) so mật khẩu bootstrap thời gian hằng; (4) mật khẩu tạm rút đều (bỏ lệch modulo).
- **E2E (P7):** `npm run e2e` chạy site demo ĐÃ BUILD trong `wrangler dev --local` (D1 + KV + rate limit giả lập, id
  giả, không gì remote) và lái Chrome headless bằng `playwright-core` (không tải trình duyệt: `CHROME_PATH`, Chromium sẵn
  ở `/opt/pw-browsers/chromium`, hoặc Chrome của runner CI). Owner sửa mọi field demo → lưu nháp → so với API; editor
  thấy ô khoá bị disabled. Test form trên DOM giả: `test/admin.test.mjs` (happy-dom).
- **Publish trong e2e (P8):** `npm run e2e` chạy thêm GitHub giả trên 127.0.0.1 (`test/helpers/fake-github.mjs`), Worker
  trỏ tới nó bằng `VIBE_GITHUB_API_URL` (chỉ nhận địa chỉ loopback). Owner xem lại 6 nháp → publish → đúng 1 commit,
  file trên GitHub giả = nội dung nháp. "Live" (site build lại) được kiểm trong `test/admin.test.mjs`, không trong e2e.
- **Ảnh trong e2e (P10):** e2e có thêm R2 local (`CMS_MEDIA`). Owner bấm "Choose image…" ở ảnh của Sam → chọn 1 PNG
  2600×1300 → trình duyệt thu về 2400×1200 WebP → tải lên R2 local → ảnh được chọn, route xem trước trả đúng WebP →
  publish: ảnh nằm trong cùng commit, byte chính xác. Cần cho từng site khi bật (P15, P18): bucket R2 `<site>-media` +
  binding `CMS_MEDIA` (P11 `setup` tạo); thiếu bucket thì sheet nói rõ, vẫn chọn được ảnh có sẵn.
- **Trình soạn thảo trong e2e (P8d):** owner viết lại thân bài blog demo bằng trình soạn thảo trực quan (gõ chữ, đậm, tiêu
  đề, danh sách, tải ảnh lên + alt, **kéo góc ảnh** 200 px nhỏ lại — tỉ lệ giữ nguyên, chỉ ghi `width`, chèn rồi xoá ảnh
  thứ hai) → nháp là Markdown đúng từng ký tự; publish: ảnh trong bài cùng commit. Ô HTML: bio gõ trực tiếp, banner qua
  "Edit HTML" (P8c vẫn lọc). Test P8b có ngày cố định ("Oct 8, 2026") → hết đúng từ 9/10; đã sửa thành ngày hôm nay.
- **CI:** repo công khai (2026-09-28) → phút GitHub Actions không tính phí. Thực tế **~1 phút / lần** (job `check` 33 giây
  ở run 36372154008; job `secrets` quét gitleaks toàn lịch sử vài giây). Nếu repo về private: 2.000 phút / tháng ≈ 1.500+
  lần chạy.
- **Phân phối:** GitHub Release `vX.Y.Z` + `vibe-cms-X.Y.Z.tgz` (workflow `release.yml` khi push tag), site cài bằng URL
  công khai — không token. Chưa tạo tag / release: bản đầu tiên khi lõi đủ dùng (reviewer báo).
- **Auth local (P6):** `npm run auth:local` chạy wiring production (`createSiteRuntime`) trong `wrangler dev --local` với D1 +
  KV + rate limit giả lập và GitHub giả: bootstrap, People, publish bằng đăng nhập thật, đo CPU băm mật khẩu.
- **API local (P5):** `npm run api:local` chạy API trong Worker (`test/api-worker`, `wrangler dev --local`, D1 local) và
  publish sang GitHub GIẢ LẬP trên 127.0.0.1 (`test/helpers/fake-github.mjs`) — không đụng repo thật nào.
- **Store local:** `npm run store:local` áp `migrations/` bằng `wrangler d1 migrations apply --local` rồi chạy Worker thử
  (`test/store-worker`) trong `wrangler dev --local` với D1 giả lập — không tài nguyên Cloudflare, dữ liệu ở thư mục tạm.
- **Binding adapter:** `IMAGES` không dùng (`imageService: "compile"`, smoke kiểm `wrangler.json` không có `images`);
  `SESSION` (KV) để P6 khai `<site>-session`.
