/**
 * P7: what the /admin page hands to the browser — the editable part of cms.config (labels, fields, sections) and who
 * is signed in. Nothing secret: no token, no binding, no password hash. Runs on the server (admin.astro) and is
 * typed for the browser side (app.ts). P12b: files / collections with access: "admin" are left out for editors.
 */
import type { CmsConfig, CollectionIcon, Field, Section } from "../config/index.js";
import { isAdminOnly } from "../config/roles.js";
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
  /** M1: a tab of this collection instead of a place on the rail. */
  under?: string;
};
export type BootUser = { id: string; username: string; displayName: string; role: Role };
/** P10: whether uploading works (the site has its R2 bucket), where uploads live, and the largest accepted file. */
export type BootMedia = { uploads: boolean; base: string; maxBytes: number };
/**
 * M4: `pages` = what a Link field's Page list offers ([path, name]): every file and collection with a fixed `preview`
 * (a collection's list page; also the admin-only ones — the pages are public), then site.pages; `phone` = site.phone.
 */
export type BootSite = { name: string; url: string; pages: Array<[string, string]>; phone?: { country: string } };
/** M6: how publishing is told ("this usually takes 5–10 minutes"). */
export type BootPublish = { typicalMinutes?: string };
export type AdminBoot = { site: BootSite; user: BootUser; publish?: BootPublish; files: BootFile[]; collections: BootCollection[]; media?: BootMedia };

/** M4: the pages a link may open, in config order, each address once (the first name wins). */
export const linkPages = (config: CmsConfig): Array<[string, string]> => {
  const pages = new Map<string, string>();
  for (const entry of [...config.files, ...config.collections]) if (entry.preview && !entry.preview.includes("{") && !pages.has(entry.preview)) pages.set(entry.preview, entry.label);
  for (const page of config.site.pages ?? []) if (!pages.has(page.path)) pages.set(page.path, page.label);
  return [...pages];
};

export const adminBoot = (config: CmsConfig, user: BootUser, options: { uploads?: boolean } = {}): AdminBoot => ({
  site: { name: config.site.name, url: config.site.url, pages: linkPages(config), ...(config.site.phone ? { phone: { country: config.site.phone.country } } : {}) },
  user,
  ...(config.publish?.typicalMinutes ? { publish: { typicalMinutes: config.publish.typicalMinutes } } : {}),
  media: { uploads: Boolean(options.uploads), base: mediaSettings(config.media).base, maxBytes: mediaSettings(config.media).maxBytes },
  files: config.files.filter((file) => !isAdminOnly(file.access) || user.role === "owner").map((file) => ({ key: file.key, label: file.label, ...(file.preview ? { preview: file.preview } : {}), ...(file.sections ? { sections: file.sections } : {}), fields: file.fields })),
  collections: config.collections.filter((collection) => !isAdminOnly(collection.access) || user.role === "owner").map((collection) => ({
    key: collection.key, label: collection.label, itemLabel: collection.itemLabel, fields: collection.fields,
    ...(collection.preview ? { preview: collection.preview } : {}), ...(collection.status ? { status: collection.status } : {}),
    idField: collection.store.kind === "json-array" ? collection.store.idField : collection.store.slugField,
    markdown: collection.store.kind === "markdown-dir",
    ...(collection.fixed ? { fixed: true } : {}),
    ...(collection.icon ? { icon: collection.icon } : {}),
    ...(collection.under ? { under: collection.under } : {}),
  })),
});

/** JSON that is safe inside <script type="application/json"> (no "</script>", no U+2028 / U+2029 surprises). */
export const bootJson = (boot: AdminBoot) => JSON.stringify(boot).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
