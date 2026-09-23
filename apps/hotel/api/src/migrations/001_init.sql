-- hotel-core's schema: the tables check-in and pulse both read (plan.md §623).
--
-- Naming is English snake_case with Postgres conventions (§626). Wintouch's
-- own Portuguese schema is the vendor's and is not renamed — the agent maps at
-- the boundary, which is the only place those names appear.
--
-- The legacy `hu_` table prefix is gone: it existed so several installs could
-- share one database, which one-box-one-client removes (§624).

-- A property. One client can be a group with several.
CREATE TABLE IF NOT EXISTS units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Wintouch's own unit code; the agent's join key, so it must be unique.
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  -- Per-unit switches for each guest flow. There are four, not two: birthday
  -- and promo are half-built in the legacy and in scope for the rebuild (§629).
  checkin_is_active   boolean NOT NULL DEFAULT false,
  quiz_is_active      boolean NOT NULL DEFAULT false,
  birthday_is_active  boolean NOT NULL DEFAULT false,
  promo_is_active     boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Which Authelia identity may see which unit (§629). Replaces the legacy
-- `users` table and `unit_user` outright — no passwords, no accounts.
CREATE TABLE IF NOT EXISTS unit_access (
  identity   text NOT NULL,
  unit_id    uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity, unit_id)
);

-- Guests, synced out of Wintouch. The document fields are what the check-in
-- form collects and writes back, so they are nullable until it does.
CREATE TABLE IF NOT EXISTS guests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  address_line3 text,
  postal_code   text,
  city          text,
  country       text,
  nationality   text,
  tax_number    text,
  gender        smallint,
  document_type smallint,
  document_number text,
  document_check  text,
  document_issued date,
  document_expires date,
  document_place  text,
  document_country text,
  document_issuer text,
  birth_place   date,
  birth_date    date,
  -- Set when the guest edits their details, so the agent knows to write back.
  has_changes   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One reservation carries *both* flows' state, which is why check-in and pulse
-- share a database rather than each keeping their own (§628 found this in the
-- legacy schema and it is the reason hotel-core exists).
CREATE TABLE IF NOT EXISTS reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  -- Wintouch identifies a reservation by (unit, number, line).
  number      text NOT NULL,
  line        integer NOT NULL,
  guest_id    uuid REFERENCES guests(id) ON DELETE SET NULL,
  room_code   text,
  room_name   text,
  adults      integer NOT NULL DEFAULT 1,
  children    integer NOT NULL DEFAULT 0,
  babies      integer NOT NULL DEFAULT 0,
  checkin_on  date NOT NULL,
  checkout_on date NOT NULL,
  status      text NOT NULL,
  channel     text,
  -- The capability that makes a guest link work, so it must be unguessable:
  -- gen_random_uuid() is v4 (§628).
  token       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- check-in's columns.
  checkin_sent    boolean NOT NULL DEFAULT false,
  checkin_success boolean NOT NULL DEFAULT false,
  checkin_notified boolean NOT NULL DEFAULT false,
  -- pulse's columns.
  quiz_sent       boolean NOT NULL DEFAULT false,
  quiz_answered   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, number, line)
);

-- The other occupants on a reservation, collected by the check-in form.
CREATE TABLE IF NOT EXISTS guest_extras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  code           text,
  first_name     text,
  last_name      text,
  email          text,
  phone          text,
  address_line1  text,
  postal_code    text,
  city           text,
  country        text,
  nationality    text,
  tax_number     text,
  gender         smallint,
  document_type  smallint,
  document_number text,
  document_country text,
  birth_date     date,
  -- Wintouch's GrupoEtario: which age band this occupant counts as.
  age_group      smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The on-premise agent, same shape as tally's (§627, §631): one active per
-- deployment, a hash of the token rather than the token, revoked by a column
-- so history survives and the next call 401s.
CREATE TABLE IF NOT EXISTS agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text NOT NULL DEFAULT 'Property agent',
  token_hash   text NOT NULL UNIQUE,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

-- One active agent for the whole deployment: unlike tally, where an agent is
-- per shop, the hotel agent iterates every unit itself (§620).
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_active_idx
  ON agents ((true))
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS enrolment_codes (
  code_hash  text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrolment_codes_unused_expiry_idx
  ON enrolment_codes (expires_at)
  WHERE used_at IS NULL;

-- §626: the two schedulers run **every minute**, and the legacy had no index
-- for either. Partial, because each only ever matches rows whose "sent" flag
-- is still false — which is a shrinking minority of the table as a season goes
-- on, so the partial index stays small while the table does not.
CREATE INDEX IF NOT EXISTS reservations_checkin_due_idx
  ON reservations (checkin_on, unit_id)
  WHERE checkin_sent = false AND checkin_success = false;

CREATE INDEX IF NOT EXISTS reservations_quiz_due_idx
  ON reservations (checkout_on, unit_id)
  WHERE quiz_sent = false;

-- Guest links resolve by token on every page load of the check-in and
-- feedback forms; the UNIQUE constraint already indexes it.
-- Extras are always read by their reservation.
CREATE INDEX IF NOT EXISTS guest_extras_reservation_idx
  ON guest_extras (reservation_id);
