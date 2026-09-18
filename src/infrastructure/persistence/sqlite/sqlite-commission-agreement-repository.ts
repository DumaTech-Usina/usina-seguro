import type { DatabaseSync } from 'node:sqlite';
import type { CommissionAgreementRepository } from '../../../core/commission/application/commission-agreement-repository.ts';
import {
  type BrokerBase,
  CommissionAgreement,
  type CommissionChain,
} from '../../../core/commission/domain/commission-agreement.ts';
import { CalendarDate } from '../../../core/policy/domain/calendar-date.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';

interface AgreementRow {
  id: string;
  insurer_id: string;
  product_id: string;
  effective_from: string;
  insurer_rate: string;
  chain_kind: string;
  intermediary_id: string | null;
  intermediary_rate: string | null;
  broker_base: string;
  registered_at: string;
}

export class SqliteCommissionAgreementRepository implements CommissionAgreementRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(agreement: CommissionAgreement): Promise<void> {
    const chain = agreement.chain;

    this.db
      .prepare(
        `INSERT INTO commission_agreement (
           id, insurer_id, product_id, effective_from, insurer_rate,
           chain_kind, intermediary_id, intermediary_rate, broker_base, registered_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(insurer_id, product_id, effective_from) DO UPDATE SET
           -- Re-registering the same validity replaces the whole record, id and
           -- registration moment included: the caller was told the new id, and
           -- keeping the old one would answer with a record nobody described.
           -- Nothing points at this id: a calculation copies the rates it used
           -- (REJ-011), it does not reference the agreement.
           id                = excluded.id,
           registered_at     = excluded.registered_at,
           insurer_rate      = excluded.insurer_rate,
           chain_kind        = excluded.chain_kind,
           intermediary_id   = excluded.intermediary_id,
           intermediary_rate = excluded.intermediary_rate,
           broker_base       = excluded.broker_base`,
      )
      .run(
        agreement.id,
        agreement.insurerId,
        agreement.productId,
        agreement.effectiveFrom.toString(),
        agreement.insurerRate.toString(),
        chain.kind,
        chain.kind === 'INTERMEDIARY' ? chain.intermediaryId : null,
        chain.kind === 'INTERMEDIARY' ? chain.intermediaryRate.toString() : null,
        chain.kind === 'INTERMEDIARY' ? chain.brokerBase : 'USINA',
        agreement.registeredAt.toISOString(),
      );
  }

  /**
   * REQ-065: the agreement in force is the latest one whose validity already
   * started. An ISO date orders lexicographically, so `MAX` on the text column
   * is chronological — the same expression a PostgreSQL `date` column answers.
   */
  async findInForce(
    insurerId: string,
    productId: string,
    on: CalendarDate,
  ): Promise<CommissionAgreement | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM commission_agreement
         WHERE insurer_id = ? AND product_id = ? AND effective_from <= ?
         ORDER BY effective_from DESC
         LIMIT 1`,
      )
      .get(insurerId, productId, on.toString()) as AgreementRow | undefined;

    if (row === undefined) {
      return null;
    }

    const chain: CommissionChain =
      row.chain_kind === 'INTERMEDIARY'
        ? {
            kind: 'INTERMEDIARY',
            intermediaryId: row.intermediary_id ?? '',
            intermediaryRate: Percentage.fromString(row.intermediary_rate ?? '0'),
            brokerBase: row.broker_base as BrokerBase,
          }
        : { kind: 'DIRECT' };

    return CommissionAgreement.restore({
      id: row.id,
      insurerId: row.insurer_id,
      productId: row.product_id,
      effectiveFrom: CalendarDate.fromString(row.effective_from),
      insurerRate: Percentage.fromString(row.insurer_rate),
      chain,
      registeredAt: new Date(row.registered_at),
    });
  }
}
