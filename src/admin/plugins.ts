/**
 * M14: a site's own admin code — what only one site needs (the Mr Spa CMS's "Call for price", a panel saying where a
 * category shows…) stays in the site's repo and is bundled into /admin. cms.config.ts names the modules:
 *
 *   admin: { plugins: ["./cms/admin-plugin.ts"] }
 *
 * and each one default-exports defineAdminPlugin({ name, controls, panels }):
 *
 * - `controls` — a field with `control: "<name>"` is shown by the plugin's control instead of the standard box. The
 *   control gets the field, its value, `set` and `standard()` (the standard box, to wrap instead of rebuilding it).
 * - `panels` — a card in the record editor's right column ("record", for a collection or a file) or above a
 *   collection's list ("list"); it is told the record (or the rows) again after every change.
 *
 * Checks that must hold on the server stay `rules` in cms.config.ts (they run at build, on save and at publish).
 * A plugin that throws never stops the CMS: its card says it could not be shown.
 */
import type { Field } from "../config/index.js";
import type { Path } from "./value.js";
import { h } from "./dom.js";

export type ControlContext = {
  doc: Document;
  /** The id the field's label points at (give it to the input). */
  id: string;
  field: Field;
  path: Path;
  value: unknown;
  disabled: boolean;
  /** Write a new value (the save state, preview and checks follow, as for the standard box). */
  set: (value: unknown) => void;
  /** M16: write another field of the record (a path from the record) and show it where it is. */
  setAt: (path: Path, value: unknown) => void;
  /** M16: the standard box (label, help, control) of another field of the record — e.g. one marked `hidden`. */
  standardAt: (path: Path) => HTMLElement;
  /** The whole record as it is now in the form. */
  record: () => Record<string, unknown>;
  /** The standard box of this field (its `element`, and `show` for a value set from outside). */
  standard: () => { element: HTMLElement; show?: (value: unknown) => void };
};
export type PluginControl = { element: HTMLElement; show?: (value: unknown) => void };

export type ListRow = { id: string; label: string; status?: string; values?: Record<string, unknown> };
export type PanelContext = { doc: Document; collection?: string; file?: string };
export type PluginPanel = {
  title: string;
  /** "record": the record editor's right column; "list": above a collection's list. */
  where: "record" | "list";
  /** Which collection (or file, for "record") it is for; every one when neither is set. */
  collection?: string;
  file?: string;
  render: (context: PanelContext) => { element: HTMLElement; update?: (data: { record?: Record<string, unknown>; rows?: ListRow[] }) => void };
};
export type AdminPlugin = {
  name: string;
  controls?: Record<string, (context: ControlContext) => PluginControl>;
  panels?: PluginPanel[];
};

/** A plugin, typed: export default defineAdminPlugin({ name: "my-site", controls: { … }, panels: [ … ] }). */
export const defineAdminPlugin = (plugin: AdminPlugin): AdminPlugin => plugin;

/** Every control the plugins give, by name (a later plugin cannot take a name already given). */
export const pluginControls = (plugins: readonly AdminPlugin[]) => {
  const controls: Record<string, { plugin: string; make: (context: ControlContext) => PluginControl }> = {};
  for (const plugin of plugins) for (const [name, make] of Object.entries(plugin.controls ?? {})) if (!controls[name]) controls[name] = { plugin: plugin.name, make };
  return controls;
};

/** The note shown where a plugin failed. */
export const pluginProblem = (doc: Document, plugin: string, error: unknown) =>
  h(doc, "p", { class: "vc-plugin-problem", role: "alert" }, `The ${plugin} plugin could not show this: ${error instanceof Error ? error.message : String(error)}`);

/** The panels for a place, each as a card (title + what the plugin drew) with `update`. */
export const pluginPanels = (doc: Document, plugins: readonly AdminPlugin[], where: "record" | "list", target: { collection?: string; file?: string }) => {
  const cards: Array<{ element: HTMLElement; update: (data: { record?: Record<string, unknown>; rows?: ListRow[] }) => void }> = [];
  for (const plugin of plugins) for (const panel of plugin.panels ?? []) {
    if (panel.where !== where) continue;
    if (panel.collection !== undefined && panel.collection !== target.collection) continue;
    if (panel.file !== undefined && panel.file !== target.file) continue;
    const card = h(doc, "section", { class: `vc-record-side-card vc-plugin-panel`, "aria-label": panel.title, "data-plugin": plugin.name }, h(doc, "h2", {}, panel.title));
    let update: ((data: { record?: Record<string, unknown>; rows?: ListRow[] }) => void) | undefined;
    try {
      const drawn = panel.render({ doc, ...target });
      card.append(drawn.element);
      update = drawn.update;
    } catch (error) { card.append(pluginProblem(doc, plugin.name, error)); }
    cards.push({ element: card, update: (data) => { try { update?.(data); } catch (error) { card.querySelector(".vc-plugin-problem")?.remove(); card.append(pluginProblem(doc, plugin.name, error)); update = undefined; } } });
  }
  return cards;
};
