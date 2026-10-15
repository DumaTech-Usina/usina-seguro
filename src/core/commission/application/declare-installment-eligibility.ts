import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { brokerNameOf } from '../../registry/application/broker-name.ts';
import type { BrokerRepository } from '../../registry/application/broker-repository.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
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
export interface DeclareInstallmentEligibilityDependencies extends ParcelledPayoutDependencies {
  /** REQ-308: the statement keeps the broker's name as it is at eligibility. */
  readonly brokers: BrokerRepository;
  /** REQ-318: the statement keeps the client's name as it is at eligibility. */
  readonly clients: ClientRepository;
}

export class DeclareInstallmentEligibility {
  private readonly deps: DeclareInstallmentEligibilityDependencies;

  constructor(deps: DeclareInstallmentEligibilityDependencies) {
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
        // REQ-308, REQ-318: the broker's and the client's names now, kept as
        // they are. DEC-208 is still open for the insurer: it is what the
        // proposal carries.
        broker: await brokerNameOf(this.deps.brokers, proposal.brokerId),
        insurer: proposal.insurerId,
        client: await clientNameOf(this.deps.clients, proposal.clientId),
      },
      signed,
    );

    await this.deps.parcelledPayouts.save(commission);

    return toParcelledPolicyPayoutView(policy, proposal, commission);
  }
}
