/**
 * Vibe CMS — the site's cms.config.ts vocabulary. The build checks it with checkCmsConfig (./validate.ts).
 *
 * A site describes its editable content once: which files hold single records (a page, the salon info) and which hold
 * lists of records (services, products), what every field is, and which fields only the owner may change.
 */

/** The only lock level: the field is shown to editors but only the owner may change it (checked on the server, P4). */
export type Locked = "owner";
/** P12b: a whole file / collection only owners see and change (editors get 403; it is not in their navigation). */
export type Access = "owner";

type Base = {
  label: string;
  help?: string;
  required?: boolean;
  locked?: Locked;
  /** Preview binding by CSS selector when the template has no data-cms-field attribute (design §D). */
  bind?: string;
};

/**
 * P12d: `pattern` = a regular expression the whole value must match (in cms.config.ts: "\\d{2}:\\d{2}"), `patternHint` = what to
 * tell people when it does not ("a time like 09:30"); `tokens` = the {words} the site's code fills in ({phone},
 * {city}…): only these may appear between braces, and the admin offers them.
 */
export type TextField = Base & { type: "text"; maxLength?: number; multiline?: boolean; pattern?: string; patternHint?: string; tokens?: readonly string[] };
/** P12d: `allow` = the tags this field may hold (a part of the rich-text allow-list, e.g. ["em", "br"]); the toolbar follows. */
export type RichTextField = Base & { type: "richText"; allow?: readonly string[] };
export type ImageField = Base & { type: "image"; alt?: boolean; mobile?: boolean };
export type SelectField = Base & { type: "select"; options: readonly string[] };
/** Content: [{ days: [1, 2, 3, 4, 5], label?, open: "09:00", close: "19:00" }, { days: [0], closed: true }] (0 = Sunday). */
export type HoursField = Base & { type: "hours" };
export type ObjectField = Base & { type: "object"; fields: Record<string, Field> };
/** P12b: fixed = the site's code owns the shape — nobody (owner included) adds, removes or moves items; values inside stay editable. */
export type ListField = Base & { type: "list"; of: Field; ordered?: boolean; min?: number; max?: number; itemLabel?: string; fixed?: boolean };
export type ReferenceField = Base & { type: "reference"; to: string; multiple?: boolean; ordered?: boolean };
/** P12d: a fixed-length list stored as a JSON array, one field per place — e.g. ["Manicure", "$17"] = [name, price]. */
export type TupleField = Base & { type: "tuple"; items: Field[] };

/**
 * P12g: one of a list the site computes from the record's own content — e.g. a price written once in the menu and used
 * elsewhere by its place ("packages/the-essential-reset"). Stored as text. `choices` runs on the server (build check,
 * save, publish, the editor's view); the admin shows its result (grouped by `group`).
 */
export type PickChoice = { value: string; label: string; group?: string };
export type PickField = Base & { type: "pick"; choices: (content: Record<string, unknown>) => readonly PickChoice[] };
/** P12g: yes / no, stored as true / false (left out while it was never set). */
export type ToggleField = Base & { type: "toggle" };

export type Field = TextField | RichTextField | ImageField | SelectField | HoursField | ObjectField | ListField | ReferenceField | TupleField | PickField | ToggleField;
export type FieldType = Field["type"];
export const FIELD_TYPES: readonly FieldType[] = ["text", "richText", "image", "select", "hours", "object", "list", "reference", "tuple", "pick", "toggle"];

/**
 * P12d: a site's own rule for a file / collection record — the plugin seam: cross-field checks the field types cannot
 * say (a price that must point at an existing package, one of two fields filled…). Runs at build (content check), when
 * a draft is saved and again at publish (in the Worker). `content` reads the site's other content as it is live.
 * Return problems ({ path, message, hint?, warning? }); none = fine. Keep it pure: no network, no clock.
 */
export type RuleContext = { file: (key: string) => unknown; items: (key: string) => Array<Record<string, unknown>> };
export type RuleProblem = { path: string; message: string; hint?: string; warning?: boolean };
export type ContentRule = (value: Record<string, unknown>, content: RuleContext) => RuleProblem[] | undefined;

export type Section = { key: string; label: string; fields: string[] };

/** One file = one record (a page, the salon info). */
export type CmsFile = {
  key: string;
  label: string;
  path: string;
  format: "json";
  preview?: string;
  sections?: Section[];
  access?: Access;
  rules?: ContentRule;
  fields: Record<string, Field>;
};

/** U2: the icon a collection shows on the rail of the admin (Lucide shapes); "list" when not set. */
export const COLLECTION_ICONS = ["list", "box", "grid", "pencil", "image", "calendar", "star", "tag", "users", "file"] as const;
export type CollectionIcon = (typeof COLLECTION_ICONS)[number];

/** Many records: one JSON array file (products.json) or one Markdown file per record (blog). */
export type CmsCollection = {
  key: string;
  label: string;
  itemLabel: string;
  /** U2: its icon on the rail. */
  icon?: CollectionIcon;
  store: { kind: "json-array"; path: string; idField: string } | { kind: "markdown-dir"; dir: string; slugField: string };
  status?: { field: string; live: string; draft: string };
  preview?: string;
  order?: "file" | { by: string };
  access?: Access;
  /** P12b: no record is added (the site's code expects exactly these); the records stay editable. */
  fixed?: boolean;
  /** P12d: the site's own check of one record (see ContentRule). */
  rules?: ContentRule;
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
  /**
   * P10: uploaded images. `dir` = where they are committed in the site's repo (default "public/assets/uploads"; served
   * at the same path without "public"); `maxBytes` = largest file after the browser has prepared it (default 10 MiB).
   * The site's R2 bucket <site>-media (binding CMS_MEDIA) holds them until they are published.
   */
  media?: { dir?: string; maxBytes?: number };
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
  /** f.tuple([f.text({ label: "Service" }), f.text({ label: "Price", locked: "owner" })], { label: "Service and price" }) */
  tuple: (items: Field[], options: Omit<Options<TupleField>, "items">): TupleField => ({ type: "tuple", items, ...options }),
  /** f.pick({ label: "Price", choices: (content) => menuLines(content) }) — P12g */
  pick: (options: Options<PickField>): PickField => ({ type: "pick", ...options }),
  /** f.toggle({ label: "Show without “from”" }) — P12g */
  toggle: (options: Options<ToggleField>): ToggleField => ({ type: "toggle", ...options }),
};

export { assertCmsConfig, branchProblem, checkCmsConfig, CmsConfigError, countConfig, DEFAULT_CONTENT_DIRS, formatProblem, formatWarnings, MAX_DEPTH, pathProblem } from "./validate.js";
export type { CheckResult, Problem } from "./validate.js";
