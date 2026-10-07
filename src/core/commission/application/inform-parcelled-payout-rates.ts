import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import { ParcelledPayoutCommission } from '../domain/parcelled-payout.ts';
import {
  type ParcelledPayoutDependencies,
  installmentBases,
  loadParcelledPayout,
} from './parcelled-payout-context.ts';
import {
  type ParcelledPolicyPayoutView,
  toParcelledPolicyPayoutView,
} from './parcelled-payout-view.ts';

export interface InformParcelledPayoutRatesInput {
  readonly policyId: string;
  /** REQ-287: the CR of the first installment, as a decimal string. */
  readonly firstRate: string;
  /** REQ-287: the CR of the subsequent installments. */
  readonly subsequentRate: string;
  /** REQ-216: who informs them, typed in the act. */
  readonly userId: string;
}

/**
 * REQ-287, REQ-263, REQ-264: a user informs the two CRs of a policy with
 * parcelled CT, together, and the payout of each installment is shown. The
 * only limit of each CR is its CT (REQ-263): no other ceiling, so they are
 * read without the 100% one.
 */
export class InformParcelledPayoutRates {
  private readonly deps: ParcelledPayoutDependencies;

  constructor(deps: ParcelledPayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: InformParcelledPayoutRatesInput): Promise<ParcelledPolicyPayoutView> {
    const context = await loadParcelledPayout(this.deps, input.policyId);

    // A change of the CRs is the revision, which asks for a reason (REQ-265).
    if (context.commission !== null) {
      throw new BusinessRuleViolation('REQ-287', COMMISSION_MESSAGES.PAYOUT_ALREADY_INFORMED);
    }

    const commission = ParcelledPayoutCommission.inform({
      id: this.deps.newId(),
      policyId: context.policy.id,
      installments: installmentBases(context.proposal),
      firstRate: Percentage.fromStringWithoutCeiling(input.firstRate),
      subsequentRate: Percentage.fromStringWithoutCeiling(input.subsequentRate),
      informed: Authorship.of(input.userId, this.deps.now()),
    });

    await this.deps.parcelledPayouts.save(commission);

    return toParcelledPolicyPayoutView(context.policy, context.proposal, commission);
  }
}
