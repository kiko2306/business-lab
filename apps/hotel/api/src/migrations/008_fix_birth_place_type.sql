-- guests.birth_place was declared `date` in 001_init.sql, sitting right next
-- to the genuinely-a-date birth_date — a copy-paste slip, not a deliberate
-- choice: it holds a *place name* (the legacy's `birth_local`, e.g.
-- "Lisboa"), the same as guest_extras never had this column at all. Nothing
-- has ever written to it, so this was never caught until the legacy data
-- import (plan.md §658) needed to actually put a place name in it.

ALTER TABLE guests ALTER COLUMN birth_place TYPE text USING birth_place::text;
