// Demo site config: 1 file (salon info) + 3 collections (services, team, posts). Invented content only; the build
// checks this config and the content it points to. Between them they use every field type (P7: the admin edits all of
// them): text (single / multiline / maxLength), richText, image (path / with alt), select, hours, object, list (ordered,
// of text / of objects / nested), reference (one / many, ordered), dotted keys, sections, a status field, Markdown body.
import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

export default defineCmsConfig({
  configVersion: 1,
  site: { name: "Demo Salon", url: "https://demo.example", timezone: "America/New_York" },
  repo: { owner: "sonle282", name: "vibe-cms-demo", branch: "main" },
  roles: ["owner", "editor"],
  files: [
    {
      key: "site",
      label: "Salon info",
      path: "src/data/site.json",
      format: "json",
      preview: "/",
      sections: [
        { key: "contact", label: "Contact & hours", fields: ["phone", "email", "address", "hours"] },
        { key: "home", label: "Homepage", fields: ["name", "tagline", "hero", "highlights"] },
        { key: "footer", label: "Footer & search", fields: ["footerLinks", "seo.title", "seo.description"] },
      ],
      fields: {
        // P9: the header shows the name without a data-cms-field attribute; the preview finds it by selector.
        name: f.text({ label: "Salon name", required: true, maxLength: 60, bind: "header .brand strong" }),
        // Locked for editors by default on every site: price, hours, phone, email, address.
        phone: f.text({ label: "Phone", locked: "owner" }),
        email: f.text({ label: "Email", locked: "owner" }),
        address: f.object({ label: "Address", locked: "owner", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }) } }),
        hours: f.hours({ label: "Opening hours", locked: "owner" }),
        tagline: f.text({ label: "Tagline" }),
        hero: f.object({ label: "Banner", fields: { title: f.text({ label: "Heading" }), text: f.richText({ label: "Text" }), image: f.image({ label: "Picture", alt: true }) } }),
        highlights: f.reference({ label: "Featured services", to: "services", multiple: true, ordered: true, help: "Shown on the homepage, in this order." }),
        footerLinks: f.list(
          f.object({ label: "Link group", fields: { title: f.text({ label: "Group title", required: true }), links: f.list(f.object({ label: "Link", fields: { label: f.text({ label: "Text", required: true }), href: f.text({ label: "Address", required: true }) } }), { label: "Links", ordered: true, max: 5, itemLabel: "Link" }) } }),
          { label: "Footer links", ordered: true, max: 3, itemLabel: "Group" },
        ),
        "seo.title": f.text({ label: "Search title", maxLength: 60 }),
        "seo.description": f.text({ label: "Search description", multiline: true, maxLength: 160, help: "One or two sentences shown by search engines." }),
      },
    },
  ],
  collections: [
    {
      key: "services",
      label: "Services",
      itemLabel: "Service",
      store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
      preview: "/services/",
      fields: {
        name: f.text({ label: "Name", required: true }),
        price: f.text({ label: "Price", locked: "owner" }),
        category: f.select({ label: "Category", options: ["Nails", "Spa"] }),
        extras: f.list(f.text({ label: "Extra" }), { label: "Extras", ordered: true, itemLabel: "Extra" }),
        description: f.text({ label: "Description", multiline: true, maxLength: 300 }),
      },
    },
    {
      key: "team",
      label: "Team",
      itemLabel: "Team member",
      store: { kind: "json-array", path: "src/data/team.json", idField: "id" },
      preview: "/team/",
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
      store: { kind: "markdown-dir", dir: "src/content/posts", slugField: "slug" },
      preview: "/blog/{slug}/",
      status: { field: "status", live: "published", draft: "draft" },
      fields: {
        title: f.text({ label: "Title", required: true, maxLength: 80 }),
        status: f.select({ label: "Status", options: ["published", "draft"] }),
        cover: f.image({ label: "Cover image" }),
        tags: f.list(f.text({ label: "Tag" }), { label: "Tags", itemLabel: "Tag", max: 5 }),
      },
    },
  ],
});
