import type { DatabaseSync } from 'node:sqlite';
import type { PaymentMethodReleaseRuleRepository } from '../../../core/settlement/application/payment-method-release-rule-repository.ts';
import {
  PaymentMethodReleaseRule,
  type ReleaseRule,
} from '../../../core/settlement/domain/payment-method-release-rule.ts';

interface ReleaseRuleRow {
  payment_method_id: string;
  release_rule: string;
  registered_at: string;
}

export class SqlitePaymentMethodReleaseRuleRepository
  implements PaymentMethodReleaseRuleRepository
{
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(rule: PaymentMethodReleaseRule): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO payment_method_release_rule (payment_method_id, release_rule, registered_at)
         VALUES (?, ?, ?)
         ON CONFLICT(payment_method_id) DO UPDATE SET
           release_rule  = excluded.release_rule,
           registered_at = excluded.registered_at`,
      )
      .run(rule.paymentMethodId, rule.release, rule.registeredAt.toISOString());
  }

  async findByPaymentMethodId(paymentMethodId: string): Promise<PaymentMethodReleaseRule | null> {
    const row = this.db
      .prepare('SELECT * FROM payment_method_release_rule WHERE payment_method_id = ?')
      .get(paymentMethodId) as ReleaseRuleRow | undefined;

    if (row === undefined) {
      return null;
    }

    return restore(row);
  }

  /** IN-06, by payment method: every rule configured. */
  async list(): Promise<readonly PaymentMethodReleaseRule[]> {
    const rows = this.db
      .prepare('SELECT * FROM payment_method_release_rule ORDER BY payment_method_id')
      .all() as unknown as ReleaseRuleRow[];

    return rows.map(restore);
  }
}

function restore(row: ReleaseRuleRow): PaymentMethodReleaseRule {
  return PaymentMethodReleaseRule.restore({
    paymentMethodId: row.payment_method_id,
    release: row.release_rule as ReleaseRule,
    registeredAt: new Date(row.registered_at),
  });
}
