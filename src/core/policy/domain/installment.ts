import type { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import { POLICY_MESSAGES } from './errors.ts';

/**
 * State of an installment: `PENDING ──► PAID`. The confirmation of the
 * client's payment is a manual act by a user of the Usina, on a policy with
 * integral CT (REQ-269).
 */
export type InstallmentStatus = 'PENDING' | 'PAID';

/**
 * REQ-123: the manual confirmation that the client paid (REQ-269) records who
 * confirmed it and when. There is no bank integration (REQ-013): this record is the only
 * source, and without the user there is nobody to ask about it later.
 */
export interface InstallmentPaymentConfirmation {
  readonly userId: string;
  readonly at: Date;
}

export interface InstallmentData {
  readonly id: string;
  readonly policyId: string;
  /** Position in the schedule, starting at 1 (REQ-204; REQ-291 names the first). */
  readonly number: number;
  readonly amount: Money;
  /** REQ-204, REQ-241: optional on the proposal, inherited as it is. */
  readonly dueDate: CalendarDate | null;
}

/**
 * An installment of the policy premium (REQ-020).
 *
 * REQ-021 makes it the point from which commissioning is generated, so the
 * record carries what a later apportionment needs: which policy it belongs to,
 * its position, its amount and its due date.
 *
 * The schedule is **informed**, not computed: the system does not calculate
 * premium or price (REQ-011) and only reflects what was decided outside it
 * (REQ-002, IN-10). Splitting the premium into equal parts here would invent a
 * rounding rule no requirement states.
 */
export class Installment {
  readonly id: string;
  readonly policyId: string;
  readonly number: number;
  readonly amount: Money;
  readonly dueDate: CalendarDate | null;
  readonly status: InstallmentStatus;
  /** REQ-123: who confirmed the client paid, and when. */
  readonly confirmation: InstallmentPaymentConfirmation | null;

  private constructor(
    data: InstallmentData,
    status: InstallmentStatus,
    confirmation: InstallmentPaymentConfirmation | null,
  ) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.number = data.number;
    this.amount = data.amount;
    this.dueDate = data.dueDate;
    this.status = status;
    this.confirmation = confirmation;
  }

  static create(data: InstallmentData): Installment {
    if (!Number.isInteger(data.number) || data.number < 1) {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.INSTALLMENTS_MUST_BE_SEQUENTIAL, {
        number: String(data.number),
      });
    }

    if (!data.amount.isPositive()) {
      throw new BusinessRuleViolation(
        'REQ-020',
        POLICY_MESSAGES.INSTALLMENT_AMOUNT_MUST_BE_POSITIVE,
        { number: String(data.number) },
      );
    }

    return new Installment(data, 'PENDING', null);
  }

  /** Rebuilds a persisted installment without re-applying the rules (REQ-124). */
  static restore(
    data: InstallmentData,
    status: InstallmentStatus,
    confirmation: InstallmentPaymentConfirmation | null = null,
  ): Installment {
    return new Installment(data, status, confirmation);
  }

  get isPaid(): boolean {
    return this.status === 'PAID';
  }

  /**
   * REQ-269: a user of the Usina confirms the client paid. There is no bank
   * integration (REQ-013), so this record is the only source.
   *
   * Confirming twice is refused: REQ-124 forbids overwriting a financial
   * record.
   */
  pay(confirmation: InstallmentPaymentConfirmation): Installment {
    if (this.status !== 'PENDING') {
      throw new BusinessRuleViolation('REQ-092', POLICY_MESSAGES.ONLY_PENDING_CAN_BE_PAID, {
        number: String(this.number),
        status: this.status,
      });
    }

    if (confirmation.userId.trim() === '') {
      throw new BusinessRuleViolation(
        'REQ-123',
        POLICY_MESSAGES.PAYMENT_CONFIRMATION_USER_REQUIRED,
        { number: String(this.number) },
      );
    }

    return new Installment(this, 'PAID', {
      userId: confirmation.userId.trim(),
      at: confirmation.at,
    });
  }
}
