# Vibe CMS — Tracker (P1–P25, P12b–P12h, U1–U4, M0–M15)

> Nguồn: [DESIGN.md](DESIGN.md) §I. Quy tắc: 1 task = 1 commit; mỗi task REPORT → DỪNG chờ review. Test của gói **không đọc
> dữ liệu site khách**. Task có sửa repo site: đầu task `git status` sạch + pull nhánh production của site; có thay đổi
> lạ → DỪNG hỏi. Chi tiết riêng từng site nằm trong tài liệu private của dự án đó. Cập nhật lần cuối: 2026-10-13 (Track A xong: v0.23.0 · M7, M11, M12, Innovate chạy gói — P17 / P18; Novelle 0.22.0 — novelle PR #4 · 3 track A → C → B, DESIGN §H.4–H.5; Track C: M15 xong, release v0.24.0; tiếp theo P23 Modern).

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
| **P8d** | Trình soạn thảo richText trực quan (SonLe thêm 2026-10-08): thanh định dạng (đoạn, H2 / H3, đậm, nghiêng, danh sách, trích dẫn, link) thay ô HTML; **chèn / xoá ảnh trong bài**, **kéo đổi cỡ ảnh giữ nguyên tỉ lệ** (ghi `width`), sửa alt; dán chỉ giữ chữ. Chèn ảnh từ thư viện / tải lên dùng bộ chọn ảnh của P10 | 12–20 | ✅ Xong (merge 2026-10-09; 8e91b7f, CI 37884855754) |
| **P9** | Bridge chung (iframe cùng origin — bridge chạy trong admin, không script trên trang; `data-cms-*` + selector, SECTION_MAP, U23, F-15) + pane preview cạnh form | 16–24 | ✅ Xong (merge 2026-10-09; a6c1c0d, CI 37889486648) |
| **P10** | Ảnh (upload R2 staging, sheet chọn ảnh, alt) — SonLe duyệt làm trước P8d (2026-10-08) | 16–24 | ✅ Xong (merge 2026-10-09; 9be4829, CI 37717835049) |
| **P11** | CLI `vibe-cms setup` (idempotent, `--account`) / `migrate` / `check` / `export` + `import` / `update` (đổi URL release) + `reset-owner-password` (owner quên mật khẩu → mật khẩu tạm, không sửa D1 tay) + tài liệu cài không token | 16–24 | ✅ Xong (merge 2026-10-12; 6ec2860, CI 38186633041) |
| **P12** | Bước 0 (chỉ đọc 2 site pilot): cả hai đã chạy CMS chép tay (Innovate đã go-live) → viết lại P12–P18 (chi tiết: tài liệu private). SonLe duyệt 2026-10-12: thay cả 2 bản chép bằng gói, **Novelle trước** | — | ✅ Xong (duyệt 2026-10-12) |
| **P12b** | Gói: list cố định (`fixed: true`), collection cố định, mục chỉ owner (`access: "owner"`, 403 + audit), màn **Activity** (owner) | 12–18 | ✅ Xong (merge 2026-10-12; d61f489 + fcd161f, CI 38192504189) |
| **P12c** | Gói: **History + Restore as draft** — đọc lịch sử commit của file trên GitHub (gồm cả các lần publish bằng CMS cũ, không cần chuyển dữ liệu) | 10–16 | ✅ Xong (merge 2026-10-12; d42af43, CI 38194532723) |
| **P12d** | Gói: `f.tuple`, text `pattern` / `tokens`, rich text `allow`, **`rules` của site** (chỗ cắm plugin: build + lưu + publish) — những gì Novelle cần | 14–22 | ✅ Xong (merge 2026-10-12; 46d74bb, CI 38196413379) |
| **P12e** | CLI: `import-legacy-users` từ D1 của CMS chép (cùng định dạng hash → không đặt lại mật khẩu; admin → owner) | 6–10 | ✅ Xong (merge 2026-10-12; 8028ab0, CI 38197484347) |
| **P12g** | Gói (trước Innovate): `f.pick` (giá trị chọn từ danh sách site tính từ chính nội dung — giá `{ "of": … }`) + `f.toggle` (`plain`) | 6–10 | ✅ Xong (merge 2026-10-12; 2061801, PR #21) |
| **P12h** | Gói (trước Innovate): ảnh theo tên trong manifest của site (`media.names`) — API đổi tên ↔ địa chỉ, upload được đặt tên theo chỗ commit (`media.dir` ngoài public/ + `media.base`), thư viện = manifest, build / lưu từ chối tên lạ | 8–12 | ✅ Xong (merge 2026-10-12; aae80c7, PR #22); release v0.21.0 |
| **P12f** | Gói: cắt / đổi cỡ ảnh = **bản sao mới**, giữ ảnh gốc (như Mr Spa), làm trong trình duyệt — không binding `IMAGES` | 8–14 | ✅ Xong (merge 2026-10-12; 884a683, CI 38198654822) |
| **P13** | Novelle: `cms.config` trên JSON có sẵn (không đổi nội dung) + plugin + `bind` selector; chạy song song CMS chép ở local | 10–16 | ✅ Xong (merge 2026-10-12; novelle PR #1, cài v0.19.0 từ URL release) |
| **P14** | Novelle: chuyển (`setup --site novelle`, nhập users, gỡ CMS chép), G.2 1 cặp trên `dev`, Workers Builds không biến token | 10–16 | ✅ Xong (merge 2026-10-12; novelle PR #2, 30af26c; publish 37868c7 + revert a913f91 trên demo) |
| **U1** | UI = design system của Mr Spa (SonLe 2026-10-12: CMS mọi site dùng chung 1 bộ): token theo vai trò + giá trị của Mr Spa (design-004 · Foundations), font Geist tự host, cỡ control 40 / 36 / 30, pill 6 px chấm, focus, reduced motion | 6–10 | ✅ Xong (merge 2026-10-12; 6191ef3, PR #16) |
| **U2** | UI: khung như Mr Spa — rail 64 (Pages = mọi file, mỗi collection 1 chỗ + `icon` trong config, Drafts có số; People / Activity dưới cùng; avatar → menu My account / Sign out), top bar 56 (crumb `Pages / Tên`, chọn thiết bị ở giữa, Publish là nút chính duy nhất), canvas padding 24 + preview bo 12, form trong inspector 360 bên phải; trang không bao giờ cuộn — chỉ canvas / inspector | 10–16 | ✅ Xong (merge 2026-10-12; 982e0f5, PR #17) |
| **U3** | UI: thành phần như Mr Spa — hộp thoại thay `window.confirm` (Esc / Cancel / bấm ngoài = không đổi; nút phá huỷ màu đỏ), Publish trong editor mở hộp review của đúng bản nháp → "Publish to website", toast có icon + 1 hành động (Undo), tooltip cho nút icon, thẻ ảnh (contain, tên + cỡ, Replace khi hover, ⋯ Copy link / Remove, Desktop / Phone), sheet ảnh (Library / Upload, bấm = chọn, double-click / Use image = dùng, Crop ở chân sheet) | 10–16 | ✅ Xong (merge 2026-10-12; 3e91798, PR #18) |
| **U4** | UI: màn hình như Mr Spa — Pages dạng danh sách (tên, địa chỉ, trạng thái), danh sách collection có ảnh + "+ New …", **Drafts** (mỗi nháp: thay đổi gì, Open / Publish / ⋯ Discard, Recently published) + "Review & publish all", **Media** (thư viện, lọc, chi tiết, Upload images), **People & activity** 2 tab (form thêm người bên phải, vai trò dạng thẻ), History, Sign-in, chặn < 900 px. Sau đó: release + `vibe-cms update` cho Novelle | 12–18 | ✅ Xong (merge 2026-10-12; 4a7f713, PR #19); release v0.20.0 |
| **P15** | Innovate: tách nốt `site.ts` → JSON (reviews, FAQ, membership, chính sách, Journal…) — HTML giống từng byte | 8–14 | ✅ Xong (merge 2026-10-12; innovate PR #8, 26b0f6a — 358/358 file giống từng byte) |
| **P16a** | Gói (tìm ra khi viết cms.config Innovate): `f.number` (offers.priority, cashCard.stamps) + text `from` (id món / gói tự sinh từ tên khi thêm mới) — vào v0.21.0 (SonLe duyệt 2026-10-12) | 3–5 | ✅ Xong (merge 2026-10-12; 8025fc6, PR #24) + giới hạn lồng 8 cấp, `tokens: []`; release v0.21.0 |
| **P16** | Innovate: `cms.config` + plugin + collection cho các mục vừa tách; `wrangler.toml` → `wrangler.jsonc`; song song ở local | 12–18 | ✅ Xong (merge 2026-10-12; innovate PR #9, 1909475 — cài v0.21.0, `vibe:check` + `vibe:break` 12 ca, HTML giống từng byte) |
| **M0** | Đối chiếu CMS Mr Spa (code + 32 ảnh chụp chạy local) với gói, phỏng vấn SonLe, viết §H (giống hệt + mô hình chung) | 4–6 | ✅ Xong (2026-10-12) |
| **M1** | Khung y chang: URL theo đường dẫn (`/admin/pages/…`, `#/…` cũ chuyển hướng), `/admin` → trang đầu; rail (Users chỉ admin, avatar 2 chữ + Change password / Sign out, `under` = tab); top bar (3 thiết bị co vừa + nhớ, chip trạng thái + nhãn ngắn, icon View live / History / Discard / Reload and keep / Check again, ⋯ khi < 900, Publish luôn hiện + 10 lý do); tooltip 400 ms, toast Mr Spa; bỏ Preview toggle, Ctrl+S, dòng trạng thái, Skip link | 14–20 | ✅ Xong (2026-10-12) |
| **M2** | **A ·** Vai trò Admin / Editor: ~~migration D1~~ (giữ mã lưu `owner`, §H.1), config `"admin"` (+ `"owner"` một cảnh báo), CLI `reset-admin-password` (bí danh cũ), chữ trên mọi màn; hộp Change password thay màn My account (giữ bắt đổi mật khẩu tạm) | 6–10 | ✅ Xong (2026-10-12) |
| **M3** | **A ·** Sửa trang 2 cấp: danh sách section theo thứ tự trên trang (tóm tắt, chấm chưa lưu, tip ẩn được), cấp 2 (←, Esc, trượt 220 ms, nhớ section), field (nhãn = nút, help trên ô, hộp lỗi đầu trang), list (N of M, Banner 1, ↑ ↓ ×, hỏi trước khi xoá, chọn thẻ ↔ preview, ghi chú preview); bridge (chip trên / trong, viền section, chớp, chỉ cuộn khi khuất); bỏ bộ đếm ký tự mọi ô | 16–24 | ✅ Xong (2026-10-13) |
| **M3b** | **A ·** Đo "y chang" (§H.4): script ở repo Innovate chạy **CMS chép** và **admin của gói** trên cùng nội dung, ở máy (D1 / KV local, người dùng thử tạo tại chỗ), chụp từng màn đặt cạnh nhau → ảnh kèm mỗi task về sau; không đụng production | 4–6 | ✅ Xong (2026-10-13; repo Innovate `scripts/cms-parity-shots.mjs` + báo cáo private: 4 chỗ sửa ngay trong M3, phần còn lại vào M5 / M7 / M11 / M12, M3c và config Innovate) |
| **M3c** | **A ·** (Từ M3b) section trỏ vào item của **list cố định** (`services[0].card` …, như CMS Mr Spa chia mỗi dịch vụ thành nhiều section) + object lồng trong section hiện phẳng với nhãn ghép ("Title · First line") | 6–10 | ✅ Xong (2026-10-13; object lồng: `flat: true` trong config thay cho nhãn ghép — người viết config đặt nhãn đầy đủ như Mr Spa) |
| **M4** | **A ·** `f.link` (Page · Web address · Phone · Email, Find a page > 8, "Opens: …", lỗi bằng lời thường, Save tắt khi link sai) + `f.phone` (`site.phone.country`) | 10–14 | ✅ Xong (2026-10-13; lưu nguyên href site đang có; Page = file / collection có `preview` cố định + `site.pages` mới; "Link destination: not visible in the preview." trong inspector; build + mỗi lần lưu kiểm link / SĐT; `site` từ chối key lạ) |
| **M5** | **A ·** Ảnh y chang: thẻ (Desktop / Mobile ghép `mobile`, ô trống nét đứt, hover Replace / Adjust / thả file, thả = tải lên có %, ⋯ Set as main / Copy / Remove trừ ảnh bắt buộc); bỏ ô địa chỉ / alt / ảnh phone dưới thẻ; sheet (ngữ cảnh, chip theo nhóm, Load more 40, lưới 5 cột, chân sheet, Undo); Adjust như Mr Spa (Shape + điểm lấy nét) thay giao diện Crop | 14–20 | ✅ Xong (2026-10-13; spec đọc từ code Mr Spa; ảnh được sửa trong trình duyệt nên Adjust có cho mọi ảnh cùng site, không chỉ ảnh đã tải lên; bản Adjust được chọn sẵn trong sheet; nơi dùng ảnh tính ở server — `usage` của `GET /media`) |
| **M6** | **A ·** Lưu / publish y chang: bản khôi phục cục bộ 24 h + "Restore unsaved changes?", 2 hộp thoại (Review changes theo section + `<mark>` + ảnh nhỏ → Publish {name}), tiến độ trong chip + biên nhận localStorage + lịch theo dõi 20 phút + build failed (`publish.buildCheck`), Live tải lại lặng lẽ, chữ Leave / Discard / 409; bỏ toast lưu / publish. Rồi release **v0.22.0** + Novelle | 14–20 | ✅ Xong (2026-10-13; spec đọc từ code Mr Spa; host lấy từ `site.url` thay vì viết cứng; `publish.typicalMinutes` / `publish.buildCheck` (token cần thêm Checks: read); release v0.22.0 + Novelle là bước riêng) |
| **M7** | **A ·** Pages 2 cột (`group`, `area`, `description`, pill Live / Off, "Unpublished changes"), khu vực site (crumb "Across the whole site", `previewOn`), Popup (công tắc + 4 câu trạng thái), `layout: "seo"` (Google + thẻ chia sẻ, đếm 160) | 12–18 | ✅ Xong (2026-10-13; spec đọc từ code Mr Spa; khung teal theo `outline` (selector) thay cho header / footer viết cứng; trang hiện khu vực = `preview` của file (không cần `previewOn`); `toggle` thay cho popup.enabled viết cứng; preview popup riêng của Mr Spa không đóng gói — site tự vẽ) |
| **M11** | **A ·** Media y chang: chip, Load more, chi tiết (Rename = tên hiển thị D1, Copy link, Adjust, Used on → mở đúng ô, Remove / Archive / Unarchive + luật), ⋯ Remove unused images (> 30 ngày); Drafts y chang (See changes chỉ đọc, mã commit 7 ký tự; giữ publish nhiều nháp) | 16–24 | ✅ Xong (2026-10-13; spec đọc từ code Mr Spa; tên hiển thị + archive lưu note R2 `media-note/…` (Mr Spa: tên ở D1) — không cần migration; bỏ nút Publish trên thẻ nháp (Mr Spa không có), giữ "Review & publish all") |
| **M12** | **A ·** People & activity y chang (bảng + ⋯, Reset password = admin gõ, Refresh, Add a person có mật khẩu tạm sửa được, bỏ ô chọn vai trò / Name; Activity 4 lọc, 100 dòng, Refresh), Version history = hộp thoại (mọi vai trò), Sign-in (Signing in…, lỗi trên nút), màn nhỏ không che đăng nhập. Rồi release **v0.23.0** | 12–18 | ✅ Xong (2026-10-13; spec đọc từ code Mr Spa; Version history cho mọi vai trò như nút của Mr Spa nhưng server cũng cho editor đọc / khôi phục (Mr Spa báo lỗi 403 cho editor) — file / collection chỉ admin vẫn chỉ admin; trang đăng nhập không bị che ở màn nhỏ và vừa điện thoại (Mr Spa: min-width 960 px); release v0.23.0 là bước kế) |
| **P17** | **A ·** Innovate: chuyển production trong khung giờ báo chủ (publish hết nháp trước, nhập users), G.2 trên `main`; lưu + đọc 1 nháp > 100 KB trên D1 THẬT | 8–12 | ✅ Xong (2026-10-14; innovate PR #11, 21fb9d2 — `setup --site innovate` (D1 innovate-cms, KV innovate-session, R2 innovate-media; chạy 2 lần, lần 2 không đổi), nhập 3 người từ innovatesalon-cms, 0 nháp trong CMS chép; 21 trang live giống từng byte bản build; nháp 151,8 KB lưu + đọc lại trên D1 thật rồi xoá; G.2: publish 709e7e1 (Workers Builds sót webhook lần này, lên live nhờ build của PR #12) + trả lại 73aba88 (tự build, live sau 42 s, home.json giống từng byte trước P17)) |
| **P18** | **A ·** Innovate: dọn CMS chép; D1 / R2 cũ giữ 30 ngày rồi chủ xoá | 4–8 | ✅ Xong (2026-10-14; code CMS chép gỡ ở P17 (121 file), innovate PR #12, be3871c: chỉ còn kiểu uploads/<yyyy>/<mm>, CLAUDE.md. Chủ còn làm: `wrangler secret delete CMS_GITHUB_TOKEN`; từ 2026-11-12 xoá D1 innovatesalon-cms, KV innovatesalon-session, R2 innovatesalon-media) |
| **M15** | **C ·** `vibe-cms init`: đọc JSON của site → nháp `cms.config.ts` (file, section, field đoán kiểu, group) + gợi ý `data-cms-bind`; README "thêm CMS vào site trong 5 bước". Rồi release **v0.24.0** | 10–16 | ✅ Xong (2026-10-14; `vibe-cms init`: file / collection / section / field đoán từ khoá + giá trị, kiểm với chính nội dung (đoán sai → text thường, bỏ gì đều ghi đầu file), chỉ ghi khi config check đạt; gợi ý `data-cms-field` từ template; thử trên demo (0 cảnh báo) và nội dung thật của Innovate (13 trang, 245 field, 2 field rỗng bỏ ra) ở `--dry-run`; README Install bước 3 = init; tiếp theo release v0.24.0; sau đó (2026-10-14, tìm ra ở P24): `init` viết preview không có `/` cuối cho site `build.format: "file"` (Modern: `/faq`)) |
| P23 | **C ·** Modern Nails Lounge: nội dung `src/data/*.ts` → JSON (HTML public giống từng byte), như P15 của Innovate | 6–10 | ⏳ |
| P24 | **C ·** Modern: `vibe-cms init` → `cms.config` + `data-cms-*`, `vibe-cms setup`, chạy song song ở local; ghi **thời gian tới lần publish đầu** (§H.5) | 6–10 | ⏳ |
| P25 | **C ·** Modern: bật CMS trên production (SonLe duyệt, báo chủ tiệm), người dùng đầu tiên, 1 cặp publish | 3–5 | ⏳ |
| M8 | **B ·** Danh sách collection: tab `under`, `list.columns` / `filters` / `search`, trạng thái Live / Draft / Archived (`status`), ⋯ Edit / Duplicate / View on website, `labels.add`, chữ trống / đếm; bỏ cột ID | 10–14 | ⏳ |
| M9 | **B ·** `layout: "record"` (mục lục + form + cột On the website / Ready to publish / Duplicate / Hide, `ready`) + bản ghi có preview dùng khung sửa trang; bỏ ô ID / Status / Text tự thêm | 14–20 | ⏳ |
| M10 | **B ·** `layout: "document"` (giấy + thanh định dạng Mr Spa, cover, tiêu đề lớn, cột Post details / In Google / Ready; `plain` cho policy, đếm chữ), hộp Add link (trang hoặc HTTPS); nút ngoài bộ Mr Spa chỉ khi `allow` cần | 12–18 | ⏳ |
| M13 | **B ·** Khối chung: `f.menu` (thẻ link, nhóm dropdown nhiều cấp, ↑ ↓ ⋯ Remove, Opens), link list, ô lấy giá trị từ ô khác ("Phone comes from Header…"), `f.price` cơ bản | 12–18 | ⏳ |
| M14 | **B ·** Plugin admin: module trình duyệt khai trong config (control field riêng, panel riêng trong record / list, luật) được bundle vào `/admin`; ví dụ trong demo | 12–18 | ⏳ |
| P19 | **B ·** Plugin catalog + redirects-check | 16–24 | ⏳ |
| P20 | **B ·** Mr Spa: `cms.config` đầy đủ (chưa bật) | 16–24 | ⏳ |
| P21 | **B ·** Mr Spa: bật gói thay CMS cũ, HTML public giống từng byte | 20–32 | ⏳ |
| P22 | **B ·** Mr Spa: dọn code CMS cũ | 8–15 | ⏳ |

## Ghi chú

- **Review sản phẩm (2026-10-12, NL-DECISION-VIBECMS-001, DESIGN §H.4–H.5):** Innovate và Novelle không có collection
  → phần lõi (Track A) đủ để chuyển Innovate; phần riêng Mr Spa (Track B) để sau site cài mới đầu tiên (Track C:
  Modern Nails Lounge, đang live, chưa có CMS). SonLe: 12 tháng tới phục vụ các site hiện có + khách salon của Mr Spa.
  Chỉ số: số CMS chép còn lại (2 → 0), số màn y chang / 32, số lần chủ tiệm tự publish, thời gian tới publish đầu của site mới.

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
- **Preview trong e2e (P9):** pane cạnh form (1280 px), trang chủ demo thật trong iframe: gõ từng phím vào tagline →
  trang đổi ngay, không tải lại, mỗi phím < 16 ms; tên tiệm gắn bằng `bind` selector; focus field → khung + chip
  "Contact & hours · Address › Street"; bấm số điện thoại trên trang → form focus đúng ô; link ngoài + form không chạy;
  footer (list lồng nhau) thêm / bớt / đổi chỗ theo form; dịch vụ sửa và dịch vụ mới hiện trong list; bấm footer từ
  trang dịch vụ → mở Salon info đúng field; bài blog: thân Markdown + ảnh đã đổi cỡ hiện trên trang bài.
- **Kế hoạch P12–P18 viết lại (2026-10-12):** 2 site pilot đã tự chép CMS của site đầu tiên vào (mỗi bản ~10k dòng) trong
  lúc gói được làm → không còn "cài mới" mà là thay một CMS đang chạy. Nguyên tắc (SonLe): gói **cắm vào web nào cũng
  dùng được, tuỳ biến dễ (config + plugin, không sửa lõi theo site), nâng phiên bản là site nâng theo**. Vì vậy các thứ
  bản chép có mà gói thiếu được làm thành tuỳ chọn / plugin chung (P12b–P12f) trước khi chuyển site nào.
- **P12b:** `test/structure.test.mjs` — config, `checkFixedLists` (thêm / bớt / đổi chỗ / thay id; list không cố định bên
  trong item; item mới), API thật (owner cũng bị chặn list cố định khi lưu và lại khi publish — nháp lưu trước khi list
  thành cố định bị từ chối lúc publish, audit `failed`, không commit; collection cố định không thêm bản ghi; mục chỉ
  owner: editor không thấy trong overview / nháp / boot, 403 + 1 dòng audit khi lưu / publish), `/activity` (editor 403,
  bộ lọc, 50 / trang + `before`, tên người + nhãn mục), admin trên DOM giả, audit D1 bằng SQL thật (node:sqlite + migration).
- **P12f:** `test/image-adjust.test.mjs` — hình học (`cropRect`, `outputSize`: preset, thu nhỏ, giữ trong ảnh, tối đa 2400 px),
  bảng chọn ảnh trên DOM giả (canvas thay bằng hàm giả): Square + bề rộng 800 → cắt đúng điểm ảnh của bản gốc, tên theo bản
  gốc, tải lên, chọn bản mới; lỗi → không tải / không chọn, nói rõ, thử lại được. e2e (Chrome headless, **canvas thật**): ảnh
  Sam 2400 × 1200 → Square → ảnh mới giải mã ra đúng 1200 × 1200, bản gốc vẫn trong thư viện, publish chỉ đưa bản được dùng.
- **P12e:** `test/legacy.test.mjs` — CLI chạy wrangler giả trên file SQLite thật (`test/helpers/sqlite-wrangler.mjs`):
  bảng `cms_users` / `cms_auth_state` đúng schema của site đầu tiên, hash tạo bằng đúng hàm của nó; dry-run không ghi gì;
  ánh xạ (admin → owner, disabled, phải đổi mật khẩu tạm, `legacy_id`, `session_version`, hash giống từng byte), bootstrap
  đánh dấu đã dùng, audit; **đăng nhập bằng mật khẩu cũ qua code đăng nhập thật của gói**; từ chối (đích đã có người, nguồn
  đã là Vibe CMS, hash lạ, đích chưa migrate). `install:local` thêm bước trên wrangler THẬT: D1 "CMS cũ" → D1 mới →
  Worker đã build đăng nhập bằng mật khẩu cũ.
- **P12d:** `test/field-types.test.mjs` (dữ liệu bịa theo dạng menu tiệm thật: danh mục cố định, dịch vụ `[tên, giá]`, giá khoá):
  config, giá trị tuple / pattern / tokens, ô khoá + list cố định + lọc rich text vào trong tuple, `rules` lúc build (đọc
  file khác, cảnh báo, hàm ném lỗi) và trong API (422 kèm lời của luật), admin trên DOM giả, tóm tắt thay đổi theo từng
  chỗ. Site demo có 1 luật (`price` bắt đầu bằng `$`): e2e gõ "40" → bị từ chối cạnh ô Price **trong Worker đã build**.
  Tách khỏi P12d (chỉ Innovate cần): field "chữ hoặc tham chiếu" + ảnh theo tên manifest → P12g.
- **P12c:** `test/history.test.mjs` — GitHub giả có thêm `GET /commits?path=` (chỉ commit đổi file đó, như GitHub): lịch sử file
  (publish CMS + sửa trong code, commit file khác không hiện, tên người từ dòng `By:`), bản ghi trong JSON chung (commit của
  bản ghi khác không hiện), so bản, khôi phục → publish → file về đúng từng byte, từ chối (giống live, đã có nháp → hỏi,
  config hiện tại không nhận, bản ghi chưa có), editor 403; admin trên DOM giả. e2e +3 check (History trên Chrome thật).
  Một lần e2e local đỏ ở check có sẵn "after publishing: Publishing…" (canh giờ), 3 lần chạy sau đều xanh.
- **CLI (P11):** `test/cli.test.mjs` chạy `setup` với wrangler GIẢ (`test/helpers/fake-wrangler.mjs`, account trong file
  JSON): lần 1 tạo D1 / KV / R2 + ghi 5 binding + 5 migration; lần 2 không tạo gì, `wrangler.jsonc` giống từng byte;
  `--account` khác → mọi lệnh chạy ở account đó, id đổi theo, tên + rate limit giữ; binding trỏ site khác → từ chối,
  không chạy gì trên Cloudflare; chưa đăng nhập → báo `wrangler login`, không ghi file. `npm run install:local`
  (scripts/install-local.mjs) cài site demo TỪ ĐẦU theo README bằng URL release trên 127.0.0.1 (`npm pack` của
  checkout), không token (npm user config rỗng, không biến npm_* / NODE_AUTH_TOKEN): `npm i <URL>` → `setup --local`
  ×2 → `check` → build → `wrangler dev`: owner bootstrap đăng nhập → `reset-owner-password` (mật khẩu cũ 401, mật
  khẩu tạm 200 + phải đổi) → `export` / `import` vào D1 mới khớp từng bảng (import lần 2 bị từ chối) → `update`
  (latest từ GitHub API giả) lên X.Y.(Z+1), in "Site action"; bản không có → không đổi gì. Chưa chạy với Cloudflare
  thật (không có account trong test): lần đầu là P15 — `wrangler r2 bucket list` không có dạng JSON nên CLI đọc dòng
  `name:`; nếu wrangler đổi cách in, `setup` sẽ báo tạo bucket "already exists" chứ không hỏng dữ liệu.
- **Phiên bản astro / adapter khi cài site:** để npm tự lấy bản mới nhất của `astro@^7.2.1` + `@astrojs/cloudflare@^14.2.1`
  (2026-10-11) thì build lỗi (adapter gọi `beginContentEntryCollection`, astro đã cài không có) → test cài ghim đúng
  bản trong lockfile của gói (astro 7.3.5, adapter 14.3.3, wrangler 4.142.0). P12–P18: site ghim cùng các bản này.
- **CI:** repo công khai (2026-09-28) → phút GitHub Actions không tính phí. Thực tế **~1 phút / lần** (job `check` 33 giây
  ở run 36372154008; job `secrets` quét gitleaks toàn lịch sử vài giây). Nếu repo về private: 2.000 phút / tháng ≈ 1.500+
  lần chạy.
- **Phân phối:** GitHub Release `vX.Y.Z` + `vibe-cms-X.Y.Z.tgz` (workflow `release.yml` khi push tag), site cài bằng URL
  công khai — không token. **Bản đầu tiên: v0.19.0** (SonLe duyệt 2026-10-12, để Novelle cài từ URL release ở P13).
- **Auth local (P6):** `npm run auth:local` chạy wiring production (`createSiteRuntime`) trong `wrangler dev --local` với D1 +
  KV + rate limit giả lập và GitHub giả: bootstrap, People, publish bằng đăng nhập thật, đo CPU băm mật khẩu.
- **API local (P5):** `npm run api:local` chạy API trong Worker (`test/api-worker`, `wrangler dev --local`, D1 local) và
  publish sang GitHub GIẢ LẬP trên 127.0.0.1 (`test/helpers/fake-github.mjs`) — không đụng repo thật nào.
- **Store local:** `npm run store:local` áp `migrations/` bằng `wrangler d1 migrations apply --local` rồi chạy Worker thử
  (`test/store-worker`) trong `wrangler dev --local` với D1 giả lập — không tài nguyên Cloudflare, dữ liệu ở thư mục tạm.
- **Binding adapter:** `IMAGES` không dùng (`imageService: "compile"`, smoke kiểm `wrangler.json` không có `images`);
  `SESSION` (KV) để P6 khai `<site>-session`.
