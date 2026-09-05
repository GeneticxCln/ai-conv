import { join, dirname } from 'path';
import { mkdirSync, readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import Database, { Database as DatabaseType } from 'better-sqlite3';

// Match storage/db.ts: local development uses the backend workspace data
// directory regardless of the caller's current working directory. Packaged
// and Docker launches still override this with DATABASE_PATH.
const DEFAULT_DB_PATH = process.env.DATABASE_PATH || join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'ai-conv.db',
);
const DEFAULT_MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

export interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

function getMigrationFiles(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        throw new Error(`Invalid migration filename: ${file}. Expected format: NNN_name.sql`);
      }
      return {
        version: parseInt(match[1], 10),
        name: match[2],
        path: join(migrationsDir, file),
      };
    })
    .sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const file of files) {
    if (seen.has(file.version)) {
      throw new Error(`Duplicate migration version: ${file.version}`);
    }
    seen.add(file.version);
  }
  return files;
}

function getCurrentVersion(database: DatabaseType): number {
  try {
    const row = database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

function applyMigration(database: DatabaseType, file: MigrationFile): void {
  const sql = readFileSync(file.path, 'utf8');

  const transaction = database.transaction(() => {
    database.exec(sql);
    database
      .prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(file.version, file.name);
  });

  transaction();
  console.log(`[Migration] Applied v${file.version}: ${file.name}`);
}

/** Apply pending migrations using the exact database connection owned by the caller. */
export function migrate(
  database: DatabaseType,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): number {
  const files = getMigrationFiles(migrationsDir);
  const currentVersion = getCurrentVersion(database);
  const pending = files.filter((file) => file.version > currentVersion);

  if (pending.length === 0) {
    return 0;
  }

  for (const file of pending) {
    // Special handling for migration 003: check if enabledTools column already exists
    if (file.version === 3) {
      try {
        const cols = database
          .prepare("SELECT name FROM pragma_table_info('personas') WHERE name = 'enabledTools'")
          .all() as { name: string }[];
        if (cols.length > 0) {
          // Column exists, just record the migration as applied
          database
            .prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)')
            .run(3, 'add_enabledtools_to_personas');
          console.log('[Migration] Skipped v3: enabledTools column already exists');
          continue;
        }
      } catch {
        // If check fails, proceed with migration normally
      }
    }
    applyMigration(database, file);
  }
  return pending.length;
}

export function getMigrationStatus(
  database: DatabaseType,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): { current: number; pending: number; total: number } {
  const files = getMigrationFiles(migrationsDir);
  const current = getCurrentVersion(database);
  return {
    current,
    pending: files.filter((file) => file.version > current).length,
    total: files.length,
  };
}

export function rollbackMigration(database: DatabaseType, version: number): boolean {
  const result = database
    .prepare('DELETE FROM schema_migrations WHERE version = ?')
    .run(version);
  return result.changes > 0;
}

/** CLI helper used by `npm run db:push`; application code calls migrate(db) instead. */
export function migrateDatabase(
  dbPath = DEFAULT_DB_PATH,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): number {
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.pragma('foreign_keys = ON');
  try {
    return migrate(database, migrationsDir);
  } finally {
    database.close();
  }
}

if (process.argv[1] && /(?:^|[\\/])migrate\.(?:ts|js)$/.test(process.argv[1])) {
  migrateDatabase();
}
