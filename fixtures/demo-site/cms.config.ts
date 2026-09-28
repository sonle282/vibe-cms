// Demo site config: 1 file (salon info) + 1 collection (services). Invented content only.
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
        { key: "contact", label: "Contact & hours", fields: ["phone", "hours"] },
        { key: "home", label: "Homepage", fields: ["tagline", "hero"] },
      ],
      fields: {
        phone: f.text({ label: "Phone", locked: "owner" }),
        hours: f.hours({ label: "Opening hours", locked: "owner" }),
        tagline: f.text({ label: "Tagline" }),
        hero: f.object({ label: "Banner", fields: { title: f.text({ label: "Heading" }), text: f.richText({ label: "Text" }) } }),
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
      },
    },
  ],
});
