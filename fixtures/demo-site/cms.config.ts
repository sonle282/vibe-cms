// Demo site config: 1 file (salon info) + 3 collections (services, team, posts). Invented content only; the build
// checks this config and the content it points to. Between them they use every field type (P7: the admin edits all of
// them): text (single / multiline / maxLength), richText, image (path / with alt), select, hours, object, list (ordered,
// of text / of objects / nested), reference (one / many, ordered), dotted keys, sections, a status field, Markdown body,
// and (P12g) pick + toggle: the banner's price points to a package of the same file, written once; (M4) link + phone.
import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

export default defineCmsConfig({
  configVersion: 1,
  site: { name: "Demo Salon", url: "https://demo.example", timezone: "America/New_York", phone: { country: "US" } },
  repo: { owner: "sonle282", name: "vibe-cms-demo", branch: "main" },
  roles: ["admin", "editor"],
  files: [
    {
      key: "site",
      label: "Salon info",
      path: "src/data/site.json",
      format: "json",
      preview: "/",
      sections: [
        { key: "contact", label: "Contact & hours", fields: ["phone", "email", "address", "hours"] },
        { key: "home", label: "Homepage", fields: ["name", "tagline", "hero", "highlights", "packages", "fromPrice"] },
        { key: "footer", label: "Footer & search", fields: ["footerLinks", "seo.title", "seo.description"] },
      ],
      fields: {
        // P9: the header shows the name without a data-cms-field attribute; the preview finds it by selector.
        name: f.text({ label: "Salon name", required: true, maxLength: 60, bind: "header .brand strong" }),
        // Locked for editors by default on every site: price, hours, phone, email, address.
        phone: f.phone({ label: "Phone", locked: "admin" }),
        email: f.text({ label: "Email", locked: "admin" }),
        address: f.object({ label: "Address", locked: "admin", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }) } }),
        hours: f.hours({ label: "Opening hours", locked: "admin" }),
        tagline: f.text({ label: "Tagline" }),
        hero: f.object({ label: "Banner", fields: { title: f.text({ label: "Heading" }), text: f.richText({ label: "Text" }), image: f.image({ label: "Picture", alt: true }) } }),
        highlights: f.reference({ label: "Featured services", to: "services", multiple: true, ordered: true, help: "Shown on the homepage, in this order." }),
        // P12g: a price is written once, in its package; the banner points to a package by its id.
        packages: f.list(f.object({ label: "Package", fields: {
          id: f.text({ label: "ID", required: true, pattern: "[a-z0-9-]+", patternHint: "lowercase letters, numbers and dashes" }),
          name: f.text({ label: "Name", required: true }),
          price: f.text({ label: "Price", locked: "admin" }),
        } }), { label: "Packages", ordered: true, itemLabel: "Package", max: 6 }),
        fromPrice: f.object({ label: "Price on the banner", fields: {
          of: f.pick({ label: "Package", required: true, choices: (content) => (Array.isArray(content.packages) ? content.packages : []).map((entry: { id: string; name: string; price: string }) => ({ value: entry.id, label: `${entry.name} · ${entry.price}`, group: "Packages" })) }),
          plain: f.toggle({ label: "Plain price", help: "Show the price without “from”" }),
        } }),
        footerLinks: f.list(
          f.object({ label: "Link group", fields: { title: f.text({ label: "Group title", required: true }), links: f.list(f.object({ label: "Link", fields: { label: f.text({ label: "Text", required: true }), href: f.link({ label: "Address", required: true }) } }), { label: "Links", ordered: true, max: 5, itemLabel: "Link" }) } }),
          { label: "Footer links", ordered: true, max: 3, itemLabel: "Group" },
        ),
        "seo.title": f.text({ label: "Search title", maxLength: 60 }),
        "seo.description": f.text({ label: "Search description", multiline: true, maxLength: 160, help: "One or two sentences shown by search engines." }),
      },
    },
    // M7 (the Mr Spa CMS's Pages): an area of every page with its on / off switch and its frame on the page, and the
    // Search & sharing screen.
    {
      key: "notice", label: "Notice", path: "src/data/notice.json", format: "json", preview: "/",
      area: true, description: "A short message at the top of every page", outline: "[data-site-notice]", toggle: "enabled",
      fields: {
        enabled: f.toggle({ label: "Show on website" }),
        text: f.text({ label: "Message", required: true, maxLength: 120 }),
      },
    },
    {
      key: "seo", label: "Search & sharing", path: "src/data/seo.json", format: "json",
      area: true, description: "How the site looks in Google and when shared", layout: "seo",
      seo: { siteName: "siteName", title: "title", description: "description", image: "image" },
      fields: {
        siteName: f.text({ label: "Site name", help: "The business name the website shows." }),
        title: f.text({ label: "Default page title", help: "Used when a page has no search title of its own." }),
        description: f.text({ label: "Default description", multiline: true, help: "Used when a page has no description of its own. Longer descriptions (120–160 characters) usually show better in Google." }),
        image: f.image({ label: "Social sharing image" }),
      },
    },
    // M10 (the Mr Spa CMS's Policy page): plain text on the paper — its sections stay as they are — and a word count.
    {
      key: "privacy", label: "Privacy policy", path: "src/data/privacy.json", format: "json", preview: "/privacy/", group: "Policies",
      layout: "document", document: { title: "title", body: "sections", plain: true },
      fields: {
        title: f.text({ label: "Title" }),
        sections: f.list(f.object({ label: "Section", fields: {
          heading: f.text({ label: "Heading" }),
          paragraphs: f.list(f.text({ label: "Paragraph", multiline: true }), { label: "Paragraphs", itemLabel: "Paragraph", fixed: true }),
        } }), { label: "Sections", itemLabel: "Section", fixed: true }),
      },
    },
  ],
  collections: [
    {
      key: "services",
      label: "Services",
      itemLabel: "Service",
      icon: "tag",
      store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
      preview: "/services/",
      // M8: the list (the Mr Spa CMS's Products): Category and Price after the name, a Category filter, ⋯ Duplicate.
      list: { columns: [{ field: "category" }, { field: "price" }], filters: [{ field: "category", label: "Category" }], duplicate: true },
      // P12d: the site's own rule (the plugin seam) — runs at build, on save and at publish: a price starts with "$".
      rules: (service) => (typeof service.price === "string" && service.price && !service.price.startsWith("$") ? [{ path: "price", message: "a price starts with $", hint: "e.g. $25 or $5+" }] : []),
      fields: {
        name: f.text({ label: "Name", required: true }),
        price: f.text({ label: "Price", locked: "admin" }),
        category: f.select({ label: "Category", options: ["Nails", "Spa"] }),
        extras: f.list(f.text({ label: "Extra" }), { label: "Extras", ordered: true, itemLabel: "Extra" }),
        description: f.text({ label: "Description", multiline: true, maxLength: 300 }),
      },
    },
    {
      key: "team",
      label: "Team",
      itemLabel: "Team member",
      icon: "users",
      store: { kind: "json-array", path: "src/data/team.json", idField: "id" },
      preview: "/team/",
      // M9: the Mr Spa CMS's record editor (sections on the left, "On the website" / "Ready to publish" on the right)
      // instead of the page on the canvas.
      layout: "record",
      sections: [{ key: "basics", label: "Basics", fields: ["name", "specialty"] }, { key: "photo", label: "Photo", fields: ["photo"] }, { key: "about", label: "About", fields: ["bio", "services"] }],
      fields: {
        name: f.text({ label: "Name", required: true }),
        photo: f.image({ label: "Photo", alt: true }),
        specialty: f.reference({ label: "Specialty", to: "services" }),
        services: f.reference({ label: "Services", to: "services", multiple: true, ordered: true }),
        bio: f.richText({ label: "About" }),
      },
    },
    {
      key: "posts",
      label: "Blog",
      itemLabel: "Post",
      icon: "pencil",
      store: { kind: "markdown-dir", dir: "src/content/posts", slugField: "slug" },
      preview: "/blog/{slug}/",
      status: { field: "status", live: "published", draft: "draft", archived: "archived" },
      // M8: All · Live · Draft · Archived above the list; the tags after the name; "New post" as the button.
      list: { columns: [{ field: "tags" }], filters: [{ field: "status" }] },
      labels: { add: "New post" },
      // M10: the Mr Spa CMS's Blog post — the paper (bar, cover, title, text) and Post details / In Google / Ready.
      layout: "document", document: { title: "title", body: "body", cover: "cover" },
      fields: {
        title: f.text({ label: "Title", required: true, maxLength: 80 }),
        status: f.select({ label: "Status", options: ["published", "draft", "archived"] }),
        cover: f.image({ label: "Cover image" }),
        tags: f.list(f.text({ label: "Tag" }), { label: "Tags", itemLabel: "Tag", max: 5 }),
      },
    },
  ],
});
