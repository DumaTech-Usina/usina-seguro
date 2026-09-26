import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { PolicyPayoutView } from './payout-commission-view.ts';
import {
  type PayoutDependencies,
  loadPolicyPayout,
  toPolicyPayoutView,
} from './policy-payout-context.ts';

export interface DeclarePayoutEligibilityInput {
  readonly policyId: string;
  /** REQ-216, REQ-281: who verified, outside the system, that the Usina received. */
  readonly userId: string;
}

/**
 * FP-02 steps 5 and 6: a user signs the eligibility, the commission becomes
 * ELIGIBLE for good and the statement is generated (REQ-281 to REQ-283).
 * Nothing is paid or moved (REQ-280).
 */
export class DeclarePayoutEligibility {
  private readonly deps: PayoutDependencies;

  constructor(deps: PayoutDependencies) {
    this.deps = deps;
  }

  async execute(input: DeclarePayoutEligibilityInput): Promise<PolicyPayoutView> {
    const context = await loadPolicyPayout(this.deps, input.policyId);

    // REQ-273, EX-205, REJ-226: a policy without CR cannot be made eligible.
    if (context.commission === null) {
      throw new BusinessRuleViolation('REQ-273', COMMISSION_MESSAGES.PAYOUT_NOT_INFORMED);
    }

    const { policy, proposal } = context;
    const receipt = proposal.receipt;

    const commission = context.commission.declareEligible(
      {
        policyNumber: policy.policyNumber,
        // DEC-208: the broker and the client are, for now, the names the
        // proposal carries.
        broker: proposal.brokerId,
        client: proposal.clientId,
        netPremium: proposal.netPremium,
        workedCommission: proposal.workedCommission,
        ctu: receipt.kind === 'INTERMEDIARY' ? receipt.ctu : null,
      },
      Authorship.of(input.userId, this.deps.now()),
    );

    await this.deps.payouts.save(commission);

    return toPolicyPayoutView({ ...context, commission });
  }
}
