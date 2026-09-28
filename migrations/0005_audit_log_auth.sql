-- Vibe CMS · migration 0005: the audit log also records sign-in and People events (P6).
-- SQLite cannot change a CHECK constraint, so the table is rebuilt with the wider lists; every existing row is copied.
--   stage:  draft | publish | auth | people
--   action: started | succeeded | failed | denied (publish / draft)
--           login | login_failed | logout | password_change | bootstrap (auth)
--           user_create | user_disable | user_enable | user_password_reset | user_role_change (people)
--   role:   owner | editor | anonymous (a failed sign-in with an unknown username)
-- Never passwords, hashes or tokens — detail holds ids, usernames of existing users, reasons.

CREATE TABLE cms_audit_log_v2 (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  role     TEXT    NOT NULL CHECK (role IN ('owner', 'editor', 'anonymous')),
  action   TEXT    NOT NULL CHECK (action IN ('started', 'succeeded', 'failed', 'denied', 'login', 'login_failed', 'logout', 'password_change', 'bootstrap',
                                              'user_create', 'user_disable', 'user_enable', 'user_password_reset', 'user_role_change')),
  stage    TEXT    NOT NULL CHECK (stage IN ('draft', 'publish', 'auth', 'people')),
  resource TEXT    NOT NULL,
  detail   TEXT    NOT NULL DEFAULT '{}'
);
INSERT INTO cms_audit_log_v2 (id, at, user_id, role, action, stage, resource, detail)
  SELECT id, at, user_id, role, action, stage, resource, detail FROM cms_audit_log;
DROP TABLE cms_audit_log;
ALTER TABLE cms_audit_log_v2 RENAME TO cms_audit_log;
CREATE INDEX IF NOT EXISTS cms_audit_log_resource ON cms_audit_log (resource, id DESC);
CREATE INDEX IF NOT EXISTS cms_audit_log_user ON cms_audit_log (user_id, id DESC);
