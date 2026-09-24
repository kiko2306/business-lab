-- Birthday and promo guest emails, closing the last two of §629's four guest
-- flows (checkin/quiz landed in 005_email_schedule.sql). Both are
-- effectively new features, not a port — the legacy had only an enum and an
-- empty `switch` case (§620, §629) — so there is no existing scheduling
-- behaviour to match; this is the design taken.
--
-- Scoped to the reservation, like checkin_sent/quiz_sent, not to the guest
-- globally: birthday fires only for a guest staying during their own
-- birthday (a check-in-desk surprise, not an annual mailshot to everyone
-- who ever stayed), and promo fires once per stay rather than needing a
-- separate "campaign" concept of its own. A returning guest's next
-- reservation is a fresh row, so both fire again naturally with no extra
-- bookkeeping.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS birthday_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_sent    boolean NOT NULL DEFAULT false;

-- Same partial-index shape as checkin/quiz (001_init.sql) — the scheduler
-- runs every minute and only ever matches the shrinking "not sent yet" slice.
CREATE INDEX IF NOT EXISTS reservations_birthday_due_idx
  ON reservations (checkin_on, unit_id)
  WHERE birthday_sent = false;

CREATE INDEX IF NOT EXISTS reservations_promo_due_idx
  ON reservations (checkin_on, unit_id)
  WHERE promo_sent = false;
