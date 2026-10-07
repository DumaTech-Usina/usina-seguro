import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import {
  type ParcelledPayoutDependencies,
  loadParcelledPayout,
} from './parcelled-payout-context.ts';
import {
  type ParcelledPolicyPayoutView,
  toParcelledPolicyPayoutView,
} from './parcelled-payout-view.ts';

export interface DeclareInstallmentEligibilityInput {
  readonly policyId: string;
  /** The installment, by its number (REQ-291: number 1 is the first). */
  readonly number: number;
  /** REQ-216, REQ-288: who verified that the Usina received the installment. */
  readonly userId: string;
}

/**
 * REQ-288, REQ-266: a user signs the eligibility of one installment — the
 * confirmation of its receipt — and its statement is generated. The CRs must
 * exist, even if zero (REQ-288); nothing is paid or moved (REQ-280).
 */
export class DeclareInstallmentEligibility {
  private readonly deps: ParcelledPayoutDependencies;

  constructor(deps: ParcelledPayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: DeclareInstallmentEligibilityInput): Promise<ParcelledPolicyPayoutView> {
    const context = await loadParcelledPayout(this.deps, input.policyId);

    // REQ-288, EX-214, REJ-242: no eligibility without the CRs.
    if (context.commission === null) {
      throw new BusinessRuleViolation(
        'REQ-288',
        COMMISSION_MESSAGES.INSTALLMENT_ELIGIBILITY_REQUIRES_RATES,
      );
    }

    const { policy, proposal } = context;
    const signed = Authorship.of(input.userId, this.deps.now());

    const commission = context.commission.declareEligible(
      input.number,
      {
        policyNumber: policy.policyNumber,
        // DEC-208: the parties are, for now, the names the proposal carries.
        broker: proposal.brokerId,
        insurer: proposal.insurerId,
        client: proposal.clientId,
      },
      signed,
    );

    await this.deps.parcelledPayouts.save(commission);

    return toParcelledPolicyPayoutView(policy, proposal, commission);
  }
}
