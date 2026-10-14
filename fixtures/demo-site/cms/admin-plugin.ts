// The demo's own admin code (M14): what only this site needs, bundled into /admin (cms.config.ts admin.plugins).
// - "call-for-price": the Mr Spa CMS's price box with "Show “Call for price” instead" (the standard box, wrapped);
// - a panel above the Services list, and one in a team member's right column.
import { defineAdminPlugin } from "@sonle282/vibe-cms/admin";

export const CALL_FOR_PRICE = "Call for price";

export default defineAdminPlugin({
  name: "demo",
  controls: {
    "call-for-price": ({ doc, id, value, set, standard, disabled }) => {
      const box = standard();
      const tick = doc.createElement("input");
      tick.type = "checkbox";
      tick.id = `${id}-call`;
      tick.disabled = disabled;
      const label = doc.createElement("label");
      label.className = "vc-check";
      label.append(tick, " Show “Call for price” instead");
      const note = doc.createElement("p");
      note.className = "vc-help";
      const sync = (current: unknown) => {
        const call = current === CALL_FOR_PRICE;
        tick.checked = call;
        box.element.hidden = call;
        note.hidden = !call;
        note.textContent = call ? "Shoppers see “Call for price” instead of a price." : "";
      };
      tick.addEventListener("change", () => {
        const next = tick.checked ? CALL_FOR_PRICE : "";
        set(next);
        box.show?.(next);
        sync(next);
        if (!tick.checked) box.element.querySelector("input")?.focus();
      });
      sync(value);
      const element = doc.createElement("div");
      element.className = "vc-demo-price";
      element.append(box.element, label, note);
      return { element, show: (next) => { box.show?.(next); sync(next); } };
    },
  },
  panels: [
    {
      title: "On the Services page",
      where: "list",
      collection: "services",
      render: ({ doc }) => {
        const text = doc.createElement("p");
        text.className = "vc-record-side-note";
        return {
          element: text,
          update: ({ rows = [] }) => {
            const categories = new Set(rows.map((row) => row.values?.category).filter(Boolean)).size;
            text.textContent = `${rows.length} services in ${categories} ${categories === 1 ? "category" : "categories"}, in this order.`;
          },
        };
      },
    },
    {
      title: "Profile",
      where: "record",
      collection: "team",
      render: ({ doc }) => {
        const text = doc.createElement("p");
        text.className = "vc-record-side-note";
        return {
          element: text,
          update: ({ record = {} }) => {
            const filled = ["name", "specialty", "photo", "bio"].filter((key) => {
              const entry = record[key];
              return typeof entry === "string" ? entry.trim() !== "" : Boolean(entry && typeof entry === "object" && "src" in entry);
            }).length;
            text.textContent = `${filled} of 4 details filled in.`;
          },
        };
      },
    },
  ],
});
