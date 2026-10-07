import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import { PayoutCommission, payoutBase } from '../domain/payout-commission.ts';
import type { PolicyPayoutView } from './payout-commission-view.ts';
import {
  type PayoutDependencies,
  loadPolicyPayout,
  toPolicyPayoutView,
} from './policy-payout-context.ts';

export interface InformPayoutRateInput {
  readonly policyId: string;
  /** The CR, as a decimal string (REQ-272). */
  readonly rate: string;
  /** REQ-216: who informs it, typed in the act. */
  readonly userId: string;
}

/**
 * FP-02 steps 2 and 3: a user informs the CR of a policy, and the commission
 * becomes CALCULATED with its values shown (REQ-270 to REQ-272, REQ-278).
 */
export class InformPayoutRate {
  private readonly deps: PayoutDependencies;

  constructor(deps: PayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: InformPayoutRateInput): Promise<PolicyPayoutView> {
    const context = await loadPolicyPayout(this.deps, input.policyId);

    // REQ-271, REJ-217: at most one CR per policy; changing it is the
    // recalculation, which asks for a reason.
    if (context.commission !== null) {
      throw new BusinessRuleViolation('REQ-271', COMMISSION_MESSAGES.PAYOUT_ALREADY_INFORMED);
    }

    // REQ-271, REJ-218: the single CR is the integral CT's. Refused before the
    // base is read, because a parcelled CT has no total to base it on (REJ-232).
    if (context.proposal.workedCommissionMode !== 'INTEGRAL') {
      throw new BusinessRuleViolation('REQ-271', COMMISSION_MESSAGES.PAYOUT_REQUIRES_INTEGRAL_CT);
    }

    const commission = PayoutCommission.inform({
      id: this.deps.newId(),
      policyId: context.policy.id,
      workedCommissionMode: context.proposal.workedCommissionMode,
      base: payoutBase(context.proposal.expectedReceipt()),
      rate: Percentage.fromString(input.rate),
      informed: Authorship.of(input.userId, this.deps.now()),
    });

    await this.deps.payouts.save(commission);

    return toPolicyPayoutView({ ...context, commission });
  }
}
