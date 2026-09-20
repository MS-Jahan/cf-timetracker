-- Per-project currency (nullable: NULL inherits the client's currency).
ALTER TABLE projects ADD COLUMN currency TEXT;
