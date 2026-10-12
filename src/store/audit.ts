/**
 * P4: the audit log (migrations 0003 + 0005): lock denials (P4), publishes (P5), sign-in and People (P6). P12b: read in
 * pages (`before`) and by kind (`stages`, `actions`) for the Activity screen.
 */
import type { AuditEntry, AuditLog } from "../locks/index.js";
import type { D1Like } from "./index.js";
import { assertUserId } from "./index.js";

type Row = { id: number; at: string; user_id: string; role: AuditEntry["role"]; action: AuditEntry["action"]; stage: AuditEntry["stage"]; resource: string; detail: string };
const fromRow = (row: Row) => ({ id: Number(row.id), at: row.at, userId: row.user_id, role: row.role, action: row.action, stage: row.stage, resource: row.resource, detail: JSON.parse(row.detail) as Record<string, unknown> });

export const createD1AuditLog = (db: D1Like): AuditLog => ({
  async record(entry) {
    assertUserId(entry.userId);
    await db.prepare("INSERT INTO cms_audit_log (at, user_id, role, action, stage, resource, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(entry.at, entry.userId, entry.role, entry.action, entry.stage, entry.resource, JSON.stringify(entry.detail)).run();
  },
  async list({ resource, limit = 50, before, stages, actions } = {}) {
    const where: string[] = [], values: unknown[] = [];
    if (resource) { where.push("resource = ?"); values.push(resource); }
    if (before !== undefined) { where.push("id < ?"); values.push(before); }
    if (stages?.length) { where.push(`stage IN (${stages.map(() => "?").join(", ")})`); values.push(...stages); }
    if (actions?.length) { where.push(`action IN (${actions.map(() => "?").join(", ")})`); values.push(...actions); }
    const sql = `SELECT * FROM cms_audit_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    return (await db.prepare(sql).bind(...values, limit).all<Row>()).results.map(fromRow);
  },
});

export const createMemoryAuditLog = (): AuditLog & { entries: Array<AuditEntry & { id: number }> } => {
  const entries: Array<AuditEntry & { id: number }> = [];
  return {
    entries,
    async record(entry) { assertUserId(entry.userId); entries.push({ ...structuredClone(entry), id: entries.length + 1 }); },
    async list({ resource, limit = 50, before, stages, actions } = {}) {
      return entries.filter((entry) => (!resource || entry.resource === resource) && (before === undefined || entry.id < before) && (!stages?.length || stages.includes(entry.stage)) && (!actions?.length || actions.includes(entry.action))).slice(-limit).reverse();
    },
  };
};
