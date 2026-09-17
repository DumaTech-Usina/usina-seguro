import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Opens the SQLite connection and applies the schema.
 *
 * `node:sqlite` ships with Node (>= 22.6), which avoids a compiled dependency.
 * Its API is synchronous; the repository exposes async methods because the core
 * contract is async, not because the driver is.
 *
 * SQLite is used for integration tests, load tests and local development.
 * Production is PostgreSQL.
 */
export function openSqliteConnection(file: string): DatabaseSync {
  const db = new DatabaseSync(file);

  // SQLite disables foreign keys by default; PostgreSQL always enforces them.
  // Enabling it here prevents a test from passing due to missing referential
  // integrity.
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

  return db;
}
