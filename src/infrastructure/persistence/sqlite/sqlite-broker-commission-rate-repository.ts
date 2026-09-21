import type { DatabaseSync } from 'node:sqlite';
import type { BrokerCommissionRateRepository } from '../../../core/commission/application/broker-commission-rate-repository.ts';
import { BrokerCommissionRate } from '../../../core/commission/domain/broker-commission-rate.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';

interface BrokerRateRow {
  broker_id: string;
  rate: string;
  registered_at: string;
}

export class SqliteBrokerCommissionRateRepository implements BrokerCommissionRateRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(rate: BrokerCommissionRate): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO broker_commission_rate (broker_id, rate, registered_at)
         VALUES (?, ?, ?)
         ON CONFLICT(broker_id) DO UPDATE SET
           rate          = excluded.rate,
           registered_at = excluded.registered_at`,
      )
      .run(rate.brokerId, rate.rate.toString(), rate.registeredAt.toISOString());
  }

  async findByBrokerId(brokerId: string): Promise<BrokerCommissionRate | null> {
    const row = this.db
      .prepare('SELECT * FROM broker_commission_rate WHERE broker_id = ?')
      .get(brokerId) as BrokerRateRow | undefined;

    if (row === undefined) {
      return null;
    }

    return restore(row);
  }

  /** IN-05, by broker: the whole table, so a reading is repeatable. */
  async list(): Promise<readonly BrokerCommissionRate[]> {
    const rows = this.db
      .prepare('SELECT * FROM broker_commission_rate ORDER BY broker_id')
      .all() as unknown as BrokerRateRow[];

    return rows.map(restore);
  }
}

function restore(row: BrokerRateRow): BrokerCommissionRate {
  return BrokerCommissionRate.restore({
    brokerId: row.broker_id,
    rate: Percentage.fromString(row.rate),
    registeredAt: new Date(row.registered_at),
  });
}
