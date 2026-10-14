/**
 * The site's own Vite — the one its Astro brings — found from the site's folder (or this package's). The package
 * does not depend on Vite itself: a peer would make npm add (and de-duplicate onto) a newer Vite than the site's Astro
 * uses, changing the site's build only because the CMS was installed.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

type Vite = typeof import("vite");

const viteFrom = (base: string): string | undefined => {
  const require = createRequire(base);
  for (const find of [() => require.resolve("vite/package.json"), () => createRequire(require.resolve("astro/package.json")).resolve("vite/package.json")]) {
    try {
      const manifest = find();
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { exports?: Record<string, unknown> | string; module?: string; main?: string };
      const root = typeof pkg.exports === "object" ? pkg.exports["."] : pkg.exports;
      const entry = typeof root === "string" ? root : root && typeof root === "object" ? ((root as Record<string, unknown>).import ?? (root as Record<string, unknown>).default) : pkg.module ?? pkg.main;
      if (typeof entry === "string") return join(dirname(manifest), entry);
    } catch { /* try the next place */ }
  }
  return undefined;
};

export const siteVite = async (siteRoot?: string): Promise<Vite> => {
  for (const base of [siteRoot ? join(siteRoot, "package.json") : undefined, import.meta.url]) {
    if (!base) continue;
    const entry = viteFrom(base);
    if (entry) return (await import(pathToFileURL(entry).href)) as Vite;
  }
  throw new Error("Vite was not found (the site's Astro brings it) — run npm install in the site");
};

/** Vite's normalizePath: forward slashes, normalized (no Vite needed). */
export const normalizePath = (path: string) => posix.normalize(path.replace(/\\/g, "/"));
