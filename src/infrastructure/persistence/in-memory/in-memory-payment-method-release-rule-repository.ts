import type { PaymentMethodReleaseRuleRepository } from '../../../core/settlement/application/payment-method-release-rule-repository.ts';
import type { PaymentMethodReleaseRule } from '../../../core/settlement/domain/payment-method-release-rule.ts';

export class InMemoryPaymentMethodReleaseRuleRepository
  implements PaymentMethodReleaseRuleRepository
{
  private readonly records = new Map<string, PaymentMethodReleaseRule>();

  async save(rule: PaymentMethodReleaseRule): Promise<void> {
    this.records.set(rule.paymentMethodId, rule);
  }

  async findByPaymentMethodId(paymentMethodId: string): Promise<PaymentMethodReleaseRule | null> {
    return this.records.get(paymentMethodId) ?? null;
  }

  /** IN-06, by payment method. Code-unit order, as SQLite orders `TEXT`. */
  async list(): Promise<readonly PaymentMethodReleaseRule[]> {
    return [...this.records.values()].sort((a, b) =>
      a.paymentMethodId < b.paymentMethodId ? -1 : 1,
    );
  }
}
