-- Vibe CMS · migration 0002: drafts live in D1 (P3b).
-- KV is eventually consistent (a write can take ~60 s to show in other locations), so a revision check on KV is not
-- safe. From 0002 the draft content is stored in cms_draft_index itself, which becomes the single source of truth:
-- saves check the revision with one atomic statement (UPDATE … WHERE revision = ?; 0 rows changed = conflict).
-- KV keeps sessions only. Content = the draft's JSON; D1 allows 2,000,000 bytes per row, the package caps a draft at
-- 1,900,000 bytes (MAX_DRAFT_BYTES). No existing site has drafts yet, so existing rows (none) get "null".

ALTER TABLE cms_draft_index ADD COLUMN content TEXT NOT NULL DEFAULT 'null';
