import type { DatabaseSync } from 'node:sqlite';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import type { BrokerRepository } from '../../../core/registry/application/broker-repository.ts';
import { Broker } from '../../../core/registry/domain/broker.ts';
import { Cpf } from '../../../core/registry/domain/cpf.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface BrokerRow {
  id: string;
}

interface RecordRow {
  name: string;
  cpf: string;
  signed_by: string;
  signed_at: string;
}

/**
 * The broker is two tables: its current name and CPF, written in place, and
 * the append-only signed records (REQ-304). A record already stored is left
 * as it is.
 */
export class SqliteBrokerRepository implements BrokerRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(broker: Broker): Promise<void> {
    await withSavepoint(this.db, 'broker_save', async () => {
      this.db
        .prepare(
          `INSERT INTO broker (id, name, cpf) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, cpf = excluded.cpf`,
        )
        .run(broker.id, broker.name, broker.cpf.digits);

      const record = this.db.prepare(
        `INSERT INTO broker_record (broker_id, sequence, name, cpf, signed_by, signed_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      broker.records.forEach((item, index) => {
        record.run(
          broker.id,
          index + 1,
          item.name,
          item.cpf.digits,
          item.signed.author,
          item.signed.at.toISOString(),
        );
      });
    });
  }

  async findById(id: string): Promise<Broker | null> {
    const row = this.db.prepare('SELECT id FROM broker WHERE id = ?').get(id) as
      | BrokerRow
      | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async findByCpf(digits: string): Promise<Broker | null> {
    const row = this.db.prepare('SELECT id FROM broker WHERE cpf = ?').get(digits) as
      | BrokerRow
      | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async list(): Promise<readonly Broker[]> {
    const rows = this.db
      .prepare('SELECT id FROM broker ORDER BY name, id')
      .all() as unknown as BrokerRow[];

    return rows.map((row) => this.restore(row));
  }

  private restore(row: BrokerRow): Broker {
    const records = this.db
      .prepare('SELECT * FROM broker_record WHERE broker_id = ? ORDER BY sequence')
      .all(row.id) as unknown as RecordRow[];

    return Broker.restore({
      id: row.id,
      records: records.map((record) => ({
        name: record.name,
        cpf: Cpf.restore(record.cpf),
        signed: Authorship.restore(record.signed_by, new Date(record.signed_at)),
      })),
    });
  }
}
