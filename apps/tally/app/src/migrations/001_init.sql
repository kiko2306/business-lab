-- Tally's own schema. Deliberately small: tally stores no business data at
-- all — sales, tables and staff takings are read live from each shop's agent
-- on demand (plan.md §622, §627), so there is nothing here to mirror the POS.
-- What it does own is which shops exist, who may see them, and which agent is
-- enrolled for each.

-- One row per shop. No `ip` column: the legacy design had each shop publish
-- its public IP every 30 seconds so the cloud could call in (§622). Agents now
-- dial out and hold the connection, so there is no address to record.
CREATE TABLE IF NOT EXISTS stores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Which Authelia identity may see which store. Authelia is the identity
-- (§629), so this replaces the legacy `users` table and its `access[]` array
-- of store ids outright — no passwords, no accounts, just the mapping.
CREATE TABLE IF NOT EXISTS store_access (
  identity   text NOT NULL,
  store_id   uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity, store_id)
);

-- The enrolled agent for a store. One per store (a shop has one POS server),
-- enforced by the UNIQUE on store_id.
--
-- `token_hash` holds a hash, never the token: the agent keeps the only copy,
-- so a dump of this table does not let anyone impersonate a shop. Revoking is
-- setting `revoked_at`; the agent's next call then 401s (§627).
CREATE TABLE IF NOT EXISTS agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  -- Replaces the legacy single-row conn_logs heartbeat, which could only say
  -- whether *something* had called recently (§627).
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

-- Single-use enrolment codes, exchanged once for a long-lived agent token.
-- The code expires (minutes) even though the token it yields does not — a
-- one-time code should, an agent credential should not (§627).
CREATE TABLE IF NOT EXISTS enrolment_codes (
  code_hash  text PRIMARY KEY,
  store_id   uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial: only unused codes are ever swept, and they are a small minority of
-- the table's lifetime rows.
CREATE INDEX IF NOT EXISTS enrolment_codes_unused_expiry_idx
  ON enrolment_codes (expires_at)
  WHERE used_at IS NULL;
