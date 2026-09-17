import type { DatabaseSync } from 'node:sqlite';
import type { Transaction } from '../../../core/policy/application/transaction.ts';

/**
 * `Transaction` implementation on SQLite.
 *
 * It uses `SAVEPOINT` rather than `BEGIN` so a unit of work can contain another
 * one: `RegisterPolicy` wraps two repository writes and the policy repository
 * already wraps its own multi-row write. `BEGIN` inside `BEGIN` is an error in
 * SQLite; nested savepoints are not.
 *
 * Every savepoint gets a distinct name, so rolling back an inner one never
 * touches the outer.
 */
export class SqliteTransaction implements Transaction {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    return withSavepoint(this.db, `tx_${this.depth++}`, work).finally(() => {
      this.depth--;
    });
  }
}

/**
 * Runs `work` inside a named savepoint, releasing it on success and rolling
 * back to it on failure.
 */
export async function withSavepoint<T>(
  db: DatabaseSync,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  db.exec(`SAVEPOINT ${name}`);

  try {
    const result = await work();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw error;
  }
}
