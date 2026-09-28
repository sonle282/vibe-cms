// Demo site config: 1 file (salon info) + 1 collection (services). Invented content only; the build checks this
// config and the JSON files it points to.
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
        { key: "home", label: "Homepage", fields: ["name", "tagline", "hero"] },
      ],
      fields: {
        name: f.text({ label: "Salon name", required: true, maxLength: 60 }),
        // Locked for editors by default on every site: price, hours, phone, email, address.
        phone: f.text({ label: "Phone", locked: "owner" }),
        email: f.text({ label: "Email", locked: "owner" }),
        address: f.object({ label: "Address", locked: "owner", fields: { street: f.text({ label: "Street" }), city: f.text({ label: "City" }) } }),
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
