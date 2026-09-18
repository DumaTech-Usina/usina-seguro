import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { CalendarDate } from './calendar-date.ts';
import { POLICY_MESSAGES } from './errors.ts';

/**
 * Documented installment states (section 10.4).
 *
 * ```
 * PENDING ──► PAID
 *         ├─► OVERDUE ──► PAID
 *         └─► CANCELLED
 * ```
 *
 * `PENDING` and `PAID` are reachable: IN-13 and REQ-092 make the confirmation
 * of the client's payment a manual act by a user of the Usina, and REQ-091
 * makes it the condition that releases the broker transfer. `OVERDUE` depends
 * on a rule nobody has stated (who marks it, against which clock) and
 * `CANCELLED` on the policy cancellation of REQ-053, which is not modelled.
 * Both stay in the union because they are part of the documented machine.
 */
export type InstallmentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface InstallmentData {
  readonly id: string;
  readonly policyId: string;
  /** Position in the schedule, starting at 1 (REQ-091 needs a first one). */
  readonly number: number;
  readonly amount: Money;
  readonly dueDate: CalendarDate;
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
  readonly dueDate: CalendarDate;
  readonly status: InstallmentStatus;

  private constructor(data: InstallmentData, status: InstallmentStatus) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.number = data.number;
    this.amount = data.amount;
    this.dueDate = data.dueDate;
    this.status = status;
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

    return new Installment(data, 'PENDING');
  }

  /** Rebuilds a persisted installment without re-applying the rules (REQ-124). */
  static restore(data: InstallmentData, status: InstallmentStatus): Installment {
    return new Installment(data, status);
  }

  get isPaid(): boolean {
    return this.status === 'PAID';
  }

  /**
   * IN-13, REQ-092, ITP-008: a user of the Usina confirms the client paid.
   * There is no bank integration (REQ-013), so this record is the only source.
   *
   * Confirming twice is refused: the confirmation releases the transfer of
   * REQ-091 and REQ-124 forbids overwriting a financial record.
   */
  pay(): Installment {
    if (this.status !== 'PENDING') {
      throw new BusinessRuleViolation('REQ-092', POLICY_MESSAGES.ONLY_PENDING_CAN_BE_PAID, {
        number: String(this.number),
        status: this.status,
      });
    }

    return new Installment(this, 'PAID');
  }
}
