-- Vibe CMS · migration 0004: people and sign-in (P6).
-- Same mechanism as the CMS already running on the first site, so its users can be imported without a password reset:
-- the password_hash format is identical ("pbkdf2-sha256-v1$100000$salt$digest"). Differences: the id is an internal
-- text id ("usr_…", used by drafts / audit / commits), roles are owner / editor (owner = "admin" there), plus
-- display_name, must_change_password and legacy_id (the numeric id a user had in the old CMS, for the import).

CREATE TABLE IF NOT EXISTS cms_users (
  id                   TEXT    PRIMARY KEY,                                        -- internal id "usr_…"
  username             TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  display_name         TEXT    NOT NULL,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN ('owner', 'editor')),
  status               TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  session_version      INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  last_login_at        TEXT,
  password_changed_at  TEXT    NOT NULL,
  legacy_id            INTEGER UNIQUE                                               -- id in the old CMS (import only)
);
CREATE INDEX IF NOT EXISTS cms_users_status ON cms_users (status);
CREATE INDEX IF NOT EXISTS cms_users_role ON cms_users (role);

-- One-time switches, e.g. key 'bootstrap_completed' (the first owner was created from the bootstrap secrets).
CREATE TABLE IF NOT EXISTS cms_auth_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
