import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { PolicyPayoutView } from './payout-commission-view.ts';
import {
  type PayoutDependencies,
  loadPolicyPayout,
  toPolicyPayoutView,
} from './policy-payout-context.ts';

export interface RevisePayoutRateInput {
  readonly policyId: string;
  readonly rate: string;
  /** REQ-279: mandatory on every change. */
  readonly reason: string;
  readonly userId: string;
}

/** FP-02 step 4, REQ-277: the recalculation of a CALCULATED commission. */
export class RevisePayoutRate {
  private readonly deps: PayoutDependencies;

  constructor(deps: PayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: RevisePayoutRateInput): Promise<PolicyPayoutView> {
    const context = await loadPolicyPayout(this.deps, input.policyId);

    if (context.commission === null) {
      throw new BusinessRuleViolation('REQ-273', COMMISSION_MESSAGES.PAYOUT_NOT_INFORMED);
    }

    const commission = context.commission.revise({
      rate: Percentage.fromString(input.rate),
      reason: input.reason,
      informed: Authorship.of(input.userId, this.deps.now()),
    });

    await this.deps.payouts.save(commission);

    return toPolicyPayoutView({ ...context, commission });
  }
}
