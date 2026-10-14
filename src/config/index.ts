/**
 * Vibe CMS — the site's cms.config.ts vocabulary. The build checks it with checkCmsConfig (./validate.ts).
 *
 * A site describes its editable content once: which files hold single records (a page, the salon info) and which hold
 * lists of records (services, products), what every field is, and which fields only the owner may change.
 */

/**
 * The only lock level: the field is shown to editors but only an admin may change it (checked on the server, P4).
 * M2: "admin" (the Mr Spa CMS's name); "owner" is the old name and still works (the build warns once).
 */
export type Locked = "admin" | "owner";
/** P12b: a whole file / collection only admins see and change (editors get 403; it is not in their navigation). */
export type Access = "admin" | "owner";
export { isAdminOnly } from "./roles.js";

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
export type TextField = Base & { type: "text"; maxLength?: number; multiline?: boolean; pattern?: string; patternHint?: string; tokens?: readonly string[];
  /** P16a: an id made from another field of the same object while the item is new ("Classic Manicure" → "classic-manicure"). */
  from?: string };
/** P12d: `allow` = the tags this field may hold (a part of the rich-text allow-list, e.g. ["em", "br"]); the toolbar follows. */
export type RichTextField = Base & { type: "richText"; allow?: readonly string[] };
export type ImageField = Base & { type: "image"; alt?: boolean; mobile?: boolean };
export type SelectField = Base & { type: "select"; options: readonly string[] };
/** Content: [{ days: [1, 2, 3, 4, 5], label?, open: "09:00", close: "19:00" }, { days: [0], closed: true }] (0 = Sunday). */
export type HoursField = Base & { type: "hours" };
/** M3c: `flat` — in the page inspector its fields show as the section's own (no group around them), as in the Mr Spa CMS. */
export type ObjectField = Base & { type: "object"; fields: Record<string, Field>; flat?: boolean };
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
/** P16a: a number (JSON number); `integer` = whole numbers only; `min` / `max` inclusive. */
export type NumberField = Base & { type: "number"; min?: number; max?: number; integer?: boolean };
/** P12g: yes / no, stored as true / false (left out while it was never set). */
export type ToggleField = Base & { type: "toggle" };
/**
 * M4: a link (the Mr Spa CMS's Link field) — saved as the href the site already uses ("/about", "https://…",
 * "tel:+12157721111", "mailto:…"). The editor picks Page · Web address · Phone · Email; the pages are the files with a
 * `preview` and `site.pages`. Not `required` = it may be empty ("No link").
 */
export type LinkField = Base & { type: "link" };
/** M4: a phone number as people read it ("(215) 772-1111"), checked for `site.phone.country`. */
export type PhoneField = Base & { type: "phone" };

export type Field = TextField | RichTextField | ImageField | SelectField | HoursField | ObjectField | ListField | ReferenceField | TupleField | PickField | ToggleField | NumberField | LinkField | PhoneField;
export type FieldType = Field["type"];
export const FIELD_TYPES: readonly FieldType[] = ["text", "richText", "image", "select", "hours", "object", "list", "reference", "tuple", "pick", "toggle", "number", "link", "phone"];

/**
 * P12d: a site's own rule for a file / collection record — the plugin seam: cross-field checks the field types cannot
 * say (a price that must point at an existing package, one of two fields filled…). Runs at build (content check), when
 * a draft is saved and again at publish (in the Worker). `content` reads the site's other content as it is live.
 * Return problems ({ path, message, hint?, warning? }); none = fine. Keep it pure: no network, no clock.
 */
export type RuleContext = { file: (key: string) => unknown; items: (key: string) => Array<Record<string, unknown>> };
export type RuleProblem = { path: string; message: string; hint?: string; warning?: boolean };
export type ContentRule = (value: Record<string, unknown>, content: RuleContext) => RuleProblem[] | undefined;

/**
 * A group of fields in the page inspector. `fields`: field keys, or (M3c) a path into one — an object's field ("hero.title")
 * or an item of a fixed list ("services[0].card") — so one list can give a section per item, as the Mr Spa CMS does.
 */
export type Section = { key: string; label: string; fields: string[] };

/**
 * M10: `layout: "document"` = the Mr Spa CMS's Blog post / Policy editor — the text on a sheet of paper (the
 * formatting bar on top, the cover, the title in large type, the body) and on the right "On the website", the other
 * fields ("Post details" / "Page details"), "In Google" and "Ready to publish". The keys name the fields: `title` (a
 * text field), `body` (rich text, or "body" of a Markdown collection), `cover` (an image field). `plain: true` = the
 * Policy page: no formatting bar — the body's text boxes on the paper (a text field or a list of sections) and a word
 * count.
 */
export type DocumentLayout = { title: string; body: string; cover?: string; plain?: boolean };

/** One file = one record (a page, the salon info). */
export type CmsFile = {
  key: string;
  label: string;
  path: string;
  format: "json";
  preview?: string;
  /**
   * M7 (the Mr Spa CMS's Pages screen): `group` = its group on Pages ("Main pages" when not set; e.g. "Policies");
   * `area: true` = a part of every page (Header, Footer, Popup, Search & sharing) — listed under "Across the whole site"
   * with its `description` ("Logo, phone number and menu"); `preview` is then the page it is shown on (e.g. "/").
   */
  group?: string;
  area?: boolean;
  description?: string;
  /** M7: the CSS selector of the area on the page ("header", "[data-site-footer]"): framed in teal while it is edited. */
  outline?: string;
  /**
   * M7: a toggle field that turns the area on and off ("enabled", "popup.enabled"): shown as the switch "Show on
   * website" with what visitors see; on Pages the area is "Off" while it is off on the website.
   */
  toggle?: string;
  /**
   * M7: `layout: "seo"` = the Mr Spa CMS's Search & sharing screen (Search results · Sharing image · the Google and
   * share previews), with `seo` naming its fields (keys or paths): `title`, `description`, optional `siteName`, `image`.
   */
  layout?: "seo" | "document";
  seo?: { title: string; description: string; siteName?: string; image?: string };
  /** M10: the document layout's fields (see DocumentLayout). */
  document?: DocumentLayout;
  sections?: Section[];
  access?: Access;
  rules?: ContentRule;
  fields: Record<string, Field>;
};

/** U2: the icon a collection shows on the rail of the admin (Lucide shapes); "list" when not set. */
export const COLLECTION_ICONS = ["list", "box", "grid", "pencil", "image", "calendar", "star", "tag", "users", "file", "package", "pen-line"] as const;
export type CollectionIcon = (typeof COLLECTION_ICONS)[number];

/** Many records: one JSON array file (products.json) or one Markdown file per record (blog). */
export type CmsCollection = {
  key: string;
  label: string;
  itemLabel: string;
  /** U2: its icon on the rail. */
  icon?: CollectionIcon;
  /**
   * M1: shown as a tab of another collection instead of its own place on the rail (Mr Spa: Products · Categories ·
   * Collections) — the key of a collection that is not itself `under` another.
   */
  under?: string;
  store: { kind: "json-array"; path: string; idField: string } | { kind: "markdown-dir"; dir: string; slugField: string };
  /** M8: `archived` = the value of a record hidden from the website but kept in the CMS (the Mr Spa CMS's "Archived"). */
  status?: { field: string; live: string; draft: string; archived?: string };
  preview?: string;
  /** M8: the list screen (the Mr Spa CMS's Products / Projects / Blog lists). */
  list?: CollectionList;
  /**
   * M9: how a record is edited. "record" = the Mr Spa CMS's record editor (sections on the left, the form, and on the
   * right "On the website" / "Ready to publish" / Duplicate / Hide from website); "page" = the page editor with the
   * record's page on the canvas. Default: "page" when the collection has a `preview`, "record" otherwise.
   */
  layout?: "record" | "page" | "document";
  /** M10: the document layout's fields (see DocumentLayout). */
  document?: DocumentLayout;
  /** M9: the record editor's sections (cards and the list on the left), as for files. */
  sections?: Section[];
  /**
   * M9: the "Before you publish · N to do" list — a field each, with its words ("At least one category"). Default: the
   * required fields and the lists with a `min`. "No errors" is always last.
   */
  ready?: ReadonlyArray<{ field: string; label?: string }>;
  /** M8: words of the list screen: `add` = its button ("Add product"; default "Add <item>"), `search` = the search
   *  box's placeholder (default "Search <items>"), `many` = the plural of the item ("posts"; default from itemLabel). */
  labels?: { add?: string; search?: string; many?: string };
  order?: "file" | { by: string };
  access?: Access;
  /** P12b: no record is added (the site's code expects exactly these); the records stay editable. */
  fixed?: boolean;
  /** P12d: the site's own check of one record (see ContentRule). */
  rules?: ContentRule;
  fields: Record<string, Field>;
};

/** M8: one column of a collection's list (after the name, before the status), or one filter above it. */
export type ListColumn = {
  /** A field of the record (a key, or a path into an object: "seo.title"). */
  field: string;
  /** The header / the filter's name; default: the field's label. */
  label?: string;
  /** What a stored value is shown as ({ en: "English", vi: "Tiếng Việt" }); other values are shown as they are. */
  values?: Readonly<Record<string, string>>;
  /** "date": 2024-10-25 is shown as "Oct 25, 2024". */
  format?: "date";
};
export type ListFilter = {
  /** A select, toggle or reference field, or the collection's status field (All · Live · Draft · Archived). */
  field: string;
  label?: string;
  values?: Readonly<Record<string, string>>;
  /** The first choice of a dropdown filter ("All categories"; default "All"). */
  all?: string;
};
export type CollectionList = {
  columns?: ReadonlyArray<ListColumn>;
  /** Filters above the table: a few choices are buttons (All · Live · Draft), many are a dropdown. */
  filters?: ReadonlyArray<ListFilter>;
  /** Fields the search box reads besides the name and the columns ("sku"). */
  search?: readonly string[];
  /** A second line under the name, with {field} words ("SKU {sku}"): shown when every word has a value. */
  detail?: string;
  /** ⋯ Duplicate: a new, unpublished copy named "Copy of …"; `clear` = fields the copy starts without ("sku"). */
  duplicate?: boolean | { clear?: readonly string[] };
};

export type CmsConfig = {
  configVersion: 1;
  site: {
    name: string; url: string; timezone?: string;
    /** M4: how phone numbers are written and checked — "US" / "CA": (215) 772-1111; other or none: with the country code. */
    phone?: { country: string };
    /**
     * M4: more pages a Link field may open, besides the files and collections with a fixed `preview` (policies, booking…).
     * e.g. [{ path: "/booking/", label: "Booking" }].
     */
    pages?: ReadonlyArray<{ path: string; label: string }>;
  };
  /** branch = the production branch the CMS commits to. */
  repo: { owner: string; name: string; branch: string };
  roles?: readonly ["admin", "editor"] | readonly ["owner", "editor"];
  /** Extra folders that may hold content, added to the default src/data and src/content. */
  contentDirs?: string[];
  files: CmsFile[];
  collections: CmsCollection[];
  /**
   * P10: uploaded images. `dir` = where they are committed in the site's repo (default "public/assets/uploads"; served
   * at the same path without "public"); `maxBytes` = largest file after the browser has prepared it (default 10 MiB).
   * The site's R2 bucket <site>-media (binding CMS_MEDIA) holds them until they are published.
   */
  /**
   * M6: publishing, as the admin tells it. `typicalMinutes` = how long the site's build usually takes ("5–10": the
   * status says "Publishing… this usually takes 5–10 minutes"; default "a few"); `buildCheck` = the name of the GitHub
   * check run that builds the site (e.g. "Workers Builds"): when it fails, the admin says so instead of waiting.
   */
  publish?: { typicalMinutes?: string; buildCheck?: string };
  media?: {
    dir?: string;
    /** P12h: the address uploads are served at until the site is built with them (default: dir without "public"). */
    base?: string;
    maxBytes?: number;
    /** P12h: images stored by name in the site's image manifest (src/media/names.ts). */
    names?: { manifest: string; url?: string; width?: number; root?: string; exclude?: readonly string[] };
  };
};

/** Identity helper so a site's config is type-checked in the editor. */
export const defineCmsConfig = (config: CmsConfig): CmsConfig => config;

type Options<T extends Field> = Omit<T, "type">;

/** Field builders: f.text({ label: "Phone", locked: "admin" }). */
export const f = {
  text: (options: Options<TextField>): TextField => ({ type: "text", ...options }),
  richText: (options: Options<RichTextField>): RichTextField => ({ type: "richText", ...options }),
  image: (options: Options<ImageField>): ImageField => ({ type: "image", ...options }),
  select: (options: Options<SelectField>): SelectField => ({ type: "select", ...options }),
  hours: (options: Options<HoursField>): HoursField => ({ type: "hours", ...options }),
  object: (options: Options<ObjectField>): ObjectField => ({ type: "object", ...options }),
  list: (of: Field, options: Omit<Options<ListField>, "of">): ListField => ({ type: "list", of, ...options }),
  reference: (options: Options<ReferenceField>): ReferenceField => ({ type: "reference", ...options }),
  /** f.tuple([f.text({ label: "Service" }), f.text({ label: "Price", locked: "admin" })], { label: "Service and price" }) */
  tuple: (items: Field[], options: Omit<Options<TupleField>, "items">): TupleField => ({ type: "tuple", items, ...options }),
  /** f.pick({ label: "Price", choices: (content) => menuLines(content) }) — P12g */
  pick: (options: Options<PickField>): PickField => ({ type: "pick", ...options }),
  /** f.toggle({ label: "Show without “from”" }) — P12g */
  toggle: (options: Options<ToggleField>): ToggleField => ({ type: "toggle", ...options }),
  /** f.number({ label: "Order", integer: true, min: 1, max: 99 }) — P16a */
  number: (options: Options<NumberField>): NumberField => ({ type: "number", ...options }),
  /** M4: a link — Page · Web address · Phone · Email (saved as the href). */
  link: (options: Options<LinkField>): LinkField => ({ type: "link", ...options }),
  /** M4: a phone number, written and checked for site.phone.country. */
  phone: (options: Options<PhoneField>): PhoneField => ({ type: "phone", ...options }),
};

export { assertCmsConfig, branchProblem, checkCmsConfig, CmsConfigError, countConfig, DEFAULT_CONTENT_DIRS, formatProblem, formatWarnings, MAX_DEPTH, pathProblem } from "./validate.js";
export type { CheckResult, Problem } from "./validate.js";
