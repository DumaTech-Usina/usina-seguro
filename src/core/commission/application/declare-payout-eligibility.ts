import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { brokerNameOf } from '../../registry/application/broker-name.ts';
import type { BrokerRepository } from '../../registry/application/broker-repository.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
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
export interface DeclarePayoutEligibilityDependencies extends PayoutDependencies {
  /** REQ-308: the statement keeps the broker's name as it is at eligibility. */
  readonly brokers: BrokerRepository;
  /** REQ-318: the statement keeps the client's name as it is at eligibility. */
  readonly clients: ClientRepository;
}

export class DeclarePayoutEligibility {
  private readonly deps: DeclarePayoutEligibilityDependencies;

  constructor(deps: DeclarePayoutEligibilityDependencies) {
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
        // REQ-308, REQ-318: the broker's and the client's names now, kept as
        // they are.
        broker: await brokerNameOf(this.deps.brokers, proposal.brokerId),
        client: await clientNameOf(this.deps.clients, proposal.clientId),
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
