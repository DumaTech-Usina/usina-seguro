import type { AgreedCommissionCalculator } from '../../policy/application/agreed-commission-calculator.ts';
import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { BrokerCommissionRateRepository } from './broker-commission-rate-repository.ts';
import type { CommissionAgreementRepository } from './commission-agreement-repository.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionView, toCommissionView } from './commission-view.ts';

export interface CalculatePolicyCommissionInput {
  readonly policyId: string;
}

export interface CalculatePolicyCommissionDependencies {
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly commissions: CommissionRepository;
  readonly agreements: CommissionAgreementRepository;
  readonly brokerRates: BrokerCommissionRateRepository;
  /** The same calculation FP-01 step 7 runs; this is the second door to it. */
  readonly agreedCommission: AgreedCommissionCalculator;
}

/**
 * Calculates the agreed commission of a policy that does not have one yet
 * (REQ-075, FP-01 step 7).
 *
 * **Why this exists.** The calculation used to happen in exactly one place —
 * inside `RegisterPolicy` — and it produces nothing when the commercial
 * agreement or the broker table is not registered yet. That silence is
 * deliberate there: REQ-002 makes the system reflect a business that happened
 * outside it, so a missing registry must not refuse a policy that exists.
 * What was missing was the way back. A policy registered before the registries
 * stayed without a commission for good: nothing recalculated, the override of
 * REQ-066 needs a commission to adjust, and REQ-124 forbids deleting the
 * record. This use case is that way back, and it is the whole of the change.
 *
 * **It calculates as of the policy's registration, not as of today.** The date
 * is what selects the agreement in force (REQ-065), and `RegisterPolicy`
 * anchors it to `policy.registeredAt`. Anchoring here to the clock instead
 * would mean two policies registered on the same day getting different rates
 * depending on when somebody clicked — which is the same class of silent
 * divergence this use case exists to remove. The consequence is visible and
 * has to be: an agreement registered today for a policy from last week must
 * carry a validity that reaches back, and the refusal below says so.
 *
 * **It never touches a commission that exists.** REQ-124 and REJ-011: a
 * calculated value is not recalculated. Changing one is the override of
 * REQ-066, which records who and why.
 */
export class CalculatePolicyCommission {
  private readonly deps: CalculatePolicyCommissionDependencies;

  constructor(deps: CalculatePolicyCommissionDependencies) {
    this.deps = deps;
  }

  async execute(input: CalculatePolicyCommissionInput): Promise<CommissionView> {
    const policy = await this.deps.policies.findById(input.policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: input.policyId });
    }

    // REQ-124, REJ-011: what is already calculated stays as it is, override
    // and conciliation included.
    const existing = await this.deps.commissions.findByPolicyId(policy.id);

    if (existing !== null) {
      throw new BusinessRuleViolation('REQ-124', COMMISSION_MESSAGES.ALREADY_CALCULATED);
    }

    const proposal = await this.deps.proposals.findById(policy.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
    }

    // The two registries the calculation reads. They are checked here, before
    // delegating, for one reason: the calculation answers nothing when they
    // are missing, and an operator who asked for this explicitly has to learn
    // *which* registry is missing — not watch the screen stay the same.
    const on = CalendarDate.fromString(policy.registeredAt.toISOString().slice(0, 10));
    const agreement = await this.deps.agreements.findInForce(
      proposal.insurerId,
      proposal.productId,
      on,
    );

    if (agreement === null) {
      throw new BusinessRuleViolation('REQ-065', COMMISSION_MESSAGES.NO_AGREEMENT_IN_FORCE, {
        insurerId: proposal.insurerId,
        productId: proposal.productId,
        on: on.toString(),
      });
    }

    if ((await this.deps.brokerRates.findByBrokerId(proposal.brokerId)) === null) {
      throw new BusinessRuleViolation('IN-05', COMMISSION_MESSAGES.NO_BROKER_RATE, {
        brokerId: proposal.brokerId,
      });
    }

    // The calculation itself is not repeated here: it is the same port FP-01
    // step 7 uses, so the chain of REQ-060/REQ-062/REQ-063 — direct or through
    // an intermediary — and the basis of REQ-064 are decided in one place.
    await this.deps.agreedCommission.calculateFor({
      policyId: policy.id,
      proposalId: proposal.id,
      premium: policy.premium,
      calculatedAt: policy.registeredAt,
    });

    const calculated = await this.deps.commissions.findByPolicyId(policy.id);

    if (calculated === null) {
      throw new RecordNotFound(COMMISSION_MESSAGES.NOT_FOUND, { policyId: policy.id });
    }

    return toCommissionView(calculated);
  }
}
