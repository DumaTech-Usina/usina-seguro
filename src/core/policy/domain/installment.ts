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
 * Only the initial state is reachable here. Payment confirmation is manual and
 * belongs to the transfer flow (REQ-091, REQ-092, ITP-008); `OVERDUE` depends
 * on a rule nobody has stated (who marks it, against which clock). The states
 * stay in the union because they are part of the documented machine.
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
}
