/**
 * P4: the audit log (migration 0003_audit_log.sql). Minimal for now — lock denials; P5 adds publish events.
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
  async list({ resource, limit = 50 } = {}) {
    const query = resource
      ? db.prepare("SELECT * FROM cms_audit_log WHERE resource = ? ORDER BY id DESC LIMIT ?").bind(resource, limit)
      : db.prepare("SELECT * FROM cms_audit_log ORDER BY id DESC LIMIT ?").bind(limit);
    return (await query.all<Row>()).results.map(fromRow);
  },
});

export const createMemoryAuditLog = (): AuditLog & { entries: Array<AuditEntry & { id: number }> } => {
  const entries: Array<AuditEntry & { id: number }> = [];
  return {
    entries,
    async record(entry) { assertUserId(entry.userId); entries.push({ ...structuredClone(entry), id: entries.length + 1 }); },
    async list({ resource, limit = 50 } = {}) { return entries.filter((entry) => !resource || entry.resource === resource).slice(-limit).reverse(); },
  };
};
