# Vibe CMS — Tracker (P1–P22)

> Nguồn: [DESIGN.md](DESIGN.md) §I. Quy tắc: 1 task = 1 commit; mỗi task REPORT → DỪNG chờ review. Test của gói **không đọc
> dữ liệu Mr Spa / Innovate / Novelle**. Task có sửa repo site: đầu task `git status` sạch + pull nhánh production
> (Innovate `main`, Novelle `dev`); có thay đổi lạ → DỪNG hỏi. Cập nhật lần cuối: 2026-09-28.

| Task | Việc | Giờ | Trạng thái |
|---|---|---:|---|
| **P1** | Khung Astro integration (`vibeCms()`, nạp + kiểm `cms.config.ts`, `/admin` tạm, `/api/cms/health`) + `fixtures/demo-site` + test + CI | 16–24 | 🔄 đang làm (chờ review) |
| P2 | Kiểu config đầy đủ + kiểm config (lỗi nói rõ đường dẫn) | 12–18 | ⏳ |
| P3 | Store: nguồn bundled + nháp KV + draft index D1; writer JSON giữ định dạng | 16–24 | ⏳ |
| P4 | Ô khoá theo vai trò ở server (PUT + publish) + audit `denied` | 8–12 | ⏳ |
| P5 | API chung files / collections + publish GitHub + audit + header version (F-16) | 24–34 | ⏳ |
| P6 | Auth + People (owner / editor, bootstrap, session tên theo site) | 8–12 | ⏳ |
| P7 | Admin shell + danh sách + form sinh từ schema | 40–60 | ⏳ |
| P8 | Review / change summary + Save → review → Publish + Live | 20–30 | ⏳ |
| P9 | Bridge chung (binding thuộc tính + selector, SECTION_MAP, U23, F-15) | 16–24 | ⏳ |
| P10 | Ảnh (upload R2 staging, sheet chọn ảnh, alt) | 16–24 | ⏳ |
| P11 | CLI `vibe-cms setup` (idempotent, `--account`) / `migrate` / `check` / `export` + tài liệu cài | 16–24 | ⏳ |
| P12 | Innovate Bước 0 + tách `site.ts` → JSON (HTML public giống từng byte) | 10–16 | ⏳ |
| P13 | Innovate: adapter Cloudflare cho route gói, gộp worker form liên hệ | 8–14 | ⏳ |
| P14 | Innovate: cài gói + `cms.config` + binding selector + ô khoá | 10–16 | ⏳ |
| P15 | Innovate: setup tài nguyên + token 1 repo + owner / editor + G.2 trên `main` | 8–12 | ⏳ |
| P16 | Novelle Bước 0 + tách `site.ts` → JSON | 8–12 | ⏳ |
| P17 | Novelle: cài gói + config + binding + ô khoá | 10–16 | ⏳ |
| P18 | Novelle: setup + G.2 trên `dev` (Workers Builds) | 8–12 | ⏳ |
| P19 | Plugin catalog + redirects-check | 16–24 | ⏳ |
| P20 | Mr Spa: `cms.config` đầy đủ (chưa bật) | 16–24 | ⏳ |
| P21 | Mr Spa: bật gói thay CMS cũ, HTML public giống từng byte | 20–32 | ⏳ |
| P22 | Mr Spa: dọn code CMS cũ | 8–15 | ⏳ |

## Ghi chú

- **CI (repo private):** mỗi lần chạy ước tính **3–4 phút** runner Linux (npm ci ~1 phút, build gói + demo ~1 phút, smoke
  wrangler dev ~30–60 giây). Gói GitHub Free cho repo private: 2.000 phút / tháng → ~500 lần chạy.
- **P1 — adapter Cloudflare** tự thêm binding `SESSION` (KV) và `IMAGES` vào `wrangler.json` sinh ra (không id); chạy
  local thì wrangler giả lập. P6 sẽ khai rõ KV `<site>-session`.
