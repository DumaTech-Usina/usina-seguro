import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { CommissionBasis } from './commission-basis.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

/**
 * State of the agreed commission. `FORECAST` is the only reachable one: the
 * commission is what the Usina expects to receive (REQ-236).
 */
export type CommissionStatus = 'FORECAST';

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

export interface CommissionState {
  readonly status: CommissionStatus;
  readonly override: CommissionOverride | null;
}

export interface CommissionData {
  readonly id: string;
  /** REQ-245: the policy is the canonical base, never the proposal. */
  readonly policyId: string;
  readonly basis: CommissionBasis;
  readonly agreedReceivable: Money;
  readonly calculatedAt: Date;
}

/**
 * The agreed commission of one policy (REQ-236): one record per policy.
 *
 * There is no payable side: the broker's part is the CR of FP-02 (REQ-270).
 *
 * Nothing is ever erased (REQ-124): an override keeps the calculated values
 * next to the overridden ones.
 */
export class Commission {
  readonly id: string;
  readonly policyId: string;
  readonly basis: CommissionBasis;
  readonly agreedReceivable: Money;
  readonly calculatedAt: Date;
  readonly status: CommissionStatus;
  readonly override: CommissionOverride | null;

  private constructor(data: CommissionData, state: CommissionState) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.basis = data.basis;
    this.agreedReceivable = data.agreedReceivable;
    this.calculatedAt = data.calculatedAt;
    this.status = state.status;
    this.override = state.override;
  }

  /** FP-01 step 7: the policy exists, so the agreed commission is calculated. */
  static forecast(data: CommissionData): Commission {
    return new Commission(data, { status: 'FORECAST', override: null });
  }

  /** Rebuilds a persisted commission without re-applying the rules (REQ-124). */
  static restore(data: CommissionData, state: CommissionState): Commission {
    return new Commission(data, state);
  }

  /**
   * What the Usina expects to receive, override included (REQ-066).
   *
   * The calculated value stays on `agreedReceivable`.
   */
  get effectiveReceivable(): Money {
    return this.override?.receivable ?? this.agreedReceivable;
  }

  /**
   * REQ-066, CA-014: adjusts, on this policy alone, what the Usina receives.
   *
   * REQ-067 and REJ-010 make the justification and the user mandatory.
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

    return new Commission(this, { status: this.status, override: applied });
  }
}
