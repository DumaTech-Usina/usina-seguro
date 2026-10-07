import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import {
  type ParcelledPayoutDependencies,
  loadParcelledPayout,
} from './parcelled-payout-context.ts';
import {
  type ParcelledPolicyPayoutView,
  toParcelledPolicyPayoutView,
} from './parcelled-payout-view.ts';

export interface ReviseParcelledPayoutRatesInput {
  readonly policyId: string;
  readonly firstRate: string;
  readonly subsequentRate: string;
  /** REQ-265: mandatory on every change. */
  readonly reason: string;
  readonly userId: string;
}

/** REQ-265, FA-223: both CRs changed together, while no installment is eligible (REQ-289). */
export class ReviseParcelledPayoutRates {
  private readonly deps: ParcelledPayoutDependencies;

  constructor(deps: ParcelledPayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: ReviseParcelledPayoutRatesInput): Promise<ParcelledPolicyPayoutView> {
    const context = await loadParcelledPayout(this.deps, input.policyId);

    if (context.commission === null) {
      throw new BusinessRuleViolation('REQ-265', COMMISSION_MESSAGES.PAYOUT_NOT_INFORMED);
    }

    const commission = context.commission.revise({
      firstRate: Percentage.fromStringWithoutCeiling(input.firstRate),
      subsequentRate: Percentage.fromStringWithoutCeiling(input.subsequentRate),
      reason: input.reason,
      informed: Authorship.of(input.userId, this.deps.now()),
    });

    await this.deps.parcelledPayouts.save(commission);

    return toParcelledPolicyPayoutView(context.policy, context.proposal, commission);
  }
}
