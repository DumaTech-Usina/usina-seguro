import type { DatabaseSync } from 'node:sqlite';
import { Money } from '../../../core/proposal/domain/money.ts';
import type { SettlementRepository } from '../../../core/settlement/application/settlement-repository.ts';
import type { ReleaseRule } from '../../../core/settlement/domain/payment-method-release-rule.ts';
import { Settlement, type SettlementStatus } from '../../../core/settlement/domain/settlement.ts';

interface SettlementRow {
  id: string;
  policy_id: string;
  broker_id: string;
  amount: string;
  release_rule: string;
  status: string;
  opened_at: string;
  released_at: string | null;
  paid_at: string | null;
  paid_amount: string | null;
  proof_reference: string | null;
  payment_user_id: string | null;
}

export class SqliteSettlementRepository implements SettlementRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(settlement: Settlement): Promise<void> {
    const payment = settlement.payment;

    this.db
      .prepare(
        `INSERT INTO settlement (
           id, policy_id, broker_id, amount, release_rule, status, opened_at,
           released_at, paid_at, paid_amount, proof_reference, payment_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status          = excluded.status,
           released_at     = excluded.released_at,
           paid_at         = excluded.paid_at,
           paid_amount     = excluded.paid_amount,
           proof_reference = excluded.proof_reference,
           payment_user_id = excluded.payment_user_id`,
      )
      .run(
        settlement.id,
        settlement.policyId,
        settlement.brokerId,
        settlement.amount.toString(),
        settlement.releaseRule,
        settlement.status,
        settlement.openedAt.toISOString(),
        settlement.releasedAt?.toISOString() ?? null,
        payment?.paidAt.toISOString() ?? null,
        payment?.amount.toString() ?? null,
        payment?.proofReference ?? null,
        payment?.userId ?? null,
      );
  }

  async findByPolicyId(policyId: string): Promise<Settlement | null> {
    const row = this.db.prepare('SELECT * FROM settlement WHERE policy_id = ?').get(policyId) as
      | SettlementRow
      | undefined;

    if (row === undefined) {
      return null;
    }

    return Settlement.restore(
      {
        id: row.id,
        policyId: row.policy_id,
        brokerId: row.broker_id,
        amount: Money.fromString(row.amount),
        releaseRule: row.release_rule as ReleaseRule,
        openedAt: new Date(row.opened_at),
      },
      {
        status: row.status as SettlementStatus,
        releasedAt: row.released_at === null ? null : new Date(row.released_at),
        payment:
          row.paid_at === null
            ? null
            : {
                paidAt: new Date(row.paid_at),
                amount: Money.fromString(row.paid_amount ?? '0.00'),
                proofReference: row.proof_reference ?? '',
                userId: row.payment_user_id ?? '',
              },
      },
    );
  }
}
