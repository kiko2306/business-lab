-- Check-out billing-account assignment (plan.md §656) — the proven half of
-- the legacy's CheckOut.cs (§629's "largest" item, closing part of it).
--
-- Scope decision: the legacy's account-transfer calls (NightAudit, Contas,
-- ContasLinhas) are real, uncommented Wintouch business-tier code, the same
-- kind already ported for check-in's write-back (§653). Actual fiscal
-- document/receipt generation (Wintouch's DocCab/DocumentStandard API) was
-- never finished even as a prototype — every line that would create a real
-- document is commented out in the legacy source — and no payment gateway
-- was ever chosen or integrated anywhere in this codebase. Both stay out of
-- scope here: reception still generates the actual invoice by hand in
-- Wintouch's own POS, and "paid" is a staff decision (cash/card/bank
-- transfer at the desk), not an online charge. What this migration adds is
-- the safe, proven middle step — telling Wintouch which account a
-- reservation's charges belong on — which needs no invention.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS checkout_total        numeric(10,2),
  ADD COLUMN IF NOT EXISTS checkout_computed_at   timestamptz,
  -- Set only when an admin confirms settlement (checkout.ts); defaults to
  -- the reservation's own guest in the UI, but stored explicitly rather than
  -- inferred, since a company footing the bill is exactly the case this
  -- exists for.
  ADD COLUMN IF NOT EXISTS checkout_entity_code   text,
  ADD COLUMN IF NOT EXISTS checkout_settled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_settled_by    text,
  ADD COLUMN IF NOT EXISTS checkout_integrated    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_integrated_at timestamptz;

-- Itemised, not just a total: an admin confirming "paid" should see what
-- they're confirming, same reasoning as the check-in/quiz mail bodies being
-- real editable content rather than a bare toggle (§650).
CREATE TABLE IF NOT EXISTS checkout_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  line           integer NOT NULL,
  item_name      text NOT NULL,
  quantity       numeric(10,2) NOT NULL DEFAULT 1,
  unit_price     numeric(10,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_lines_reservation_idx ON checkout_lines (reservation_id);

-- Same per-unit-switch shape as the four guest flows (units.checkin_is_active
-- etc, 001_init.sql) — this is an admin/back-office automation, not a guest
-- touch, but a property not ready to use it should still be able to opt out.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS checkout_is_active boolean NOT NULL DEFAULT false;

-- Same partial-index shape as every other due query in this schema
-- (001_init.sql, 006_birthday_promo.sql): the agent's two checkout jobs run
-- every tick and only ever match a shrinking "not done yet" slice.
CREATE INDEX IF NOT EXISTS reservations_checkout_bill_due_idx
  ON reservations (checkout_on, unit_id)
  WHERE checkout_computed_at IS NULL;

CREATE INDEX IF NOT EXISTS reservations_checkout_settle_due_idx
  ON reservations (checkout_on, unit_id)
  WHERE checkout_settled_at IS NOT NULL AND checkout_integrated = false;
