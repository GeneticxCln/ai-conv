import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { migrate, getMigrationStatus, rollbackMigration } from './migrate.js';

const TEST_DB_DIR = join(__dirname, '..', '..', '..', 'tmp-test-db');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');
const TEST_MIGRATIONS_DIR = join(TEST_DB_DIR, 'migrations');

function setupTestMigrations() {
  mkdirSync(TEST_MIGRATIONS_DIR, { recursive: true });
  writeFileSync(
    join(TEST_MIGRATIONS_DIR, '001_init.sql'),
    `CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY);
     CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`,
  );
  writeFileSync(join(TEST_MIGRATIONS_DIR, '002_add_column.sql'), 'ALTER TABLE test_table ADD COLUMN name TEXT;');
}

describe('Migration System', () => {
  let database: Database.Database;

  beforeEach(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setupTestMigrations();
    database = new Database(TEST_DB_PATH);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    database.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('applies all pending migrations on the shared handle', () => {
    expect(migrate(database, TEST_MIGRATIONS_DIR)).toBe(2);
    expect(migrate(database, TEST_MIGRATIONS_DIR)).toBe(0);

    const status = getMigrationStatus(database, TEST_MIGRATIONS_DIR);
    expect(status).toEqual({ current: 2, pending: 0, total: 2 });

    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.some((table) => table.name === 'test_table')).toBe(true);
    expect(tables.some((table) => table.name === 'schema_migrations')).toBe(true);
  });

  it('does not re-apply already applied migrations', () => {
    migrate(database, TEST_MIGRATIONS_DIR);
    expect(migrate(database, TEST_MIGRATIONS_DIR)).toBe(0);
    expect(getMigrationStatus(database, TEST_MIGRATIONS_DIR).current).toBe(2);
  });

  it('reports correct status after migrations are applied', () => {
    migrate(database, TEST_MIGRATIONS_DIR);
    expect(getMigrationStatus(database, TEST_MIGRATIONS_DIR)).toEqual({ current: 2, pending: 0, total: 2 });
  });

  it('rollback removes only the migration record', () => {
    migrate(database, TEST_MIGRATIONS_DIR);
    expect(rollbackMigration(database, 2)).toBe(true);
    expect(getMigrationStatus(database, TEST_MIGRATIONS_DIR).current).toBe(1);
  });
});
