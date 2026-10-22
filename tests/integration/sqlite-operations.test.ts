import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';

/**
 * What running SQLite in production needs beyond the repositories: the schema
 * reaching a file that already exists, the indexes the listings are planned
 * on, and a backup made while the server holds the database open.
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const PASSWORD = 'correct horse battery';
const NEW_INDEXES = [
  'proposal_registered',
  'proposal_status_registered',
  'policy_renewal',
  'commission_calculated',
  'commission_status_calculated',
  'notification_occurred',
  'notification_recipient_occurred',
  'user_session_user',
  'proposal_client',
  'proposal_worked_commission_mode',
];

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-sqlite-ops-'));
  file = path.join(directory, 'usina.sqlite');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function planOf(db: DatabaseSync, sql: string, ...params: string[]): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => (row as { detail: string }).detail)
    .join(' | ');
}

describe('the schema', () => {
  it('reaches a file created before the new table and indexes: they appear, data kept', () => {
    const old = openSqliteConnection(file);
    for (const name of NEW_INDEXES) {
      old.exec(`DROP INDEX ${name}`);
    }
    old.exec('DROP TABLE document_object');
    old
      .prepare('INSERT INTO document (id, file_name, content_type, content) VALUES (?, ?, ?, ?)')
      .run('doc-1', 'p.pdf', 'application/pdf', new Uint8Array([1, 2, 3]));
    old.close();

    const db = openSqliteConnection(file);
    try {
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(names).toEqual(expect.arrayContaining(['document_object', ...NEW_INDEXES]));
      expect(db.prepare('SELECT count(*) AS n FROM document').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('serves the order of the listings from the indexes, with no sort of its own', () => {
    const db = openSqliteConnection(file);
    try {
      expect(planOf(db, 'SELECT * FROM proposal ORDER BY registered_at DESC, id DESC')).toBe(
        'SCAN proposal USING INDEX proposal_registered',
      );
      expect(
        planOf(
          db,
          'SELECT * FROM proposal WHERE status = ? ORDER BY registered_at DESC, id DESC',
          'AWAITING_ISSUANCE',
        ),
      ).toContain('USING INDEX proposal_status_registered (status=?)');
      expect(
        planOf(
          db,
          'SELECT * FROM policy WHERE renewal_date <= ? ORDER BY renewal_date, id',
          '2027-01-01',
        ),
      ).toContain('USING INDEX policy_renewal (renewal_date<?)');
      expect(
        planOf(db, 'SELECT * FROM notification ORDER BY occurred_at DESC, id DESC'),
      ).not.toContain('TEMP B-TREE');
      expect(
        planOf(db, 'SELECT * FROM user_session WHERE user_id = ? AND ended_at IS NULL', 'u'),
      ).toContain('USING INDEX user_session_user (user_id=?)');
    } finally {
      db.close();
    }
  });

  it('keeps the file in WAL mode, so a reader does not block the server', () => {
    const db = openSqliteConnection(file);
    try {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    } finally {
      db.close();
    }
  });
});

describe('the backup command', () => {
  it('copies the database the server holds open, and checks the copy', async () => {
    const application = composeApplication(
      loadConfig({ NODE_ENV: 'test', PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }),
    );
    try {
      await application.useCases.createUser.execute({
        email: 'ana@usina.com.br',
        password: PASSWORD,
        role: 'ADMINISTRATOR',
        name: null,
      });
      const destination = path.join(directory, 'copia', 'usina-backup.sqlite');

      const output = execFileSync(
        process.execPath,
        [path.join(ROOT, 'src/cli/backup-sqlite.ts'), destination],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PERSISTENCE_DRIVER: 'sqlite',
            SQLITE_FILE: file,
          },
        },
      );

      expect(output).toContain('Integridade: ok');
      expect(output).toContain('app_user=1');
      const copy = new DatabaseSync(destination, { readOnly: true });
      expect(copy.prepare('SELECT email FROM app_user').get()).toEqual({
        email: 'ana@usina.com.br',
      });
      copy.close();

      // The server goes on writing after the backup.
      await application.useCases.createUser.execute({
        email: 'bia@usina.com.br',
        password: PASSWORD,
        role: 'USER',
        name: null,
      });
    } finally {
      await application.shutdown();
    }
  });

  it('never overwrites an existing file', () => {
    openSqliteConnection(file).close();
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PERSISTENCE_DRIVER: 'sqlite',
      SQLITE_FILE: file,
    };
    const command = path.join(ROOT, 'src/cli/backup-sqlite.ts');

    const result = spawnSync(process.execPath, [command, file], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('não é sobrescrito');
    expect(existsSync(file)).toBe(true);
  });
});
