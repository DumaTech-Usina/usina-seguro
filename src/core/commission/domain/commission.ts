import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { CommissionBasis } from './commission-basis.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

/**
 * Documented states of the receivable commission (section 10.5).
 *
 * ```
 * FORECAST ──► RECONCILED ──► RECEIVED
 *                         └─► DIVERGENT ──► RESOLVED  (manual, REQ-085)
 * ```
 *
 * `RECEIVED` is the "baixa de comissionamento" of the glossary: the moment the
 * Usina recognises the money arrived. No requirement says who records it or
 * when, so no transition reaches it here. It stays in the union because it is
 * part of the documented machine, the same treatment `CANCELLED` gets on the
 * proposal.
 */
export type CommissionStatus = 'FORECAST' | 'RECONCILED' | 'RECEIVED' | 'DIVERGENT' | 'RESOLVED';

/**
 * REQ-066: an extraordinary agreement on a single policy, over what the Usina
 * receives. REQ-067 and REQ-123 make the justification and the user mandatory.
 *
 * Receivable side only: the broker's part is the CR of FP-02 (REQ-270), so
 * there is no payable to adjust here.
 */
export interface CommissionOverride {
  readonly receivable: Money;
  readonly justification: string;
  readonly userId: string;
  readonly at: Date;
}

/** REQ-085, CA-026: who closed a divergence, when and why. */
export interface DivergenceResolution {
  readonly justification: string;
  readonly userId: string;
  readonly at: Date;
}

export interface CommissionState {
  readonly status: CommissionStatus;
  readonly override: CommissionOverride | null;
  /** Apurada na conciliacao (REQ-075, receivable side). */
  readonly realReceivable: Money | null;
  /** REQ-086: which competence produced `realReceivable`. */
  readonly reconciledCompetence: string | null;
  readonly reconciledAt: Date | null;
  readonly resolution: DivergenceResolution | null;
}

export interface CommissionData {
  readonly id: string;
  /** REQ-051, REQ-070, REJ-001, REJ-002: the policy, never the proposal. */
  readonly policyId: string;
  readonly basis: CommissionBasis;
  readonly agreedReceivable: Money;
  readonly calculatedAt: Date;
}

/**
 * The commission of one policy, agreed and real side by side (REQ-075,
 * CA-016).
 *
 * There is one record per policy because every confirmed requirement speaks of
 * the commission *of an apolice*: REQ-075 keeps the pair per policy, REQ-082
 * conciliates by policy number and REQ-086 forbids duplicating entries for the
 * same policy and competence. REQ-021 is what makes the record exist at all —
 * the installment is the point from which commissioning is generated, and a
 * policy cannot be registered without a schedule.
 *
 * There is no payable side: the broker's part is the CR of FP-02 (REQ-270).
 *
 * Nothing is ever erased (REQ-124): an override keeps the calculated values
 * next to the overridden ones, and a resolution is an added record, not an
 * edit.
 */
export class Commission {
  readonly id: string;
  readonly policyId: string;
  readonly basis: CommissionBasis;
  readonly agreedReceivable: Money;
  readonly calculatedAt: Date;
  readonly status: CommissionStatus;
  readonly override: CommissionOverride | null;
  readonly realReceivable: Money | null;
  readonly reconciledCompetence: string | null;
  readonly reconciledAt: Date | null;
  readonly resolution: DivergenceResolution | null;

  private constructor(data: CommissionData, state: CommissionState) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.basis = data.basis;
    this.agreedReceivable = data.agreedReceivable;
    this.calculatedAt = data.calculatedAt;
    this.status = state.status;
    this.override = state.override;
    this.realReceivable = state.realReceivable;
    this.reconciledCompetence = state.reconciledCompetence;
    this.reconciledAt = state.reconciledAt;
    this.resolution = state.resolution;
  }

  /** FP-01 step 7: the policy exists, so the agreed commission is calculated. */
  static forecast(data: CommissionData): Commission {
    return new Commission(data, {
      status: 'FORECAST',
      override: null,
      realReceivable: null,
      reconciledCompetence: null,
      reconciledAt: null,
      resolution: null,
    });
  }

  /** Rebuilds a persisted commission without re-applying the rules (REQ-124). */
  static restore(data: CommissionData, state: CommissionState): Commission {
    return new Commission(data, state);
  }

  /**
   * What the Usina expects to receive, override included (REQ-066).
   *
   * The calculated value stays on `agreedReceivable`; this is the value the
   * comparison of REQ-076 actually uses.
   */
  get effectiveReceivable(): Money {
    return this.override?.receivable ?? this.agreedReceivable;
  }

  /** REQ-076, CA-017: agreed and real disagree. Never blocking (REQ-077). */
  get isDivergent(): boolean {
    return this.realReceivable !== null && !this.realReceivable.equals(this.effectiveReceivable);
  }

  /**
   * REQ-086, CA-021, REJ-012: the same file imported twice must not produce a
   * second entry for the same policy and competence.
   */
  isReconciledFor(competence: string): boolean {
    return this.reconciledCompetence === competence.trim();
  }

  /**
   * FP-02 step 3/4: a line of the commission report matched this policy, so
   * the real value is recorded and compared with the agreed one.
   *
   * A divergence is signalled, never blocked (REQ-077), and it does not stop
   * the rest of the import.
   */
  reconcile(competence: string, realReceivable: Money, at: Date): Commission {
    const reference = competence.trim();

    if (reference === '') {
      throw new BusinessRuleViolation('REQ-086', COMMISSION_MESSAGES.COMPETENCE_REQUIRED);
    }

    if (this.isReconciledFor(reference)) {
      throw new BusinessRuleViolation(
        'REQ-086',
        COMMISSION_MESSAGES.ALREADY_RECONCILED_FOR_COMPETENCE,
        { competence: reference },
      );
    }

    const diverges = !realReceivable.equals(this.effectiveReceivable);

    return new Commission(this, {
      status: diverges ? 'DIVERGENT' : 'RECONCILED',
      override: this.override,
      realReceivable,
      reconciledCompetence: reference,
      reconciledAt: at,
      // A new apuration reopens the question the previous resolution closed.
      resolution: null,
    });
  }

  /**
   * REQ-066, CA-014: adjusts, on this policy alone, what the Usina receives.
   *
   * REQ-067 and REJ-010 make the justification and the user mandatory. The
   * agreed side is the only one an override touches: the real side is what a
   * third party reported (REQ-075), and rewriting it would erase the
   * divergence REQ-076 exists to show.
   */
  applyOverride(override: CommissionOverride): Commission {
    if (!override.receivable.isPositive()) {
      throw new BusinessRuleViolation('REQ-066', COMMISSION_MESSAGES.OVERRIDE_MUST_BE_POSITIVE);
    }

    if (override.justification.trim() === '') {
      throw new BusinessRuleViolation(
        'REQ-067',
        COMMISSION_MESSAGES.OVERRIDE_JUSTIFICATION_REQUIRED,
      );
    }

    if (override.userId.trim() === '') {
      throw new BusinessRuleViolation('REQ-123', COMMISSION_MESSAGES.OVERRIDE_USER_REQUIRED);
    }

    const applied: CommissionOverride = {
      receivable: override.receivable,
      justification: override.justification.trim(),
      userId: override.userId.trim(),
      at: override.at,
    };

    const next = new Commission(this, {
      status: this.status,
      override: applied,
      realReceivable: this.realReceivable,
      reconciledCompetence: this.reconciledCompetence,
      reconciledAt: this.reconciledAt,
      resolution: this.resolution,
    });

    // Changing the agreed side changes the answer to REQ-076, so a commission
    // already apurada is re-classified against the new expectation.
    if (this.realReceivable === null) {
      return next;
    }

    return new Commission(next, {
      status: next.isDivergent ? 'DIVERGENT' : 'RECONCILED',
      override: applied,
      realReceivable: next.realReceivable,
      reconciledCompetence: next.reconciledCompetence,
      reconciledAt: next.reconciledAt,
      // The resolution stays: REQ-124 and REJ-014 forbid erasing a financial
      // record, and REQ-085/CA-026 make this one the audit trail of who closed
      // the divergence and why. Reclassifying the commission does not unsay it.
      resolution: next.resolution,
    });
  }

  /**
   * REQ-085, CA-026, section 10.5: a human closed the divergence. The record
   * of who, when and why is required by REQ-123, and nothing is erased
   * (REQ-124, REJ-014) — the divergent values stay visible.
   */
  resolveDivergence(resolution: DivergenceResolution): Commission {
    if (this.status !== 'DIVERGENT') {
      throw new BusinessRuleViolation(
        'REQ-085',
        COMMISSION_MESSAGES.ONLY_DIVERGENT_CAN_BE_RESOLVED,
        { status: this.status },
      );
    }

    if (resolution.justification.trim() === '') {
      throw new BusinessRuleViolation(
        'REQ-085',
        COMMISSION_MESSAGES.RESOLUTION_JUSTIFICATION_REQUIRED,
      );
    }

    if (resolution.userId.trim() === '') {
      throw new BusinessRuleViolation('REQ-123', COMMISSION_MESSAGES.RESOLUTION_USER_REQUIRED);
    }

    return new Commission(this, {
      status: 'RESOLVED',
      override: this.override,
      realReceivable: this.realReceivable,
      reconciledCompetence: this.reconciledCompetence,
      reconciledAt: this.reconciledAt,
      resolution: {
        justification: resolution.justification.trim(),
        userId: resolution.userId.trim(),
        at: resolution.at,
      },
    });
  }
}
