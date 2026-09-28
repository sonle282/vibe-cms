# Vibe CMS — Tracker (P1–P22)

> Nguồn: [DESIGN.md](DESIGN.md) §I. Quy tắc: 1 task = 1 commit; mỗi task REPORT → DỪNG chờ review. Test của gói **không đọc
> dữ liệu site khách**. Task có sửa repo site: đầu task `git status` sạch + pull nhánh production của site; có thay đổi
> lạ → DỪNG hỏi. Chi tiết riêng từng site nằm trong tài liệu private của dự án đó. Cập nhật lần cuối: 2026-09-28.

| Task | Việc | Giờ | Trạng thái |
|---|---|---:|---|
| **P1** | Khung Astro integration (`vibeCms()`, nạp + kiểm `cms.config.ts`, `/admin` tạm, `/api/cms/health`) + `fixtures/demo-site` + test + CI | 16–24 | ✅ Xong (duyệt 2026-09-28; ec5cd02 + 44a8f57, CI 36372154008) |
| **P2** | Kiểm config đầy đủ + kiểm nội dung lúc build + workflow release + `imageService` | 12–18 | ✅ Xong (duyệt 2026-09-28; 5750418 an toàn + aff3cae, CI 36376837159) |
| **P3** | Store: nguồn bundled + nháp + draft index D1 (migration 0001); writer JSON / Markdown giữ định dạng | 16–24 | ✅ Xong (duyệt 2026-09-28; b91d59c, CI 36394874058) |
| **P3b** | Nháp chuyển hẳn sang D1 (revision nguyên tử, migration 0002, nội dung ≤ 1,9 MB), user id nội bộ, cờ `rewroteWholeFile` của writer | 3–5 | ✅ Xong (duyệt 2026-09-28; 513c56b, CI 36396950422) |
| **P4** | Ô khoá theo vai trò ở server (lưu nháp + publish) + audit `denied` (migration 0003) | 8–12 | ✅ Xong (duyệt 2026-09-28; 21f912e, CI 36398543782) |
| **P5** | API chung (files / collections / nháp / publish / live-version) + publish GitHub (1 commit, không force, thử lại) + audit | 24–34 | ✅ Xong (duyệt 2026-09-28; 91cf66a, CI 36402119201) |
| **P5b** | `sourceVersion` bắt buộc khi tạo nháp (giữ bản gốc); publisher GitHub đối chiếu Mr Spa: 422 = nhánh đổi, raw ≤ 100 MB, giới hạn tốc độ | 3–5 | ✅ Xong (22252a8, CI 36405197944; chờ review) |
| P6 | Auth + People — **Bước 0 xong (đề xuất DESIGN §F.1: B1 Cloudflare Access + vai trò D1); chờ SonLe chọn A / B1 / B2** | A 18–28 · B 10–16 | ⏸ chờ quyết định |
| P7 | Admin shell + danh sách + form sinh từ schema | 40–60 | ⏳ |
| P8 | Review / change summary + Save → review → Publish + Live | 20–30 | ⏳ |
| P9 | Bridge chung (inject vào iframe cùng origin, dự phòng loader; `data-cms-*` + selector, SECTION_MAP, U23, F-15) | 16–24 | ⏳ |
| P10 | Ảnh (upload R2 staging, sheet chọn ảnh, alt) | 16–24 | ⏳ |
| P11 | CLI `vibe-cms setup` (idempotent, `--account`) / `migrate` / `check` / `export` / `update` (đổi URL release) + tài liệu cài không token | 16–24 | ⏳ |
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

- **CI:** repo công khai (2026-09-28) → phút GitHub Actions không tính phí. Thực tế **~1 phút / lần** (job `check` 33 giây
  ở run 36372154008; job `secrets` quét gitleaks toàn lịch sử vài giây). Nếu repo về private: 2.000 phút / tháng ≈ 1.500+
  lần chạy.
- **Phân phối:** GitHub Release `vX.Y.Z` + `vibe-cms-X.Y.Z.tgz` (workflow `release.yml` khi push tag), site cài bằng URL
  công khai — không token. Chưa tạo tag / release: bản đầu tiên khi lõi đủ dùng (reviewer báo).
- **API local (P5):** `npm run api:local` chạy API trong Worker (`test/api-worker`, `wrangler dev --local`, D1 local) và
  publish sang GitHub GIẢ LẬP trên 127.0.0.1 (`test/helpers/fake-github.mjs`) — không đụng repo thật nào.
- **Store local:** `npm run store:local` áp `migrations/` bằng `wrangler d1 migrations apply --local` rồi chạy Worker thử
  (`test/store-worker`) trong `wrangler dev --local` với D1 giả lập — không tài nguyên Cloudflare, dữ liệu ở thư mục tạm.
- **Binding adapter:** `IMAGES` không dùng (`imageService: "compile"`, smoke kiểm `wrangler.json` không có `images`);
  `SESSION` (KV) để P6 khai `<site>-session`.
