import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { SETTLEMENT_MESSAGES } from './errors.ts';

/**
 * REQ-090: the release attribute every payment method carries.
 *
 * - `IMMEDIATE`: the transfer is released as soon as it is opened (REQ-091 for
 *   credit and debit, CA-022).
 * - `REQUIRES_RECEIPT_CONFIRMATION`: it waits for the manual confirmation that
 *   the client paid the first installment (REQ-091 for bank slip, REQ-092,
 *   CA-023, EX-07).
 */
export type ReleaseRule = 'IMMEDIATE' | 'REQUIRES_RECEIPT_CONFIRMATION';

export interface PaymentMethodReleaseRuleData {
  readonly paymentMethodId: string;
  readonly release: ReleaseRule;
  readonly registeredAt: Date;
}

/**
 * The release rule of a payment method (IN-06, REQ-090).
 *
 * It is a configuration record, not a branch in the code: REQ-125 and CA-024
 * require changing the rule of a payment method to change the behaviour
 * without touching code, and that is only true if the code never names a
 * payment method. So the values of REQ-091 — credit and debit immediate, bank
 * slip on confirmation — are data to be registered, and no default is built
 * in. Pix in particular has **no** rule of its own here: `DEC-002` has not
 * decided it, and inventing one would be deciding it.
 */
export class PaymentMethodReleaseRule {
  readonly paymentMethodId: string;
  readonly release: ReleaseRule;
  readonly registeredAt: Date;

  private constructor(data: PaymentMethodReleaseRuleData) {
    this.paymentMethodId = data.paymentMethodId;
    this.release = data.release;
    this.registeredAt = data.registeredAt;
  }

  static register(data: PaymentMethodReleaseRuleData): PaymentMethodReleaseRule {
    if (data.paymentMethodId.trim() === '') {
      throw new BusinessRuleViolation('REQ-090', SETTLEMENT_MESSAGES.PAYMENT_METHOD_REQUIRED);
    }

    return new PaymentMethodReleaseRule(data);
  }

  /** Rebuilds a persisted rule without re-applying the rules (REQ-124). */
  static restore(data: PaymentMethodReleaseRuleData): PaymentMethodReleaseRule {
    return new PaymentMethodReleaseRule(data);
  }
}
