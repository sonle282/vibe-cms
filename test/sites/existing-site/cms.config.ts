// CI only: the smallest site config — one page with a heading and a photo.
import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

export default defineCmsConfig({
  configVersion: 1,
  site: { name: "Existing Site", url: "https://existing.example" },
  repo: { owner: "acme", name: "existing-site", branch: "main" },
  files: [
    { key: "home", label: "Homepage", path: "src/data/home.json", format: "json", preview: "/", fields: { title: f.text({ label: "Heading" }), photo: f.image({ label: "Photo", alt: true }) } },
  ],
  collections: [],
});
