import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';

export interface PayInstallmentInput {
  readonly policyId: string;
  readonly number: number;
  /** REQ-123: who confirmed the client paid. */
  readonly userId: string;
}

export interface PayInstallmentDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly now: () => Date;
}

/**
 * IN-13, REQ-092, FP-03 step 3: a user of the Usina confirms the client paid
 * an installment. REQ-123 requires the record to say who did it and when.
 *
 * It lives in the policy module because the schedule belongs to the policy
 * (REQ-020). The settlement module reads the outcome through the policy
 * repository; nothing here knows a transfer exists, which keeps the direction
 * `settlement -> policy`.
 */
export class PayInstallment {
  private readonly deps: PayInstallmentDependencies;

  constructor(deps: PayInstallmentDependencies) {
    this.deps = deps;
  }

  async execute(input: PayInstallmentInput): Promise<PolicyView> {
    const policy = await this.deps.policies.findById(input.policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: input.policyId });
    }

    const proposal = await this.deps.proposals.findById(policy.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
    }

    // REQ-269: on a policy with parcelled CT the act on an installment is its
    // eligibility; the confirmation of payment does not exist there.
    if (proposal.workedCommissionMode === 'PARCELLED') {
      throw new BusinessRuleViolation(
        'REQ-269',
        POLICY_MESSAGES.PARCELLED_INSTALLMENT_HAS_NO_PAYMENT_CONFIRMATION,
      );
    }

    const paid = policy.payInstallment(input.number, {
      userId: input.userId,
      at: this.deps.now(),
    });
    await this.deps.policies.save(paid);

    return toPolicyView(paid, proposal);
  }
}
