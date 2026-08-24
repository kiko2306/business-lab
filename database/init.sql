-- Homelab Manager — initial database schema
-- This script runs automatically when the PostgreSQL container is first created.

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role        VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
