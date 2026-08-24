-- Homelab Manager — initial database schema
-- This script runs automatically when the PostgreSQL container is first created.

CREATE TABLE IF NOT EXISTS users (
    id                SERIAL PRIMARY KEY,
    username          VARCHAR(100) NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    role              VARCHAR(50) NOT NULL DEFAULT 'viewer',
    is_setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(200) PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_configs (
    name        VARCHAR(100) PRIMARY KEY,
    label       VARCHAR(200),
    description TEXT,
    compose_path TEXT,
    icon        VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
