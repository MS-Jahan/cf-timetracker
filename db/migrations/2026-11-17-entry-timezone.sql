ALTER TABLE time_entries ADD COLUMN timezone TEXT;
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_timezone', 'Asia/Dhaka');
