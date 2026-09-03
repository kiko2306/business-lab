-- Homelab Manager — initial database schema
-- This script runs automatically when the PostgreSQL container is first created.

-- Every account is an administrator; there is no restricted role tier.
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
    totp_enrolled_at  TIMESTAMPTZ
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
