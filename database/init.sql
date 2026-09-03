-- Homelab Manager — initial database schema
-- This script runs automatically when the PostgreSQL container is first created.

CREATE TABLE IF NOT EXISTS users (
    id                SERIAL PRIMARY KEY,
    username          VARCHAR(100) NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    is_setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Optional TOTP second factor (plan.md §127). totp_secret holds the
    -- AES-GCM-sealed base32 secret (see utils/totpSecret.ts), NULL until the
    -- user starts enrolment; totp_enabled flips true only once they prove a
    -- code.
    totp_secret       TEXT,
    totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    totp_enrolled_at  TIMESTAMPTZ,
    -- Contact address, and the address written into Authelia's user database
    -- for an SSO account (plan.md §151). Nullable: accounts created before
    -- this column keep NULL until edited; the users API requires it on create.
    email             VARCHAR(255)
);

-- Single-use TOTP recovery codes: only the SHA-256 hash is kept. Replaced
-- wholesale on (re-)enrolment; a row's used_at is stamped when it is redeemed.
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS totp_recovery_codes_user_id_idx ON totp_recovery_codes (user_id);

-- Named roles per account (plan.md §149, reshaped §152). Roles are
-- 'webmaster' (every capability, always), 'admin' (per-account feature grants
-- in user_capabilities below — no rows means all-on) and 'user' (no dashboard;
-- SSO app access only). A user may hold several. The first admin (from /setup)
-- and every account on a database that predates this table are backfilled with
-- 'webmaster' by ensureUserRolesTable(); ensureRoleModelReshape() renames any
-- legacy 'owner'/'it_admin' rows.
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    VARCHAR(20) NOT NULL,
    PRIMARY KEY (user_id, role)
);

-- Per-admin dashboard feature grants (plan.md §152). Only consulted for an
-- account holding 'admin' (and not 'webmaster'); no rows for such an account
-- means every feature is on. A webmaster ticks features off here.
CREATE TABLE IF NOT EXISTS user_capabilities (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    capability VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, capability)
);

-- Which managed apps an account may reach through Authelia SSO (plan.md
-- §151). Explicit allowlist: no rows means no SSO app access. The set of
-- valid service_name values is the apps that are currently exposed and
-- Authelia-protected; the dashboard writes matching group membership into
-- Authelia's user database from these rows.
CREATE TABLE IF NOT EXISTS user_app_access (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_name VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, service_name)
);

CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(200) PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- First-start public exposure provisioning state (see plan.md section 16).
CREATE TABLE IF NOT EXISTS service_exposure (
    service_name    VARCHAR(100) PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    hostname        VARCHAR(255),
    upstream_scheme VARCHAR(10) NOT NULL DEFAULT 'http',
    upstream_host   VARCHAR(255),
    upstream_port   INTEGER,
    websocket       BOOLEAN NOT NULL DEFAULT FALSE,
    authelia_protected BOOLEAN NOT NULL DEFAULT FALSE,
    npm_host_id     INTEGER,
    cf_hostname_id  TEXT,
    status          VARCHAR(50) NOT NULL DEFAULT 'not_provisioned',
    last_error      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     VARCHAR(200) NOT NULL,
    resource   VARCHAR(200),
    result     VARCHAR(50),
    metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
