import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { containsIgnoringCase } from '../../../core/commission/application/list-eligible-payouts.ts';
import { matchesClientQuery } from '../../../core/registry/application/list-clients.ts';

/**
 * Opens the SQLite connection and applies the schema.
 *
 * `node:sqlite` ships with Node (>= 22.6), which avoids a compiled dependency.
 * Its API is synchronous; the repository exposes async methods because the core
 * contract is async, not because the driver is.
 *
 * SQLite is the database of integration tests, local development and the
 * first production deploy (one instance, see SQLITE-NOTES.md).
 */
export function openSqliteConnection(file: string): DatabaseSync {
  const db = new DatabaseSync(file);

  // SQLite disables foreign keys by default; PostgreSQL always enforces them.
  // Enabling it here prevents a test from passing due to missing referential
  // integrity.
  db.exec('PRAGMA foreign_keys = ON');

  // WAL: a reader -- `npm run backup` while the server runs -- never blocks
  // the server's writes, nor they the reader. The mode stays in the file, and
  // the `-wal` and `-shm` files next to it are part of the database: copying
  // the `.sqlite` alone while it is open is not a backup. A second writer (a
  // command run on the server) waits up to 5 s for the lock instead of
  // failing at once.
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

  reusePreparedStatements(db);
  registerMatchingRules(db);

  return db;
}

/**
 * The matching rules of the searches, as SQL functions, so a listing filters
 * and counts in its own query (REQ-333) with the core's rule and not with an
 * approximation of it: `LIKE` folds the case of ASCII letters only, and the
 * core compares "José" and "JOSÉ" as the same.
 */
function registerMatchingRules(db: DatabaseSync): void {
  const flag = (matches: boolean) => (matches ? 1 : 0);
  // REQ-316, REQ-319.
  db.function('usina_client_matches', { deterministic: true }, (name, cpf, query) =>
    flag(matchesClientQuery(String(name), String(cpf), query === null ? undefined : String(query))),
  );
  // REQ-284.
  db.function('usina_contains', { deterministic: true }, (value, part) =>
    flag(containsIgnoringCase(String(value ?? ''), part === null ? undefined : String(part))),
  );
}

/**
 * The repositories call `prepare` for every query, and a listing runs a few
 * queries per row: compiling the same SQL again each time was about half of
 * the time of listing 10 000 proposals. The same SQL now answers the same
 * statement. Safe because the driver is synchronous and no repository keeps
 * an `iterate()` open while it runs another query.
 */
function reusePreparedStatements(db: DatabaseSync): void {
  const prepare = db.prepare.bind(db);
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  db.prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
}
