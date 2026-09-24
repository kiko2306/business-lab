-- The hotel's own SMTP sender, so guest mail carries the property's address
-- rather than the dashboard's shared mailbox (plan.md §629's decision #5,
-- picked up as its own slice in §648). Single row: one sender for the whole
-- deployment, same granularity as the dashboard's own mail settings.

CREATE TABLE IF NOT EXISTS smtp_settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  host         text NOT NULL DEFAULT '',
  port         integer NOT NULL DEFAULT 587,
  encryption   text NOT NULL DEFAULT 'tls' CHECK (encryption IN ('tls', 'ssl', 'none')),
  username     text NOT NULL DEFAULT '',
  password     text NOT NULL DEFAULT '',
  from_address text NOT NULL DEFAULT '',
  from_name    text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
