/**
 * P7: what the /admin page hands to the browser — the editable part of cms.config (labels, fields, sections) and who
 * is signed in. Nothing secret: no token, no binding, no password hash. Runs on the server (admin.astro) and is
 * typed for the browser side (app.ts). P12b: files / collections with access: "owner" are left out for editors.
 */
import type { CmsConfig, CollectionIcon, Field, Section } from "../config/index.js";
import type { Role } from "../locks/index.js";
import { mediaSettings } from "../media/index.js";

export type BootFile = { key: string; label: string; preview?: string; sections?: Section[]; fields: Record<string, Field> };
export type BootCollection = {
  key: string; label: string; itemLabel: string; preview?: string; fields: Record<string, Field>;
  idField: string; markdown: boolean; status?: { field: string; live: string; draft: string };
  /** P12b: no new record can be added. */
  fixed?: boolean;
  /** U2: its icon on the rail. */
  icon?: CollectionIcon;
};
export type BootUser = { id: string; username: string; displayName: string; role: Role };
/** P10: whether uploading works (the site has its R2 bucket), where uploads live, and the largest accepted file. */
export type BootMedia = { uploads: boolean; base: string; maxBytes: number };
export type AdminBoot = { site: { name: string; url: string }; user: BootUser; files: BootFile[]; collections: BootCollection[]; media?: BootMedia };

export const adminBoot = (config: CmsConfig, user: BootUser, options: { uploads?: boolean } = {}): AdminBoot => ({
  site: { name: config.site.name, url: config.site.url },
  user,
  media: { uploads: Boolean(options.uploads), base: mediaSettings(config.media).base, maxBytes: mediaSettings(config.media).maxBytes },
  files: config.files.filter((file) => file.access !== "owner" || user.role === "owner").map((file) => ({ key: file.key, label: file.label, ...(file.preview ? { preview: file.preview } : {}), ...(file.sections ? { sections: file.sections } : {}), fields: file.fields })),
  collections: config.collections.filter((collection) => collection.access !== "owner" || user.role === "owner").map((collection) => ({
    key: collection.key, label: collection.label, itemLabel: collection.itemLabel, fields: collection.fields,
    ...(collection.preview ? { preview: collection.preview } : {}), ...(collection.status ? { status: collection.status } : {}),
    idField: collection.store.kind === "json-array" ? collection.store.idField : collection.store.slugField,
    markdown: collection.store.kind === "markdown-dir",
    ...(collection.fixed ? { fixed: true } : {}),
    ...(collection.icon ? { icon: collection.icon } : {}),
  })),
});

/** JSON that is safe inside <script type="application/json"> (no "</script>", no U+2028 / U+2029 surprises). */
export const bootJson = (boot: AdminBoot) => JSON.stringify(boot).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
