<!-- Chép từ mrspainc.com/docs/cms-package/U16B-DESIGN.md (U16b-plan v2, commit fca9286) cho repo gói. -->
> **Chỉnh đã chốt sau v2 (SonLe, 2026-09-28):** repo gói `sonle282/vibe-cms` (private); tên npm theo GitHub Packages
> `@sonle282/vibe-cms` (thay `@sonle/site-cms`); integration `vibeCms()`, CLI `vibe-cms`. Novelle deploy tự động bằng
> Cloudflare Workers Builds từ nhánh `dev`. Innovate: đã xử lý xong các thay đổi chưa commit trên máy. Đích triển khai
> duy nhất: Cloudflare Workers (static assets + `@astrojs/cloudflare`). Tiến độ: [TRACKER.md](TRACKER.md).

# U16b — Gói CMS tự xây dùng chung cho các site của SonLe (thiết kế v2)

> Plan 004 · U16b-plan v2 (chỉ thiết kế; KHÔNG sửa code, KHÔNG deploy, KHÔNG publish, KHÔNG tạo repo / tài nguyên).
> Soạn 2026-09-28. v1 (so sánh CMS thuê ngoài) đã review: **SonLe chốt KHÔNG dùng CloudCannon / Tina / Keystatic / CMS
> thuê ngoài**; CloudCannon chỉ là mẫu tham khảo. Mục tiêu: tự build **gói CMS dùng chung**, cài được vào nhiều site
> (Innovate Salon, Novelle Spa, Mr Spa; sau này bán cho tiệm khác). Phần so sánh cũ ở Phụ lục "Đã xét, không chọn".
>
> Quyết định của SonLe (bổ sung 2026-09-28): nhánh deploy thật Innovate = `main`, Novelle = `dev` — CMS publish commit
> thẳng vào đó (= production), nên G.2 các site này giữ quy tắc publish → kiểm → trả lại như Mr Spa. Đợt nâng cấp Innovate
> đã xong. Mỗi tiệm 1–2 người sửa → **chỉ 2 vai trò: owner, editor**. Editor **không** được sửa giá, giờ mở cửa, SĐT
> (+ đề xuất: email, địa chỉ) — khoá trong `cms.config` và **chặn ở server**.
> Bổ sung (2): Innovate + Novelle chạy **chung Cloudflare account với Mr Spa** (`759105f6…`); mỗi site tài nguyên riêng
> `<site>-cms` (D1) / `<site>-media` (R2) / `<site>-session` (KV); `setup` idempotent, chạy lại được ở account khác; có
> quy trình xuất / nhập D1 + R2; xác minh (chỉ đọc) worker nào phục vụ domain — §K; mục "dọn sau" (không xoá) — §K.3.

**Tóm tắt thiết kế:** gói `@sonle282/vibe-cms` là **Astro integration** (npm private). Site `npm i` + thêm vào
`astro.config` + 1 file `cms.config.ts` → gói tự gắn `/admin` và `/api/cms/*`. Form sinh từ schema (thay 25 nhánh
theo trang), 1 API chung theo đường dẫn file (thay 34 route riêng), visual editing / U23 / F-15 / F-16 là phần chung,
catalog Mr Spa biểu diễn bằng field `reference` + `list` có thứ tự; phần thật sự riêng = plugin tuỳ chọn. Mỗi site có
Worker / D1 / R2 / KV riêng, lệnh `setup`. Ước lượng: **lõi + site mẫu 209–316 h**, pilot Innovate **40–62 h**,
Novelle **28–44 h**, chuyển Mr Spa **60–95 h** → tổng **337–517 h** (so với 295–495 h "đóng gói nguyên trạng"), nhưng mỗi
site mới sau đó **~30–45 h** và bảo trì **6–12 h/tháng cho 3 site** (thay vì 10–20) — §H.

---

## 1. Kiểm kê CMS hiện tại (mrspainc.com, commit `b65f921`)

Đếm bằng script (bytes + dòng). Code CMS viết nhiều dòng rất dài, nên **KB phản ánh khối lượng tốt hơn số dòng**.

| Nhóm | Vùng | File | KB | Dòng | Gồm |
|---|---|---:|---:|---:|---|
| Chung | `src/lib/cms`, `lib/cloudflare`, `lib/media` | 56 | 393 | 6.072 | preview bridge + hợp đồng message, change summary lõi, save state, draft index, GitHub commit / source, live version + live reload (F-16), image sheet / field / library, media manager + upload pipeline (R2), link field, repeatable editor, toast / tooltip / tips, auth (password + Access), guards |
| Chung | `src/pages/api/cms` | 12 | 37 | 499 | assets, audit-log, commit, drafts, history, live-version, users |
| Chung | components, admin login, middleware, CSS CMS, migration D1 (5 bảng) | 14 | 169 | 1.839 | khung admin, 1.427 dòng CSS token, audit / users / auth_state / draft_index / media_metadata |
| **Cần cấu hình** | `src/pages/admin/index.astro` | 1 | **459** | 2.996 | toàn bộ màn sửa — **trộn lõi với trang Mr Spa**: 25 nhánh `activePageKey === "…"`, ~411 chỗ nhắc homepage / catalog / product |
| Cần cấu hình | 13 file lib (site-settings, admin-routes, history-resources, live-version, image-places, current-record, draft-index, navigation, unsaved-controls, visual-editing…) + 3 component | 16 | 105 | 1.488 | danh sách tài nguyên, route, tên trường, ảnh bắt buộc — hiện viết cứng cho Mr Spa |
| **Riêng Mr Spa** | lib: homepage / about / faq / services / custom-furniture / policies (registry + binding), catalog (products / categories / collections + productsPage), projects, blogs, menu-cards (header Furniture / Nail Table) | 27 | 151 | 2.244 | mô hình nội dung và giao diện sửa của Mr Spa |
| Riêng Mr Spa | `src/pages/api/cms` (route GET / PUT / publish từng trang, catalog, project, blog) | 34 | 189 | 1.652 | 1 route cho mỗi loại trang — không dùng lại được nguyên dạng |
| Test | `scripts/cms-*` | 48 | 603 | 6.316 | 11 file chỉ cho Mr Spa; 37 file "chung" nhưng phần lớn đọc thẳng dữ liệu / trang Mr Spa (sẽ phải viết lại theo fixture) |
| Ngoài phạm vi CMS nhưng dính | `scripts/redirect-regression-check.mjs`, `category-links-check`, `product-cards-links-check`, data scripts W6–W12 | — | — | — | plugin tuỳ chọn "catalog + redirect" |

**Tổng mã nguồn CMS ≈ 1,5 MB (≈ 16.800 dòng dài) + 0,6 MB test.** Khoảng 40 % là lõi dùng lại được; 60 % viết cứng cho
Mr Spa hoặc trộn lõi với Mr Spa (nhất là `admin/index.astro`). Phân loại lại theo thiết kế mới ở §G.

---

## A. Kiến trúc gói

### A.1 Repo gói (private, ví dụ `sonle282/vibe-cms`)

```
vibe-cms/
├─ package.json                 # "@sonle282/vibe-cms", semver, exports: ".", "./config", "./plugins/*", "./bridge"
├─ CHANGELOG.md
├─ src/
│  ├─ integration.ts            # Astro integration: injectRoute /admin, /admin/[...path], /api/cms/*, /api/auth/*;
│  │                            #   middleware (guard /admin + /api/cms); nạp cms.config; kiểm config lúc build
│  ├─ config/                   # defineCmsConfig, kiểu field, validate config, schema → form model
│  ├─ server/                   # (chạy trong Worker)
│  │  ├─ routes/                # files, collections, publish, discard, history, live-version, assets, users, auth
│  │  ├─ store/                 # đọc nguồn (bundled) + nháp (KV) + draft index (D1)
│  │  ├─ writer/                # ghi JSON giữ nguyên định dạng (json-text-patch) / Markdown frontmatter
│  │  ├─ publish/               # GitHub commit (If-Match sha), audit started / succeeded / failed / denied
│  │  ├─ auth/                  # cms-auth hiện có: password + session KV + bootstrap; vai trò owner / editor
│  │  ├─ locks.ts               # ô khoá theo vai trò — chặn ở server
│  │  └─ media/                 # upload pipeline R2 + staging (lib/media hiện có)
│  ├─ admin/                    # giao diện: shell / rail / toolbar, danh sách, form sinh từ schema, review, People
│  │  └─ fields/                # text, textarea, richText, number, boolean, select, link, image, list, object,
│  │                            #   reference, hours
│  ├─ bridge/                   # preview loader + visual bridge (U23 2 khung, F-15, F-16) + hợp đồng message
│  └─ styles/                   # cms-admin.css (token hiện có)
├─ migrations/                  # D1: 0001 audit … 0005 media (hiện có) + 0006+ khi gói nâng cấp
├─ plugins/
│  ├─ catalog/                  # (Mr Spa) kiểm quan hệ product ↔ category ↔ collection, màn Products page
│  └─ redirects-check/          # (Mr Spa) kiểm _redirects: đích Live, 1 bước 301, không che trang thật
├─ bin/vibe-cms.mjs             # `setup`, `migrate`, `check`, `users` (in lệnh / hướng dẫn, không nhập mật khẩu hộ)
├─ fixtures/demo-site/          # site Astro mẫu (không dùng dữ liệu Mr Spa) — nền của mọi test
└─ test/                        # unit + contract + e2e (Chrome headless) chạy trên fixtures/demo-site
```

### A.2 Ranh giới gói ↔ site

| Của **gói** (nâng cấp theo version) | Của **site** (repo site giữ) |
|---|---|
| Route `/admin`, `/api/cms/*`, `/api/auth/*`; middleware bảo vệ | `cms.config.ts` (schema nội dung, nhãn, ô khoá, repo + nhánh) |
| Form, danh sách, review, publish, lịch sử, People, ảnh | File nội dung (`src/data/*.json`, `src/content/**/*.md`) |
| Preview bridge, khung U23, F-15, F-16 | Template Astro + gắn binding (thuộc tính `data-cms-*` hoặc selector trong config) |
| Migration D1, audit, session, vai trò | `wrangler.jsonc` (binding D1 / KV / R2 riêng site), secret |
| Plugin tuỳ chọn (catalog, redirects-check) | Chọn bật plugin nào; kiểm tra riêng của site |

Điều kiện kỹ thuật: gói cần **route chạy server** → site phải có adapter Cloudflare. Novelle đã `output: 'server'`.
**Innovate đang `output: 'static'`** → giữ static cho mọi trang public (prerender) và thêm `@astrojs/cloudflare` để các
route gói chạy on-demand; worker hiện có của Innovate (`worker/index.js`, form liên hệ gửi mail) phải chuyển thành
route API Astro hoặc bọc quanh worker của adapter — việc này nằm trong pilot (P13).

---

## B. Đặc tả `cms.config`

### B.1 Schema

```ts
// cms.config.ts — site khai; gói kiểm lúc build (lỗi config = build đỏ, nói rõ đường dẫn)
import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

type Locked = "owner";                       // chỉ 1 mức khoá: ô chỉ owner sửa (editor thấy, không sửa)
type FieldBase = {
  label: string; help?: string; required?: boolean;
  locked?: Locked;                           // chặn ở SERVER + khoá trên form
  bind?: string;                             // selector preview nếu template không gắn data-cms-field (xem §D)
};
// Kiểu field (f.*): text | textarea | richText | number | boolean | select({ options }) | link({ allow: ["page","url","tel","mailto"] })
//   | image({ alt: true, mobile?: true, required?: true }) | list(of, { ordered: true, min, max, itemLabel, newItem })
//   | object(fields) | reference({ to: "<collectionKey>", multiple?: true, ordered?: true })
//   | hours() — giờ theo ngày (open / close / đóng cửa) + ngày lễ
//   | date | slug({ from: "name", fixedAfterPublish: true })
type Section = { key: string; label: string; fields: string[] };  // nhóm ô = level 1 của inspector (U15d-2)

export type CmsConfig = {
  configVersion: 1;
  site: { name: string; url: string; timezone?: string };
  repo: { owner: string; name: string; branch: string };   // branch = nhánh production (commit thẳng)
  roles: ["owner", "editor"];                               // cố định — không nhóm / quyền tuỳ biến
  files: Array<{                                            // 1 file = 1 bản ghi (trang, cài đặt site)
    key: string; label: string; path: string; format: "json" | "yaml";
    preview?: string;                                       // đường dẫn trang để xem trước
    sections?: Section[]; fields: Record<string, Field>;
  }>;
  collections: Array<{                                      // nhiều bản ghi
    key: string; label: string; itemLabel: string;
    store: { kind: "json-array"; path: string; idField: string }   // 1 file JSON mảng (vd products.json)
         | { kind: "markdown-dir"; dir: string; slugField: string }; // 1 file .md / bản ghi (blog)
    status?: { field: "status"; live: "published"; draft: "draft" }; // Live / Draft / Archive (#15)
    preview?: string;                                       // "/products/{slug}/"
    fields: Record<string, Field>; order?: "file" | { by: string };
  }>;
  structures?: Record<string, Field>;                       // mẫu dùng lại (vd link menu) — học CloudCannon _structures
  media: { bucketPrefix: string; maxBytes: number; variants?: boolean };
  plugins?: CmsPlugin[];
};
```

Quy tắc lưu (giữ từ Mr Spa): **không sửa gì = giống từng byte; sửa 1 ô = 1 dòng** (writer JSON vá đúng giá trị, giữ
thụt lề / thứ tự khoá / xuống dòng cuối — dùng lại `json-text-patch.ts`); YAML chỉ dùng khi writer giữ định dạng
(khuyên dùng JSON cho site mới).

### B.2 Site mẫu (fixture trong repo gói)

```ts
export default defineCmsConfig({
  configVersion: 1,
  site: { name: "Demo Salon", url: "https://demo.example" },
  repo: { owner: "sonle", name: "demo-site", branch: "main" },
  roles: ["owner", "editor"],
  files: [{
    key: "site", label: "Salon info", path: "src/data/site.json", format: "json", preview: "/",
    sections: [{ key: "contact", label: "Contact", fields: ["phone", "email", "address", "hours"] }, { key: "home", label: "Homepage", fields: ["hero"] }],
    fields: {
      phone: f.text({ label: "Phone", locked: "owner" }),
      email: f.text({ label: "Email", locked: "owner" }),
      address: f.object({ label: "Address", locked: "owner", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }) } }),
      hours: f.hours({ label: "Opening hours", locked: "owner" }),
      hero: f.object({ label: "Banner", fields: { title: f.text({ label: "Heading" }), image: f.image({ label: "Image", alt: true }) } }),
    },
  }],
  collections: [
    { key: "services", label: "Services", itemLabel: "Service", store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
      fields: { name: f.text({ label: "Name", required: true }), price: f.text({ label: "Price", locked: "owner" }), note: f.textarea({ label: "Note" }) } },
    { key: "blog", label: "Blog", itemLabel: "Post", store: { kind: "markdown-dir", dir: "src/content/blog", slugField: "slug" },
      status: { field: "status", live: "published", draft: "draft" }, preview: "/blog/{slug}/",
      fields: { title: f.text({ label: "Title" }), date: f.date({ label: "Date" }), image: f.image({ label: "Cover", alt: true }), body: f.richText({ label: "Text" }) } },
  ],
  media: { bucketPrefix: "demo/", maxBytes: 10_000_000 },
});
```

### B.3 Innovate Salon (main `14edc48`, chỉ đọc)

Hiện nội dung nằm trong `src/data/site.ts` (34 KB TypeScript: `site` — phone / email / address / hours / holidays /
rating…, `services` / `headSpaTiers` (có `price`), `offers`, `faqs`, `reviews`, `articles`, `gallery`), cộng chữ viết
thẳng trong 13 trang. Pilot tách **dữ liệu** ra JSON; hàm (`formatTime`, `formatRange`, `visibleFaqs`…) ở lại TS, đọc từ
JSON — HTML public giống từng byte.

```ts
export default defineCmsConfig({
  configVersion: 1,
  site: { name: "Innovate Salon & Spa", url: "https://innovatesalon.com", timezone: "America/New_York" },
  repo: { owner: "MRSPAINC", name: "innovatesalon.com", branch: "main" },   // main = production (SonLe 2026-09-28)
  roles: ["owner", "editor"],
  files: [{
    key: "salon", label: "Salon info", path: "src/data/salon.json", format: "json", preview: "/contact-us/",
    sections: [
      { key: "contact", label: "Contact & hours", fields: ["phone", "email", "address", "hours", "holidays"] },
      { key: "links", label: "Booking & social", fields: ["bookingUrl", "giftCardUrl", "instagram"] },
    ],
    fields: {
      phone: f.text({ label: "Phone", locked: "owner" }),          // + phoneHref / smsHref suy ra từ phone ở TS
      email: f.text({ label: "Email", locked: "owner" }),
      address: f.object({ label: "Address", locked: "owner", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }), region: f.text({ label: "State" }), zip: f.text({ label: "ZIP" }) } }),
      hours: f.hours({ label: "Opening hours", locked: "owner" }),
      holidays: f.list(f.object({ fields: { date: f.date({ label: "Date" }), closed: f.boolean({ label: "Closed all day" }) } }), { label: "Holiday hours", locked: "owner" }),
      bookingUrl: f.link({ label: "Booking link", allow: ["url"] }),
      giftCardUrl: f.link({ label: "Gift card link", allow: ["url"] }),
      instagram: f.link({ label: "Instagram", allow: ["url"] }),
    },
  }],
  collections: [
    { key: "menu", label: "Service menu", itemLabel: "Menu group", store: { kind: "json-array", path: "src/data/services.json", idField: "id" }, preview: "/service/",
      fields: {
        title: f.text({ label: "Group title" }), intro: f.textarea({ label: "Intro" }),
        items: f.list(f.object({ fields: { name: f.text({ label: "Service" }), price: f.text({ label: "Price", locked: "owner" }), note: f.text({ label: "Note" }) } }), { label: "Services", ordered: true, itemLabel: "Service" }),
        tiers: f.list(f.object({ fields: { name: f.text({ label: "Package" }), price: f.text({ label: "Price", locked: "owner" }), desc: f.textarea({ label: "Description" }) } }), { label: "Packages", ordered: true }),
      } },
    { key: "offers", label: "Offers", itemLabel: "Offer", store: { kind: "json-array", path: "src/data/offers.json", idField: "id" }, preview: "/offers/",
      fields: { title: f.text({ label: "Title" }), price: f.text({ label: "Price", locked: "owner" }), terms: f.textarea({ label: "Terms" }) } },
    { key: "faqs", label: "FAQ", itemLabel: "Question", store: { kind: "json-array", path: "src/data/faqs.json", idField: "id" }, preview: "/faqs/",
      fields: { q: f.text({ label: "Question" }), a: f.textarea({ label: "Answer" }) } },
    { key: "gallery", label: "Gallery", itemLabel: "Photo", store: { kind: "json-array", path: "src/data/gallery.json", idField: "id" }, preview: "/gallery/",
      fields: { image: f.image({ label: "Photo", alt: true }), category: f.select({ label: "Category", options: ["Nails", "Hair", "Head Spa"] }) } },
  ],
  media: { bucketPrefix: "innovate/", maxBytes: 10_000_000 },
});
```

(Tên trường chính xác chốt ở P12 Bước 0 khi đọc hết `site.ts`; `confirm: true` — cờ "chưa xác nhận, không hiện" — giữ
nguyên như một field boolean ẩn chỉ owner thấy.)

### B.4 Mr Spa — chứng minh config mô tả được catalog, trang chủ, header

```ts
export default defineCmsConfig({
  configVersion: 1,
  site: { name: "MR SPA", url: "https://mrspainc.com" },
  repo: { owner: "MRSPAINC", name: "mrspainc.com", branch: "main" },
  roles: ["owner", "editor"],
  structures: {
    link: f.object({ fields: { label: f.text({ label: "Label" }), href: f.link({ label: "Opens", allow: ["page", "url", "tel", "mailto"] }) } }),
  },
  files: [
    { key: "homepage", label: "Homepage", path: "src/data/pages/homepage.json", format: "json", preview: "/",
      sections: [{ key: "hero", label: "Hero", fields: ["hero.slides"] }, { key: "about", label: "Showroom", fields: ["about.title", "about.location", "about.description", "about.image", "about.ctaLabel", "about.ctaHref"] } /* … 8 section như registry hiện tại */],
      fields: {
        "hero.slides": f.list(f.object({ fields: { image: f.image({ label: "Desktop image", mobile: true, alt: true }), title: f.text({ label: "Title" }) } }), { label: "Banners", ordered: true, min: 1, max: 8, itemLabel: "Banner" }),
        "about.title": f.text({ label: "Heading", bind: ".about-intro h2" }),        // binding selector: public HTML không đổi
        "about.location": f.text({ label: "Location line", bind: ".about-location" }),
        "about.ctaLabel": f.text({ label: "Button label", bind: ".about-intro a.button" }),
        "about.ctaHref": f.link({ label: "Button destination" }),
        /* … */
      } },
    { key: "site", label: "Across the whole site", path: "src/data/site-settings.json", format: "json",
      sections: [{ key: "header", label: "Header", fields: ["header.phone", "header.primaryLinks", "header.furnitureGroups", "header.nailTableLinks"] }],
      fields: {
        "header.phone": f.text({ label: "Phone", locked: "owner" }),
        "header.primaryLinks": f.list("link", { label: "Menu links", ordered: true, min: 4, max: 4 }),
        "header.furnitureGroups": f.list(f.object({ fields: { title: f.text({ label: "Group title" }), links: f.list("link", { ordered: true, itemLabel: "Link" }) } }), { label: "Furniture dropdown", ordered: true, max: 3 }),
        "header.nailTableLinks": f.list("link", { label: "Nail table submenu", help: "Shows under the link that opens /category/nail-table.", ordered: true }),
      } },
  ],
  collections: [
    { key: "products", label: "Products", itemLabel: "Product", store: { kind: "json-array", path: "src/data/catalog/products.json", idField: "id" },
      status: { field: "status", live: "published", draft: "draft" }, preview: "/products/{slug}/",
      fields: {
        name: f.text({ label: "Name", required: true }), slug: f.slug({ from: "name", fixedAfterPublish: true }),
        priceLabel: f.text({ label: "Price", locked: "owner" }),
        categoryIds: f.reference({ to: "categories", multiple: true, label: "Categories" }),
        collectionIds: f.reference({ to: "collections", multiple: true, label: "Collections" }),
        gallery: f.list(f.image({ alt: true }), { label: "Photos", ordered: true }),
        "seo.description": f.textarea({ label: "Search description" }),
      } },
    { key: "categories", label: "Categories", itemLabel: "Category", store: { kind: "json-array", path: "src/data/catalog/categories.json", idField: "id" }, order: "file",
      fields: {
        name: f.text({ label: "Name" }), slug: f.slug({ from: "name", fixedAfterPublish: true }), description: f.textarea({ label: "Description" }),
        productsPage: f.object({ label: "On the Products page", fields: {
          productIds: f.reference({ to: "products", multiple: true, ordered: true, label: "Products, in page order" }),   // Divider: T16AT, T11
          groups: f.list(f.object({ fields: { label: f.text({ label: "Filter label" }), productIds: f.reference({ to: "products", multiple: true, ordered: true }) } }), { label: "Sub-groups" }),
        } }),
      } },
    { key: "collections", label: "Collections", itemLabel: "Collection", store: { kind: "json-array", path: "src/data/catalog/collections.json", idField: "id" },
      fields: { name: f.text({ label: "Name" }), hideOnProductsPage: f.boolean({ label: "Hide on the Products page" }) } },
    /* projects, blogs, policies, service pages: tương tự */
  ],
  media: { bucketPrefix: "mrspa/", maxBytes: 10_000_000, variants: true },
  plugins: [catalogPlugin(), redirectsCheck({ file: "public/_redirects" })],   // phần thật sự riêng
});
```

Kết luận: catalog (quan hệ + thứ tự + ẩn), trang chủ (section + list banner + binding selector), header (menu lồng nhau)
đều biểu diễn được bằng field chung. Phần **không** biểu diễn được bằng schema và thành plugin: (1) kiểm chéo toàn catalog
khi publish (product Live phải thuộc ≥ 1 productsPage; id = slug; reference tới bản ghi Draft); (2) màn "On the Products
page" gộp nhiều category (UI tiện hơn form chung); (3) kiểm `_redirects` (đích Live, 1 bước 301).

---

## C. Hợp đồng API chung + luồng publish / audit

Mọi route dưới `/api/cms`, JSON, `cache-control: no-store`; middleware: phiên hợp lệ + Origin cùng site cho mọi ghi.

| Method + route | Việc | Trả về / lỗi |
|---|---|---|
| `GET /api/cms/schema` | cấu hình cho admin (không có secret) | 200 |
| `GET /api/cms/files/:key` | nguồn + nháp của người đang đăng nhập | `{ content, sourceContent, sourceVersion, hasDraft, stale }` + header `x-cms-live-version` (F-16) |
| `PUT /api/cms/files/:key` | lưu nháp (KV) + draft index (D1) | 409 nguồn đã đổi; 422 sai schema; **403 `locked_field`** nếu editor đổi ô khoá |
| `DELETE /api/cms/files/:key` | bỏ nháp | 200 |
| `POST /api/cms/files/:key/publish` | xem luồng dưới | `{ commitSha, expectedLiveVersion }`; 409 / 422 / 403 / 502 |
| `GET·PUT·DELETE /api/cms/collections/:key/:id` + `POST …/new` + `…/:id/publish` + `…/:id/archive` | như trên cho 1 bản ghi | như trên; archive = đổi `status` (không xoá) |
| `GET /api/cms/live-version?resource=` | version đang live (+ build GitHub check) | như hiện tại |
| `GET /api/cms/history?resource=` · `POST /api/cms/history/restore-draft` | lịch sử commit, khôi phục thành nháp | như hiện tại |
| `POST /api/cms/assets` | upload ảnh → R2 staging | như hiện tại |
| `GET·POST /api/cms/users` · `PATCH /api/cms/users/:id` | People — **chỉ owner** | 403 với editor |
| `POST /api/auth/login` · `/logout` | phiên | như hiện tại |

**Luồng publish (1 luồng cho mọi file / bản ghi):**
1. Kiểm phiên, Origin, rate limit → ghi audit **`started`** (không ghi được → từ chối publish, như F-16).
2. Đọc nháp; so `sourceVersion` với nguồn trên nhánh (`repo.branch`) → khác = 409.
3. Kiểm schema (kiểu, bắt buộc, min / max, reference tồn tại, slug cố định) + plugin `validate` (vd catalog).
4. **Kiểm ô khoá**: so nháp với nguồn theo từng đường dẫn `locked`; editor + có ô khoá đổi → 403 `locked_field`
   `{ fields: [...] }`, audit **`denied`** (resource + tên ô, không ghi giá trị).
5. Writer vá JSON / frontmatter → kiểm "chỉ các dòng của ô đã đổi thay đổi" (không sửa = giống từng byte).
6. GitHub: `PUT contents` với sha cũ (If-Match), message `cms: publish <label>`; lỗi → audit `failed` + 502.
7. Audit **`succeeded`** (resource, sourceVersion, commitSha); xoá nháp + draft index; trả `expectedLiveVersion`.
8. Client theo dõi build + `live-version`; tải lặng chỉ nhận response có `x-cms-live-version` khớp (F-16).

Ô khoá cũng áp cho `PUT` nháp (chặn sớm) — nhưng **publish vẫn kiểm lại** (nháp có thể được sửa bằng tay qua KV / cũ hơn).

---

## D. Hợp đồng visual editing

**Gắn binding (2 cách, site chọn):**
- Thuộc tính trong template: `data-cms-field="salon.phone"`, danh sách `data-cms-list="menu.items"` + mỗi item
  `data-cms-item-index="2"`, section `data-cms-section="contact"`, link `data-cms-field-href`, ảnh `data-cms-field-alt`.
- Selector trong config (`bind: ".about-intro h2"`) — bridge gắn thuộc tính lúc chạy trong preview.

⚠ **Chỗ reviewer đề xuất cần cân nhắc:** gắn `data-cms-*` thẳng vào template **làm đổi HTML public 1 lần** (mọi trang có
binding) — trái tiêu chí "HTML public giống từng byte" của pilot. Phương án: pilot Innovate dùng **selector trong config**
(giống `homepageVisualBindings` của Mr Spa) → HTML public không đổi; thuộc tính `data-cms-*` chỉ dùng cho site mới làm từ
đầu hoặc khi chủ chấp nhận đổi HTML 1 lần (ghi rõ trong task). Tương tự, **preview loader** (script nhỏ inline) phải có
trên mọi trang để trang biết mình đang trong khung CMS — Mr Spa đã có (`VisualBridge.astro`); với Innovate / Novelle việc
thêm loader là **1 lần đổi HTML có chủ đích** (khoảng 1 KB script, không làm gì ngoài CMS) → cần chủ duyệt (§J).

**Thông điệp bridge** (giữ `visual-contract.ts`, kênh `postMessage` cùng origin + token preview):
admin → preview: `SECTION_MAP` (section + nhãn field / item cho chip U23), `LOAD_DRAFT`, `UPDATE_FIELD` (không bao giờ
post ngược FIELD_SELECTED — F-15), `SCROLL_TO_FIELD` (`scrollOnly`, `itemIndex`, `section`), `CLEAR_SELECTION`,
`HIGHLIGHT_SITE`; preview → admin: `EDITOR_READY` (danh sách field theo thứ tự trang), `FIELD_SELECTED` (chỉ khi người
bấm trong preview), `DRAFT_APPLIED`. Khung: field 2 px + chip "Section · Field", section 1 px nhạt, hover nét đứt cấp
phần tử (U23); vẽ lại theo khung hình, không transition vị trí (F-15). Tất cả là **phần chung của gói**.

---

## E. Cài site mới + nâng cấp gói

### E.1 Cài (ví dụ Innovate; người làm: SonLe + Claude, chủ tiệm chỉ nhận tài khoản)

| # | Bước | Ai | Thời gian |
|---|---|---|---|
| 1 | Kiểm repo site: `git status` sạch, pull nhánh production; có thay đổi lạ → DỪNG hỏi | Claude | 5 phút |
| 2 | Tách nội dung ra JSON (HTML public giống từng byte) | Claude | 6–16 h (tuỳ site) |
| 3 | `npm i @sonle282/vibe-cms` (npm private: token đọc registry do SonLe cấp), thêm vào `astro.config`, thêm adapter nếu site static | Claude | 1–4 h |
| 4 | Viết `cms.config.ts` + binding (selector) + ô khoá; `vibe-cms check` xanh | Claude | 4–10 h |
| 5 | `vibe-cms setup --site innovate`: tạo (nếu chưa có) D1 `innovate-cms`, R2 `innovate-media`, KV `innovate-session`, chạy migration, ghi binding vào `wrangler.jsonc` — xem §K.2 | SonLe chạy (Claude soạn) | 30 phút |
| 6 | GitHub: tạo token / cài app **chỉ cho đúng 1 repo** (contents RW, metadata R, checks R); `wrangler secret put CMS_GITHUB_TOKEN` | SonLe | 15 phút |
| 7 | Secret bootstrap `CMS_BOOTSTRAP_USERNAME` / `CMS_BOOTSTRAP_PASSWORD` → đăng nhập lần đầu tạo **owner** (chỉ chạy 1 lần, sau đó bị khoá bởi `cms_auth_state`) | SonLe | 10 phút |
| 8 | Owner tạo **editor** ở màn People (mật khẩu tạm 19 ký tự, đổi lần đầu — như Mr Spa); xoá secret bootstrap | Owner | 5 phút |
| 9 | Deploy; G.2 1 cặp (publish → kiểm → trả lại) + thử editor sửa ô khoá bị từ chối | Claude + SonLe | 1–2 h |

Tổng mỗi site mới: **~20–35 h** kỹ thuật (bước 2–4, 9) + ~1 h SonLe.

### E.1b Bàn giao / bán: chuyển 1 site sang account Cloudflare khác

1. Ở account mới: `vibe-cms setup --site <site> --account <id mới>` (idempotent — tạo tài nguyên cùng tên, migration).
2. **D1:** `wrangler d1 export <site>-cms --remote --output <site>-cms.sql` (account cũ) →
   `wrangler d1 execute <site>-cms --remote --file <site>-cms.sql` (account mới); so số dòng từng bảng
   (`cms_users`, `cms_audit_log`, `cms_draft_index`, `cms_media_metadata`, `cms_auth_state`).
3. **R2:** chép mọi object `<site>-media` sang bucket mới (rclone / script S3 API với khoá R2 chỉ đọc bên nguồn, chỉ ghi
   bên đích); so số object + tổng byte + checksum mẫu.
4. **KV:** không chuyển (phiên + nháp tạm) — báo người dùng lưu nháp trước; đăng nhập lại sau bàn giao.
5. Secret đặt lại ở account mới (GitHub token của repo đó, không có bootstrap vì D1 đã có owner).
6. Đổi custom domain sang worker mới; kiểm HTML public giống từng byte + G.2 1 cặp; xoá tài nguyên ở account cũ chỉ khi
   chủ cho phép rõ.

### E.2 Nâng cấp gói

- **Semver**: patch = sửa lỗi; minor = thêm tính năng, không đổi config / dữ liệu; major = đổi `configVersion` hoặc
  cần migration không tự động. CHANGELOG ghi "cần làm gì ở site".
- Site ghim version (`"@sonle282/vibe-cms": "~1.4.0"`); nâng từng site một, site nhỏ trước.
- Migration D1 nằm trong gói (`migrations/0006_…`), `vibe-cms migrate` áp dụng (chỉ thêm bảng / cột, không xoá dữ liệu;
  xoá cần lệnh riêng do SonLe chạy).
- Đổi schema nội dung: `configVersion` mới + codemod `vibe-cms migrate-config`; `vibe-cms check` phải xanh trước deploy.
- Kiểm trước khi nâng: test gói xanh trên fixture; ở site: `vibe-cms check` (config ↔ dữ liệu, round-trip giống từng byte)
  + so HTML public trước ↔ sau (local ↔ local) + G.2 1 cặp.

---

## F. Bảo mật

- **GitHub:** mỗi site 1 token fine-grained **chỉ cho 1 repo** (contents read / write, metadata read, checks read) hoặc
  GitHub App cài riêng từng repo; không dùng token cấp tổ chức; token hết hạn tối đa 1 năm → nhắc gia hạn trong CMS
  (owner thấy cảnh báo trước 14 ngày). Không cấp thêm quyền cho token hiện có của Mr Spa.
- **Secret:** chỉ qua `wrangler secret put` (GitHub token, bootstrap); không bao giờ trong repo / `cms.config` /
  `/api/cms/schema`. Bootstrap xoá sau khi tạo owner.
- **Vai trò:** owner (sửa mọi ô, People, publish) · editor (sửa + publish nội dung **trừ ô `locked: "owner"`**). Khoá
  chặn ở server (PUT + publish), audit `denied`, có test. Khoá mặc định cho mọi site: **giá, giờ mở cửa, SĐT, email, địa
  chỉ**.
- **Cloudflare chung account (rủi ro + giảm):** API token Cloudflare **không khoá được theo từng worker** — quyền
  "Workers Scripts: Edit" / D1 / R2 áp cho cả account, nên 1 token deploy lộ ra có thể sửa worker / dữ liệu **của cả 3
  site**. Giảm: (1) **CMS chạy trong Worker không cần token Cloudflare nào** — chỉ dùng binding (binding chỉ trỏ tài nguyên
  của đúng site, kiểm bằng `vibe-cms check`: tên binding phải là `<site>-*`); (2) deploy bằng **Workers Builds từ GitHub**
  (Cloudflare tự build, không cần token deploy nằm ngoài); (3) token tay (setup, xuất D1) tạo **ngắn hạn**, quyền tối
  thiểu (D1 Edit / R2 Edit / Workers KV Edit / Workers Scripts Edit, account này, hết hạn 1 ngày), xoá sau khi dùng;
  (4) R2: nếu cần khoá S3, dùng khoá R2 giới hạn **theo bucket** (R2 cho phép), chỉ đọc khi xuất; (5) người vào dashboard
  chỉ SonLe; tiệm không có quyền account — khi bán / bàn giao thì chuyển sang account riêng (§E.1b).
- **Tách dữ liệu giữa site:** Worker / D1 / KV / R2 riêng từng site (tên `<site>-cms` / `<site>-media` / `<site>-session`); cookie phiên tên theo site
  (`<site>_cms_session`), cùng domain site; không có đăng nhập chung giữa các site; repo riêng; token riêng.
- **Giữ các biện pháp Mr Spa đang có:** hash mật khẩu, session version (đổi mật khẩu = đăng xuất mọi nơi), rate limit
  publish / đăng nhập, Origin check, sanitizer rich text, giới hạn kích thước file, kiểm link an toàn.

---

## G. Phân loại lại kiểm kê theo thiết kế mới

| Đích | File hiện tại (mrspainc.com) | KB (≈) |
|---|---|---:|
| **Lõi gói — dùng lại gần như nguyên** | visual-bridge, visual-contract, preview-loader / reveal / scroll, live-reload, live-version (tổng quát hoá danh sách), github-commit / source, git-target, publish-build / errors / wait, audit-log, draft-index, save-state, unsaved-controls, json-text-patch, cms-validation, rich-text-sanitizer, source-size, toast / tooltip / tips, link-control / field, repeatable-editor, image-field / sheet / library / drop / change / browser, media-picker, media-library, `lib/media/*`, `lib/cloudflare/*` (auth, guards, env), components/cms (shell / rail / toolbar), cms-admin.css, migrations 0001–0005, middleware, API: assets, audit-log, drafts, history, live-version, users, auth | ≈ 600 |
| **Lõi gói — viết lại theo schema** | `admin/index.astro` → form sinh từ schema + router; cms-change-summary (tổng quát từ schema), current-record, admin-routes, cms-navigation, list-screen, record-editor, inspector-sections (section từ config), history-resources, image-places / labels / required-images (từ field image) | ≈ 560 → mới ~250 |
| **Bỏ — thay bằng `cms.config`** | registry + source từng trang: homepage / about / faq / services / services-index / custom-furniture / policies / site-settings (-schema, -visual-editing, site-form), list-visual-editing, projects, blogs (+ blog-editor / review / compatibility), catalog-products / categories / collections (phần model), product-editor / images, project-editor, policy-editor; **34 route riêng** | ≈ 340 |
| **Plugin Mr Spa** | catalog: kiểm chéo catalog + màn Products page (U20b) + slug = id; redirects-check (`redirect-regression-check.mjs`), category-links-check, product-cards-links-check; menu-cards (thẻ Header gọn cho menu lồng nhau — có thể thành field `list` chung, giữ plugin nếu UI chung chưa đủ) | ≈ 60 |
| **Test** | viết lại trên `fixtures/demo-site` (hợp đồng, form, publish, khoá, bridge, F-15/F-16/U23); test Mr Spa chuyển thành test plugin + test cấu hình Mr Spa | 600 → mới ~300 |

---

## H. Ước lượng giờ theo thiết kế mới + rủi ro

Phạm vi gọn theo quyết định 2026-09-28: 2 vai trò cố định, tái dùng đăng nhập / session / bootstrap Mr Spa, không
nhóm / quyền tuỳ biến / hệ thống mời.

| Phần | Giờ |
|---|---:|
| Lõi gói + site mẫu (P1–P11) | **209 – 316** |
| Pilot Innovate (P12–P15) | **40 – 62** |
| Novelle (P16–P18) | **28 – 44** |
| Mr Spa chuyển sang gói (P19–P22) | **60 – 95** |
| **Tổng** | **337 – 517** |

So với ước lượng v1 "đóng gói nguyên trạng" **295 – 495 h**: tổng tương đương (+~10 %) vì phải dựng lõi schema-driven
đúng nghĩa, nhưng: (1) **site mới sau đó ~20–35 h** (v1: 40–100 h / site vì phải chép + sửa route / registry); (2) bảo
trì **6–12 h/tháng cho 3 site** (v1: 10–20) vì 1 lõi, không có code theo trang; (3) Mr Spa chuyển **sau cùng** — không
có rủi ro cho Mr Spa trong ~250 h đầu; (4) mốc có giá trị sớm: lõi + Innovate ≈ **249 – 378 h**.

**Rủi ro:**
1. Form sinh từ schema kém hơn màn riêng Mr Spa (Products page, Header cards) → giữ khả năng plugin có màn riêng.
2. Innovate static → thêm adapter + gộp worker form liên hệ; đổi cách deploy (`wrangler deploy` hiện tại) — thử trên
   preview trước.
3. HTML public: binding bằng thuộc tính / preview loader đổi HTML — giải bằng selector + 1 lần đổi loader có chủ đích (§D).
4. Chạy song song 2 CMS (Mr Spa cũ + gói) trong nhiều tháng → sửa lỗi 2 nơi; giữ CMS Mr Spa "đóng băng tính năng".
5. Writer giữ định dạng cho YAML / Markdown frontmatter khó hơn JSON → ưu tiên JSON; Markdown chỉ cho blog.
6. Phụ thuộc 1 người hiểu code → tài liệu + test hợp đồng trên fixture là bắt buộc từng task.
7. Commit thẳng nhánh production (Innovate `main`, Novelle `dev`) → G.2 luôn publish → kiểm → trả lại; mỗi publish là
   deploy thật.

---

## I. Task (1 task = 1 commit; mỗi task: REPORT → DỪNG)

Tiền tố P. Test của gói **không đọc dữ liệu Mr Spa**. Task có sửa repo site: đầu task `git status` sạch + pull nhánh
production (Innovate `main`, Novelle `dev`); có thay đổi lạ → DỪNG hỏi.

| Task | Việc | Giờ | Xong khi | Cách kiểm |
|---|---|---:|---|---|
| **P1** | Repo gói + khung integration (injectRoute, middleware, nạp + kiểm `cms.config`) + `fixtures/demo-site` | 16–24 | demo-site build, `/admin` trả trang trống có đăng nhập | test integration; build 0 lỗi |
| **P2** | Kiểu config + `defineCmsConfig` + kiểm config (lỗi nói rõ đường dẫn) | 12–18 | config sai → build đỏ đúng chỗ | unit test ≥ 30 ca |
| **P3** | Store: đọc nguồn bundled + nháp KV + draft index D1; writer JSON giữ định dạng | 16–24 | round-trip demo: không sửa = giống từng byte, 1 ô = 1 dòng | test round-trip mọi kiểu field |
| **P4** | Ô khoá theo vai trò ở server (PUT + publish) + audit `denied` | 8–12 | editor đổi ô khoá → 403 + audit; owner được | test API (≥ 8 ca: ô trong object / list / collection) |
| **P5** | API chung files / collections + publish GitHub + audit started / succeeded / failed + header version (F-16) | 24–34 | demo publish qua GitHub giả lập | test hợp đồng §C + mock GitHub |
| **P6** | Auth + People tái dùng Mr Spa (owner = admin cũ, editor), bootstrap, session tên theo site | 8–12 | tạo owner bằng bootstrap, owner tạo editor | test auth + People |
| **P7** | Admin shell + danh sách + form sinh từ schema (text…object, list có thứ tự, reference, hours) | 40–60 | sửa mọi field demo-site | test form (DOM giả) + e2e Chrome headless |
| **P8** | Review / change summary từ schema + Save → review → Publish + trạng thái Live (#15, F-16) | 20–30 | luồng đủ trên demo | e2e + test change summary |
| **P9** | Bridge chung: binding thuộc tính + selector, SECTION_MAP từ config, U23, F-15 | 16–24 | demo preview: chọn / hover / focus đúng, 0 render khi gõ | test bridge (DOM giả) + đo F-15 |
| **P10** | Ảnh: upload R2 staging, sheet chọn ảnh, alt, variants tuỳ chọn | 16–24 | đổi ảnh demo + publish | test upload pipeline |
| **P11** | CLI `vibe-cms setup` (idempotent, `--account`, tên `<site>-cms/-media/-session`) / `migrate` / `check` / `export` (D1 + R2) + semver + CHANGELOG + tài liệu cài | 16–24 | cài demo-site từ đầu theo tài liệu; chạy `setup` lần 2 = không đổi gì | chạy thử local (miniflare); xuất / nhập D1 demo khớp số dòng |
| **P12** | Innovate Bước 0 (chỉ đọc main) + tách `site.ts` → JSON (HTML public giống từng byte) | 10–16 | build + test Innovate pass | so `dist` trước ↔ sau (local ↔ local) |
| **P13** | Innovate: adapter Cloudflare cho route gói, gộp worker form liên hệ, trang public vẫn prerender | 8–14 | form liên hệ vẫn gửi; trang public giống từng byte | so HTML + thử form trên preview |
| **P14** | Innovate: cài gói + `cms.config` + binding selector + ô khoá (giá, giờ, SĐT, email, địa chỉ) | 10–16 | sửa được mọi mục chủ cần; editor bị chặn ô khoá | `vibe-cms check`, test khoá, HTML public không đổi (trừ loader nếu chủ duyệt) |
| **P15** | Innovate: setup tài nguyên + token 1 repo + owner / editor + G.2 1 cặp trên `main` | 8–12 | publish → live đổi → trả lại; cây repo về như cũ | G.2 + audit D1 |
| **P16** | Novelle Bước 0 (chỉ đọc dev) + tách `site.ts` → JSON; blog Markdown giữ nguyên | 8–12 | HTML giống từng byte | so `dist` |
| **P17** | Novelle: cài gói + config + binding + ô khoá (SSR sẵn) | 10–16 | như P14 | như P14 |
| **P18** | Novelle: setup + G.2 1 cặp trên `dev` | 8–12 | như P15 | như P15 |
| **P19** | Plugin catalog (kiểm chéo + màn Products page) + redirects-check trong gói | 16–24 | test plugin trên fixture catalog nhỏ | test plugin |
| **P20** | Mr Spa: `cms.config` đầy đủ (trang, site settings, catalog, projects, blog, policies, service pages) — chưa bật | 16–24 | `vibe-cms check` xanh trên dữ liệu Mr Spa, round-trip 72 sản phẩm giống từng byte | check + round-trip |
| **P21** | Mr Spa: bật gói thay CMS cũ (route cũ gỡ), HTML public giống từng byte | 20–32 | CMS mới làm được mọi việc CMS cũ làm | so 164 file tĩnh + SSR + 48 URL live; G.2 2 cặp |
| **P22** | Mr Spa: dọn code CMS cũ + chuyển test còn giá trị sang plugin | 8–15 | repo Mr Spa không còn code CMS cũ | test:cms mới xanh |

---

## K. Cloudflare — chung account Mr Spa: hiện trạng, đặt tên, dọn sau

### K.1 Xác minh chỉ đọc (2026-09-28; wrangler config trong repo + HTTP GET, không đổi gì trên Cloudflare)

| Site | Worker (theo repo) | Route / domain trong repo | Domain thật đang trả gì | Kết luận |
|---|---|---|---|---|
| Mr Spa | `mrspainc` (`wrangler.astro.jsonc`) | custom domain `mrspainc.com`, `www.mrspainc.com` | Astro (Cloudflare) | worker production |
| Innovate Salon | `innovatesalon-design` (`wrangler.toml`, main `14edc48`) — **Cloudflare Workers**, static assets + `worker/index.js` (form liên hệ), **Workers Builds từ GitHub, production branch `main`** (theo `UX-OPTIMIZE-PLAN-002.md` §4b, reviewer kiểm dashboard 24/09; `CLAUDE.md`: "deployed to Cloudflare Workers assets"). **Không phải Pages.** | **không khai route / custom domain**; bản mới chạy ở `innovatesalon-design.mrspaoffice.workers.dev` | `innovatesalon.com` + `www` → **WordPress 7.1.2 trên Apache (IP 74.208.236.216, không qua Cloudflare)**; DNS chưa ở Cloudflare (Q28 của chủ tiệm chưa trả lời) | Site Astro mới = worker `innovatesalon-design` trên workers.dev; domain thật chưa chuyển |
| Novelle Spa | `novellenailsspa` (`wrangler.astro.jsonc`, dev `1bda010`) | custom domain **`demo.novellenailsspa.com`** | `novellenailsspa.com` qua Cloudflare nhưng trả **site cũ "Michelle 2 Nails And Spa"**; `demo.` trả site Astro | worker `novellenailsspa` phục vụ **demo**, chưa phải domain chính |

Hệ quả cho thiết kế: "publish vào `main` / `dev` = production" hiện là production **của bản Astro** (worker Innovate
không gắn domain; Novelle ở `demo.`). Khi domain thật chuyển sang Cloudflare, quy tắc G.2 giữ nguyên; trước đó G.2 kiểm
trên URL worker / demo. Novelle: email form đang gửi tới `lehoangkhacson.97@gmail.com` (cấu hình demo).

### K.2 Tài nguyên mỗi site (tên cố định; binding chỉ trỏ tài nguyên của đúng site)

| Site | Worker | D1 | R2 | KV |
|---|---|---|---|---|
| Mr Spa (hiện có, giữ tên cũ tới P21) | `mrspainc` | `mrspainc-cms` | `mrspainc-media` | `SESSION` (id `bb94378b…`) |
| Innovate | `innovatesalon-design` (đang là worker của site mới; đổi tên chỉ khi SonLe muốn) | `innovate-cms` | `innovate-media` | `innovate-session` |
| Novelle | `novellenailsspa` | `novelle-cms` | `novelle-media` | `novelle-session` |

`vibe-cms setup` **idempotent**: liệt kê tài nguyên theo tên → có rồi thì dùng lại, chưa có thì tạo; migration chỉ áp
cái chưa áp (bảng `d1_migrations`); ghi binding vào `wrangler.jsonc` chỉ khi khác; chạy lại lần 2 = không đổi gì. Tham
số `--account` để chạy ở account khác (bàn giao). Không bao giờ xoá tài nguyên.

### K.3 Dọn sau — CHỈ LIỆT KÊ, KHÔNG XOÁ

SonLe xác nhận (2026-09-28) không dùng nữa; việc dọn chuyển sang **SEO Sprint 1 · T3b "Dọn beta / dev host"** (kiểm chỉ
đọc domain / route còn gắn — liên quan `beta.mrspainc.com` 525; export backup D1; SonLe tự bấm xoá):

| Tài nguyên | Loại | Ghi chú |
|---|---|---|
| `mrspainc-tina-dev` | Worker | thử Tina cũ |
| `mrspainc-tina-dev` | D1 | backup trước khi xoá |
| `admin-mrspainc-com` | Worker | admin cũ — kiểm route / domain trước |

⚠ **`innovatesalon-design` KHÔNG thuộc danh sách dọn:** SonLe ghi "không dùng nữa", nhưng repo Innovate (`main`) cho thấy
đó là worker **đang deploy site Innovate mới** (Workers Builds từ `main`). Xoá = mất bản Astro của Innovate và luồng
deploy của repo. Chờ SonLe xác nhận lại (§J câu 12).

**Đích triển khai của gói: chỉ Cloudflare Workers** (static assets + `@astrojs/cloudflare`), như Mr Spa. Innovate đã ở
Workers (không phải Pages) → **không cần task "chuyển Pages → Workers"**; việc còn lại là thêm adapter cho route CMS (P13).
Chuyển domain `innovatesalon.com` từ WordPress sang worker là việc ra mắt site (DNS, Q28), tách khỏi gói CMS.

## J. Câu hỏi mở cho SonLe

Đã trả lời (2026-09-28): nhánh deploy (Innovate `main`, Novelle `dev`); đợt nâng cấp Innovate xong; 1–2 người / tiệm →
owner + editor; editor không sửa giá / giờ / SĐT.

Còn mở:
1. ~~Cloudflare account~~ — đã trả lời: chung account Mr Spa, tài nguyên riêng từng site (§K). Mới: **khi nào
   `innovatesalon.com` chuyển từ WordPress (Apache) sang worker Cloudflare**, và `novellenailsspa.com` chuyển từ site
   Michelle cũ sang bản Astro (đang ở `demo.`)? Đổi tên worker `innovatesalon-design` lúc đó không?
10. Deploy Innovate / Novelle hiện chạy tay (`wrangler deploy`) hay Workers Builds từ GitHub? (Workers Builds giúp không
    cần token deploy — §F)
11. ~~Dọn tài nguyên~~ — đã chốt: không xoá bằng code; làm ở SEO Sprint 1 · T3b, SonLe tự bấm xoá.
12. **`innovatesalon-design`**: repo Innovate cho thấy đây là worker đang deploy site Innovate mới (Workers Builds từ
    `main`, `innovatesalon-design.mrspaoffice.workers.dev`). Xác nhận: giữ worker này làm worker của Innovate (và gắn
    domain vào nó khi ra mắt), hay có worker / project Innovate khác mà repo không nhắc tới?
2. Đồng ý khoá thêm **email + địa chỉ** (ngoài giá / giờ / SĐT) cho editor?
3. **Preview loader** (~1 KB script inline, không làm gì ngoài CMS) trên mọi trang Innovate / Novelle = đổi HTML public 1
   lần có chủ đích — chấp nhận? (không có nó thì không có visual editing)
4. Innovate chuyển từ `wrangler deploy` static + worker riêng sang adapter Cloudflare (trang public vẫn prerender) — chấp
   nhận đổi cách deploy? Hiện deploy Innovate chạy tay hay Workers Builds từ GitHub?
5. Nơi đặt npm private: GitHub Packages (org MRSPAINC hay tài khoản SonLe) hay registry khác? Repo gói thuộc tổ chức nào?
6. Working tree Innovate trên máy đang có thay đổi chưa commit (`src/data/site.ts`, `src/data/image-manifest.json`,
   thư mục `Claude outputs/`) — của ai, giữ hay bỏ? (P12 sẽ DỪNG nếu còn)
7. Chủ tiệm cần tự sửa những gì trên mỗi site (danh sách mục)? Chữ nào trong trang (ngoài `site.ts`) cần sửa được?
8. Khi nào Mr Spa chuyển sang gói (sau Innovate + Novelle chạy ổn bao lâu)?
9. Bán cho tiệm khác về sau: cần "đa khách hàng" trong 1 Worker không, hay mỗi tiệm 1 bộ tài nguyên như thiết kế này?

---

## Phụ lục — Đã xét, không chọn (v1, 2026-09-28)

SonLe chốt không dùng CMS thuê ngoài; CloudCannon chỉ là mẫu tham khảo (collections, `_inputs`, `_structures`, editable
regions). Tóm tắt so sánh v1 (giá tra 2026-09-28 tại
[CloudCannon](https://cloudcannon.com/pricing/), [TinaCloud](https://tina.io/pricing),
[Keystatic Cloud](https://keystatic.com/docs/cloud), [Sveltia](https://sveltiacms.app/en/docs/intro),
[Decap](https://decapcms.org/docs/intro/)):

| | Giá | Sửa trên trang | Người sửa cần GitHub |
|---|---|---|---|
| CloudCannon Standard | 55 USD/tháng (49 trả năm), không giới hạn site, 3 người + 10 USD/người | Có | Không |
| TinaCloud Team | 24 USD/site/tháng, 3 người (tối đa 10) | Có | Không |
| Keystatic (+ Cloud) | Free ≤ 3 người; Pro 10 USD + 5 USD/người | Không | Không (Cloud) |
| Sveltia / Decap | Miễn phí | Không | Có (Sveltia beta) |

v1 ước tính 12 tháng: CMS thuê ≈ 2,6k–6,1k USD, đóng gói nguyên trạng ≈ 10,4k–36,8k USD (25–50 USD/h). Lý do không chọn
(SonLe): muốn tự chủ sản phẩm, dùng chung cho các site của mình và bán lại về sau.
