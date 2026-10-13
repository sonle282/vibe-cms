/**
 * M2: the two roles are Admin and Editor (the Mr Spa CMS's names). The Admin role is stored as "owner" — its code since
 * P6 (a D1 CHECK constraint; never shown). In cms.config, locked / access say "admin"; "owner" is the old name and works.
 * A tiny module on purpose: the browser's admin imports it without the config checker.
 */
export const isAdminOnly = (value: unknown): value is "admin" | "owner" => value === "admin" || value === "owner";
