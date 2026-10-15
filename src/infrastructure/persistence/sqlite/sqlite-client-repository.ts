import type { DatabaseSync } from 'node:sqlite';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import type { ClientRepository } from '../../../core/registry/application/client-repository.ts';
import { Client } from '../../../core/registry/domain/client.ts';
import { Cpf } from '../../../core/registry/domain/cpf.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface ClientRow {
  id: string;
}

interface RecordRow {
  name: string;
  cpf: string;
  signed_by: string;
  signed_at: string;
}

/**
 * The client is two tables: its current name and CPF, written in place, and
 * the append-only signed records (REQ-314). A record already stored is left
 * as it is.
 */
export class SqliteClientRepository implements ClientRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(client: Client): Promise<void> {
    await withSavepoint(this.db, 'client_save', async () => {
      this.db
        .prepare(
          `INSERT INTO client (id, name, cpf) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, cpf = excluded.cpf`,
        )
        .run(client.id, client.name, client.cpf.digits);

      const record = this.db.prepare(
        `INSERT INTO client_record (client_id, sequence, name, cpf, signed_by, signed_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      client.records.forEach((item, index) => {
        record.run(
          client.id,
          index + 1,
          item.name,
          item.cpf.digits,
          item.signed.author,
          item.signed.at.toISOString(),
        );
      });
    });
  }

  async findById(id: string): Promise<Client | null> {
    const row = this.db.prepare('SELECT id FROM client WHERE id = ?').get(id) as
      | ClientRow
      | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async findByCpf(digits: string): Promise<Client | null> {
    const row = this.db.prepare('SELECT id FROM client WHERE cpf = ?').get(digits) as
      | ClientRow
      | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async list(): Promise<readonly Client[]> {
    const rows = this.db
      .prepare('SELECT id FROM client ORDER BY name, id')
      .all() as unknown as ClientRow[];

    return rows.map((row) => this.restore(row));
  }

  private restore(row: ClientRow): Client {
    const records = this.db
      .prepare('SELECT * FROM client_record WHERE client_id = ? ORDER BY sequence')
      .all(row.id) as unknown as RecordRow[];

    return Client.restore({
      id: row.id,
      records: records.map((record) => ({
        name: record.name,
        cpf: Cpf.restore(record.cpf),
        signed: Authorship.restore(record.signed_by, new Date(record.signed_at)),
      })),
    });
  }
}
