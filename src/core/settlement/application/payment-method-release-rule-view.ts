import type { PaymentMethodReleaseRule } from '../domain/payment-method-release-rule.ts';

/**
 * Representation of a release rule at the core boundary (IN-06, REQ-090).
 *
 * The payment method travels as the identifier the business uses, never as a
 * name this system knows: REQ-125 and CA-024 only hold while no payment method
 * is named in code, and a listing that enumerated them would be the first place
 * to break that.
 */
export interface PaymentMethodReleaseRuleView {
  readonly paymentMethodId: string;
  readonly release: string;
  readonly registeredAt: string;
}

export function toPaymentMethodReleaseRuleView(
  rule: PaymentMethodReleaseRule,
): PaymentMethodReleaseRuleView {
  return {
    paymentMethodId: rule.paymentMethodId,
    release: rule.release,
    registeredAt: rule.registeredAt.toISOString(),
  };
}
