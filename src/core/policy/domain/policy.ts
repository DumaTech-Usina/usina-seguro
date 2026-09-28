import type { Authorship } from '../../proposal/domain/authorship.ts';
import type { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import { POLICY_MESSAGES } from './errors.ts';
import type { Installment, InstallmentPaymentConfirmation } from './installment.ts';

/**
 * Documented policy states (section 10.3).
 *
 * ```
 * ACTIVE ──► RENEWED    (generates a new linked policy, REQ-056)
 *        ├─► CANCELLED  (final, REQ-053, REQ-113)
 *        └─► EXPIRED    (coverage ended without renewal)
 * ```
 *
 * Only `ACTIVE` is reachable here: renewal, cancellation and expiry are
 * separate operations (REQ-053..REQ-056) that this slice does not cover.
 * `SUSPENDED` is deliberately absent — DEC-012.
 */
export type PolicyStatus = 'ACTIVE' | 'RENEWED' | 'CANCELLED' | 'EXPIRED';

/**
 * REQ-247: the PDF of the policy. The bytes live in a document store; the
 * policy keeps which document it is, its name and who sent it, and when.
 *
 * Nothing about its content is checked: what a policy PDF must hold is
 * `DEC-213`.
 */
export interface PolicyDocument {
  readonly documentId: string;
  readonly fileName: string;
  /** REQ-216, REQ-247: every sending is signed at the moment it is recorded. */
  readonly attached: Authorship;
}

/**
 * Data required to register a policy (REQ-020, IN-10).
 *
 * The premium is informed, not copied from the proposal: the system reflects
 * what the insurer effectuated (REQ-002) and never calculates a price
 * (REQ-011), so the effectuated amount may differ from the proposed one.
 *
 * Claims and cancellation (REQ-052, REQ-053) are absent: they are events during
 * the coverage, recorded by operations outside this flow.
 */
export interface PolicyRegistrationData {
  readonly id: string;
  /** REQ-050: link to the originating proposal, which holds its number. */
  readonly proposalId: string;
  /** REQ-020, REJ-006: issued by the insurer, mandatory. */
  readonly policyNumber: string;
  readonly premium: Money;
  readonly coverageStart: CalendarDate;
  readonly coverageEnd: CalendarDate;
  /** REQ-020, REQ-055: the date the renewal is controlled against. */
  readonly renewalDate: CalendarDate;
  readonly installments: readonly Installment[];
  /** REQ-247: absent until a PDF is sent. */
  readonly document?: PolicyDocument | null;
  readonly registeredAt: Date;
}

export class Policy {
  readonly id: string;
  readonly proposalId: string;
  readonly policyNumber: string;
  readonly premium: Money;
  readonly coverageStart: CalendarDate;
  readonly coverageEnd: CalendarDate;
  readonly renewalDate: CalendarDate;
  readonly installments: readonly Installment[];
  readonly document: PolicyDocument | null;
  readonly registeredAt: Date;
  readonly status: PolicyStatus;

  private constructor(data: PolicyRegistrationData, status: PolicyStatus) {
    this.id = data.id;
    this.proposalId = data.proposalId;
    this.policyNumber = data.policyNumber;
    this.premium = data.premium;
    this.coverageStart = data.coverageStart;
    this.coverageEnd = data.coverageEnd;
    this.renewalDate = data.renewalDate;
    this.installments = data.installments;
    this.document = data.document ?? null;
    this.registeredAt = data.registeredAt;
    this.status = status;
  }

  /**
   * REQ-048 / FP-01 step 6: the insurer effectuated the proposal and the policy
   * is recorded.
   *
   * The policy owns its installments: REQ-020 lists them as part of the policy
   * and they are never written without it.
   */
  static register(data: PolicyRegistrationData): Policy {
    if (data.policyNumber.trim() === '') {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.POLICY_NUMBER_REQUIRED);
    }

    if (!data.premium.isPositive()) {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.PREMIUM_MUST_BE_POSITIVE);
    }

    if (!data.coverageStart.isBefore(data.coverageEnd)) {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.COVERAGE_END_MUST_FOLLOW_START, {
        start: data.coverageStart.toString(),
        end: data.coverageEnd.toString(),
      });
    }

    // The schedule may be empty: the policy inherits the proposal's
    // installments (REQ-241), and a proposal without them is valid (CA-216).
    data.installments.forEach((installment, index) => {
      // REQ-091 releases the broker transfer against the *first* installment,
      // so the numbering has to identify it without ambiguity.
      if (installment.number !== index + 1) {
        throw new BusinessRuleViolation(
          'REQ-020',
          POLICY_MESSAGES.INSTALLMENTS_MUST_BE_SEQUENTIAL,
          { number: String(installment.number), expected: String(index + 1) },
        );
      }

      if (installment.policyId !== data.id) {
        throw new BusinessRuleViolation(
          'REQ-020',
          POLICY_MESSAGES.INSTALLMENT_BELONGS_TO_ANOTHER_POLICY,
          { number: String(installment.number) },
        );
      }
    });

    // Stored trimmed because REQ-082 makes this the conciliation key: a report
    // line is matched against it after the same trim, so a stray space here
    // would make the policy unreachable.
    return new Policy({ ...data, policyNumber: data.policyNumber.trim() }, 'ACTIVE');
  }

  /** Rebuilds a persisted policy without re-applying the rules (REQ-124). */
  static restore(data: PolicyRegistrationData, status: PolicyStatus): Policy {
    return new Policy(data, status);
  }

  /**
   * REQ-247, CA-244: the policy keeps one PDF, the last one sent. The earlier
   * one is no longer the policy's document, but its bytes stay in the store:
   * nothing is erased (REQ-124).
   */
  attachDocument(document: PolicyDocument): Policy {
    return new Policy({ ...this, document }, this.status);
  }

  /**
   * IN-13: records that the client paid one installment of the schedule, with
   * the user and the moment REQ-123 requires.
   *
   * The policy drives it because the installments are part of the policy
   * (REQ-020) and are never written on their own.
   */
  payInstallment(number: number, confirmation: InstallmentPaymentConfirmation): Policy {
    const target = this.installments.find((installment) => installment.number === number);

    if (target === undefined) {
      throw new RecordNotFound(POLICY_MESSAGES.INSTALLMENT_NOT_FOUND, {
        number: String(number),
        policyNumber: this.policyNumber,
      });
    }

    const paid = target.pay(confirmation);

    return new Policy(
      {
        ...this,
        installments: this.installments.map((installment) =>
          installment.number === number ? paid : installment,
        ),
      },
      this.status,
    );
  }
}
