-- Tally sends no email, so its own SMTP sender is gone (plan.md §676). Dropped
-- rather than left behind: 002_smtp.sql no longer exists to create it on a fresh
-- database, and an existing one still carries the table and a stored password.
DROP TABLE IF EXISTS smtp_settings;
