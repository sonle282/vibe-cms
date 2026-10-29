-- Vibe CMS · migration 0006: a draft keeps the content it started from (F3).
-- When someone publishes after a draft was started, the draft is carried over field by field: a field only the website
-- changed takes the website's value, a field only the draft changed keeps the draft's. That needs the starting content,
-- not just its version. NULL = not kept (drafts saved before 0006, or too large to keep twice): such a draft still says
-- "the website changed" as before. The draft content and its source together stay under MAX_DRAFT_BYTES.

ALTER TABLE cms_draft_index ADD COLUMN source_content TEXT;
