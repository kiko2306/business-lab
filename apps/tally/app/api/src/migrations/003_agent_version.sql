-- The agent's own version, reported on every connect (plan.md §672), so the
-- shop page can say what is installed there — and keep saying it while the
-- shop is offline, which is when someone wonders whether it needs updating.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version text;
