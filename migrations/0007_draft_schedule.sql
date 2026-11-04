-- Vibe CMS · migration 0007: a draft can be scheduled (F12, WordPress's "Schedule").
-- publish_at = when it is published by the site's cron (UTC ISO time; NULL = not scheduled); publish_role = the role of
-- the person who scheduled it (checked again when it runs); schedule_note = why the last scheduled publish did not go
-- out (shown on the draft). A save keeps the schedule; Discard and Publish remove the draft and its schedule.

ALTER TABLE cms_draft_index ADD COLUMN publish_at TEXT;
ALTER TABLE cms_draft_index ADD COLUMN schedule_note TEXT;
CREATE INDEX IF NOT EXISTS cms_draft_index_publish_at ON cms_draft_index (publish_at);
