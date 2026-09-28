# Vibe CMS (`@sonle282/vibe-cms`)

An Astro integration that adds a content editor to a site: `/admin` for the salon owner and staff, `/api/cms/*` for
saving and publishing (commits to the site's GitHub repo). Everything is described by one file, `cms.config.ts`.
Target: Astro 7 on **Cloudflare Workers** (`@astrojs/cloudflare`). Private — see [LICENSE](LICENSE).

> Status: **0.1.0 · P1 skeleton.** `/admin` is a placeholder and `/api/cms/health` reports the config; the editor,
> saving and publishing come in P2–P11 ([docs/TRACKER.md](docs/TRACKER.md), design: [docs/DESIGN.md](docs/DESIGN.md)).

## Install in a site (3 steps)

The package lives on GitHub Packages. The site needs an `.npmrc` that points the `@sonle282` scope there and a
read-only token (`read:packages`) in the environment — never commit the token:

```ini
# .npmrc (commit this; the token comes from the environment)
@sonle282:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

1. **Install**

   ```bash
   npm i @sonle282/vibe-cms @astrojs/cloudflare
   ```

2. **Add it to `astro.config.mjs`** (public pages keep prerendering; only the CMS routes run on demand):

   ```js
   import { defineConfig } from "astro/config";
   import cloudflare from "@astrojs/cloudflare";
   import vibeCms from "@sonle282/vibe-cms";

   export default defineConfig({
     output: "static",
     adapter: cloudflare(),
     integrations: [vibeCms()],
   });
   ```

3. **Create `cms.config.ts`** at the project root:

   ```ts
   import { defineCmsConfig, f } from "@sonle282/vibe-cms/config";

   export default defineCmsConfig({
     configVersion: 1,
     site: { name: "My Salon", url: "https://mysalon.example" },
     repo: { owner: "my-org", name: "mysalon.example", branch: "main" }, // branch = production
     files: [{
       key: "site", label: "Salon info", path: "src/data/site.json", format: "json",
       fields: {
         phone: f.text({ label: "Phone", locked: "owner" }),   // editors see it, only the owner changes it
         hours: f.hours({ label: "Opening hours", locked: "owner" }),
       },
     }],
     collections: [{
       key: "services", label: "Services", itemLabel: "Service",
       store: { kind: "json-array", path: "src/data/services.json", idField: "id" },
       fields: { name: f.text({ label: "Name" }), price: f.text({ label: "Price", locked: "owner" }) },
     }],
   });
   ```

Then `npm run build`: the log shows `config OK: N files, M collections`, and `/admin` + `/api/cms/health` answer in
`wrangler dev`. A mistake in `cms.config.ts` stops the build and names the place, e.g.
`files[0].path: required — the content file, e.g. "src/data/site.json"`.

Field types (P1): `f.text`, `f.richText`, `f.image`, `f.select`, `f.hours`, `f.object`, `f.list` (with `ordered`),
`f.reference`; any field may be `locked: "owner"`.

## Develop this package

```bash
npm ci
npm run check    # typecheck + unit tests + build demo site + astro check + local smoke (wrangler dev --local)
```

`fixtures/demo-site` is an invented salon used by every test — tests never read another site's data. It runs locally
only: no Cloudflare account, no resources, no deploy.
