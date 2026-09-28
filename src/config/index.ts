/**
 * Vibe CMS — the site's cms.config.ts vocabulary. The build checks it with checkCmsConfig (./validate.ts).
 *
 * A site describes its editable content once: which files hold single records (a page, the salon info) and which hold
 * lists of records (services, products), what every field is, and which fields only the owner may change.
 */

/** The only lock level: the field is shown to editors but only the owner may change it (checked on the server, P4). */
export type Locked = "owner";

type Base = {
  label: string;
  help?: string;
  required?: boolean;
  locked?: Locked;
  /** Preview binding by CSS selector when the template has no data-cms-field attribute (design §D). */
  bind?: string;
};

export type TextField = Base & { type: "text"; maxLength?: number; multiline?: boolean };
export type RichTextField = Base & { type: "richText" };
export type ImageField = Base & { type: "image"; alt?: boolean; mobile?: boolean };
export type SelectField = Base & { type: "select"; options: readonly string[] };
/** Content: [{ days: [1, 2, 3, 4, 5], label?, open: "09:00", close: "19:00" }, { days: [0], closed: true }] (0 = Sunday). */
export type HoursField = Base & { type: "hours" };
export type ObjectField = Base & { type: "object"; fields: Record<string, Field> };
export type ListField = Base & { type: "list"; of: Field; ordered?: boolean; min?: number; max?: number; itemLabel?: string };
export type ReferenceField = Base & { type: "reference"; to: string; multiple?: boolean; ordered?: boolean };

export type Field = TextField | RichTextField | ImageField | SelectField | HoursField | ObjectField | ListField | ReferenceField;
export type FieldType = Field["type"];
export const FIELD_TYPES: readonly FieldType[] = ["text", "richText", "image", "select", "hours", "object", "list", "reference"];

export type Section = { key: string; label: string; fields: string[] };

/** One file = one record (a page, the salon info). */
export type CmsFile = {
  key: string;
  label: string;
  path: string;
  format: "json";
  preview?: string;
  sections?: Section[];
  fields: Record<string, Field>;
};

/** Many records: one JSON array file (products.json) or one Markdown file per record (blog). */
export type CmsCollection = {
  key: string;
  label: string;
  itemLabel: string;
  store: { kind: "json-array"; path: string; idField: string } | { kind: "markdown-dir"; dir: string; slugField: string };
  status?: { field: string; live: string; draft: string };
  preview?: string;
  order?: "file" | { by: string };
  fields: Record<string, Field>;
};

export type CmsConfig = {
  configVersion: 1;
  site: { name: string; url: string; timezone?: string };
  /** branch = the production branch the CMS commits to. */
  repo: { owner: string; name: string; branch: string };
  roles?: readonly ["owner", "editor"];
  /** Extra folders that may hold content, added to the default src/data and src/content. */
  contentDirs?: string[];
  files: CmsFile[];
  collections: CmsCollection[];
  media?: { bucketPrefix: string; maxBytes: number };
};

/** Identity helper so a site's config is type-checked in the editor. */
export const defineCmsConfig = (config: CmsConfig): CmsConfig => config;

type Options<T extends Field> = Omit<T, "type">;

/** Field builders: f.text({ label: "Phone", locked: "owner" }). */
export const f = {
  text: (options: Options<TextField>): TextField => ({ type: "text", ...options }),
  richText: (options: Options<RichTextField>): RichTextField => ({ type: "richText", ...options }),
  image: (options: Options<ImageField>): ImageField => ({ type: "image", ...options }),
  select: (options: Options<SelectField>): SelectField => ({ type: "select", ...options }),
  hours: (options: Options<HoursField>): HoursField => ({ type: "hours", ...options }),
  object: (options: Options<ObjectField>): ObjectField => ({ type: "object", ...options }),
  list: (of: Field, options: Omit<Options<ListField>, "of">): ListField => ({ type: "list", of, ...options }),
  reference: (options: Options<ReferenceField>): ReferenceField => ({ type: "reference", ...options }),
};

export { assertCmsConfig, branchProblem, checkCmsConfig, CmsConfigError, countConfig, DEFAULT_CONTENT_DIRS, formatProblem, formatWarnings, MAX_DEPTH, pathProblem } from "./validate.js";
export type { CheckResult, Problem } from "./validate.js";
