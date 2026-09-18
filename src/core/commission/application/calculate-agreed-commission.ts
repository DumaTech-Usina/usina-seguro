import type {
  AgreedCommissionCalculator,
  AgreedCommissionRequest,
} from '../../policy/application/agreed-commission-calculator.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { calculateCommission } from '../domain/commission-basis.ts';
import { Commission } from '../domain/commission.ts';
import type { BrokerCommissionRateRepository } from './broker-commission-rate-repository.ts';
import type { CommissionAgreementRepository } from './commission-agreement-repository.ts';
import type { CommissionRepository } from './commission-repository.ts';

export interface CalculateAgreedCommissionDependencies {
  readonly proposals: ProposalRepository;
  readonly commissions: CommissionRepository;
  readonly agreements: CommissionAgreementRepository;
  readonly brokerRates: BrokerCommissionRateRepository;
  readonly newId: () => string;
}

/**
 * FP-01 step 7: the policy was registered, so the agreed commission of
 * REQ-075 is calculated.
 *
 * It implements the port the policy module declares, which is the whole of the
 * `commission -> policy` coupling: the policy hands over the premium and the
 * originating proposal and learns nothing about commissions.
 *
 * **When no agreement or no broker table is configured, nothing is
 * calculated** and the policy is registered all the same. The commercial
 * agreement and the broker table are cadastral data (REQ-061, REQ-065, IN-05)
 * and no requirement makes them a precondition for registering a policy —
 * refusing the policy for a missing rate would invent a rule and would
 * contradict REQ-002, where the system only reflects what happened outside it.
 * The policy then has no agreed side until the registry is filled.
 */
export class CalculateAgreedCommission implements AgreedCommissionCalculator {
  private readonly deps: CalculateAgreedCommissionDependencies;

  constructor(deps: CalculateAgreedCommissionDependencies) {
    this.deps = deps;
  }

  async calculateFor(request: AgreedCommissionRequest): Promise<void> {
    const proposal = await this.deps.proposals.findById(request.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: request.proposalId });
    }

    // REQ-065: the agreement in force on the day the calculation is made. The
    // rates are then copied onto the commission, so a later edit of the
    // registry cannot reach this result (CA-012, REJ-011).
    const on = CalendarDate.fromString(request.calculatedAt.toISOString().slice(0, 10));
    const agreement = await this.deps.agreements.findInForce(
      proposal.insurerId,
      proposal.productId,
      on,
    );

    if (agreement === null) {
      return;
    }

    const brokerRate = await this.deps.brokerRates.findByBrokerId(proposal.brokerId);

    if (brokerRate === null) {
      return;
    }

    const calculated = calculateCommission(request.premium, agreement, brokerRate);

    await this.deps.commissions.save(
      Commission.forecast({
        id: this.deps.newId(),
        policyId: request.policyId,
        basis: calculated.basis,
        agreedReceivable: calculated.receivable,
        agreedPayable: calculated.payable,
        calculatedAt: request.calculatedAt,
      }),
    );
  }
}
