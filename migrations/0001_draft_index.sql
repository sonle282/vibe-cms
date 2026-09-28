-- Vibe CMS · migration 0001: the draft index (P3).
-- Drafts live in the site's KV (<site>-session, keys "draft:<user>:<resource>"). This table lists who has a draft of
-- what, so the admin can show "My drafts" and "someone else is editing this" without scanning KV.
-- One row per (user, resource). Applied with `wrangler d1 migrations apply` (P11: `vibe-cms migrate`).

CREATE TABLE IF NOT EXISTS cms_draft_index (
  user_id        TEXT    NOT NULL,             -- the CMS user who owns the draft
  resource       TEXT    NOT NULL,             -- "file:<key>" or "item:<collection>:<id>"
  kind           TEXT    NOT NULL CHECK (kind IN ('file', 'item')),
  resource_key   TEXT    NOT NULL,             -- file key or collection key
  item_id        TEXT,                         -- record id for kind = 'item', NULL for files
  label          TEXT    NOT NULL DEFAULT '',  -- what the admin shows ("Salon info", "Spa Pedicure")
  source_version TEXT    NOT NULL,             -- sha256 of the source the draft started from (stale check, F-16)
  revision       INTEGER NOT NULL DEFAULT 1,   -- +1 on every save of this draft
  updated_at     TEXT    NOT NULL,             -- ISO 8601 UTC
  PRIMARY KEY (user_id, resource)
);

CREATE INDEX IF NOT EXISTS cms_draft_index_resource ON cms_draft_index (resource);
CREATE INDEX IF NOT EXISTS cms_draft_index_user_updated ON cms_draft_index (user_id, updated_at DESC);
