-- Migration 003: Add enabledTools column to personas.
-- This is needed because 001_init.sql was updated to include enabledTools
-- but existing databases created before that change won't have the column.
-- SQLite does not support ADD COLUMN IF NOT EXISTS, so we use a workaround:
-- Check if column exists via PRAGMA, and only add if missing.
-- The migrate.ts will handle the conditional check before applying this migration.
ALTER TABLE personas ADD COLUMN enabledTools INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (3, 'add_enabledtools_to_personas');