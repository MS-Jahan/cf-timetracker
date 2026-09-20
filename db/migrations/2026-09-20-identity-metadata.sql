-- Optional visual identity metadata for master data.
-- Existing records remain valid; NULL means use initials/name fallback.
ALTER TABLE customers ADD COLUMN image_url TEXT;
ALTER TABLE projects ADD COLUMN image_url TEXT;
ALTER TABLE activities ADD COLUMN emoji TEXT;
ALTER TABLE activities ADD COLUMN image_url TEXT;
