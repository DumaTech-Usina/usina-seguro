import type { PaymentMethodReleaseRule } from '../domain/payment-method-release-rule.ts';

export interface PaymentMethodReleaseRuleRepository {
  save(rule: PaymentMethodReleaseRule): Promise<void>;
  findByPaymentMethodId(paymentMethodId: string): Promise<PaymentMethodReleaseRule | null>;
  /** Every rule configured (IN-06), by payment method, so a reading is repeatable. */
  list(): Promise<readonly PaymentMethodReleaseRule[]>;
}
