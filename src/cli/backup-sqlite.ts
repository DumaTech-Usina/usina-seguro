import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config/config.ts';

/**
 * A consistent copy of the SQLite database, made while the server runs:
 *
 *   npm run backup                       # <folder of SQLITE_FILE>/backups/usina-<moment>.sqlite
 *   npm run backup -- <destination file>
 *
 * `VACUUM INTO` writes a single, compacted file from one read transaction; in
 * WAL mode it does not block the server. The copy is then opened and checked
 * (`integrity_check`) and the rows of the main tables are counted, so a backup
 * that is reported is one that opens.
 *
 * With DOCUMENT_STORAGE=r2 the bytes of the PDFs are in the bucket, not in
 * this file: they need their own protection (see README).
 */
const COUNTED = ['proposal', 'policy', 'client', 'broker', 'document', 'app_user'];

function main(): number {
  const { persistence } = loadConfig();
  if (persistence.driver !== 'sqlite' || persistence.file === ':memory:') {
    console.error('O backup é do arquivo SQLite: use PERSISTENCE_DRIVER=sqlite com SQLITE_FILE.');
    return 1;
  }
  const source = path.resolve(persistence.file);
  if (!existsSync(source)) {
    console.error(`Banco não encontrado: ${source}`);
    return 1;
  }

  const moment = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(
    process.argv[2] ?? path.join(path.dirname(source), 'backups', `usina-${moment}.sqlite`),
  );
  if (existsSync(destination)) {
    console.error(`O destino já existe e não é sobrescrito: ${destination}`);
    return 1;
  }
  mkdirSync(path.dirname(destination), { recursive: true });

  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }

  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') {
      console.error(`Cópia com problema de integridade: ${integrity.integrity_check}`);
      return 1;
    }
    const counts = COUNTED.map((table) => {
      const row = copy.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      return `${table}=${row.n}`;
    });
    console.log(`Backup gravado e verificado: ${destination}`);
    console.log(`Integridade: ok | ${counts.join(' ')}`);
    return 0;
  } finally {
    copy.close();
  }
}

process.exit(main());
