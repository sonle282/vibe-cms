-- Vibe CMS · migration 0003: the audit log, minimal (P4). P5 adds publish rows (started / succeeded / failed) to the
-- same table. One row per event; `detail` is JSON with paths, labels, reasons and ids only — never content values.

CREATE TABLE IF NOT EXISTS cms_audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL,                                                   -- ISO 8601 UTC
  user_id  TEXT    NOT NULL,                                                   -- internal user id (never an email)
  role     TEXT    NOT NULL CHECK (role IN ('owner', 'editor')),
  action   TEXT    NOT NULL CHECK (action IN ('started', 'succeeded', 'failed', 'denied')),
  stage    TEXT    NOT NULL CHECK (stage IN ('draft', 'publish')),
  resource TEXT    NOT NULL,                                                   -- "file:<key>" / "item:<collection>:<id>"
  detail   TEXT    NOT NULL DEFAULT '{}'                                       -- JSON, no content values
);

CREATE INDEX IF NOT EXISTS cms_audit_log_resource ON cms_audit_log (resource, id DESC);
CREATE INDEX IF NOT EXISTS cms_audit_log_user ON cms_audit_log (user_id, id DESC);
