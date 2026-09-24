-- Check-in/quiz guest email scheduler (plan.md §651), reading the SMTP
-- sender (003) and guest-text templates (004) already built.

-- Per-unit send offset, days before check-in / after check-out — the legacy
-- system's `checkin:send` / `quiz:send` semantics (§620). Signed, not just
-- unsigned: a negative quiz offset (send before checkout) is a plausible
-- future setting even though today's admin UI only offers >= 0.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS checkin_offset_days smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quiz_offset_days     smallint NOT NULL DEFAULT 1;

-- Who the 15-minute agent-down alert goes to. Blank skips sending it — same
-- "not (yet) configured, fail fast rather than dial nothing" shape as the
-- SMTP row itself (smtpSettings.ts).
ALTER TABLE smtp_settings
  ADD COLUMN IF NOT EXISTS alert_email text NOT NULL DEFAULT '';

-- Set when the down alert fires, cleared by the same heartbeat that bumps
-- last_seen_at (auth.ts) — so the scheduler sends exactly one alert per
-- outage instead of one every minute for as long as the agent stays down.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS down_alert_sent_at timestamptz;
