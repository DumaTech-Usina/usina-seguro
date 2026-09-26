import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { Policy } from '../../policy/domain/policy.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import { type PayoutCommission, payoutBase, situationOf } from '../domain/payout-commission.ts';
import type { PayoutCommissionRepository } from './payout-commission-repository.ts';
import { type PolicyPayoutView, toPayoutCommissionView } from './payout-commission-view.ts';

export interface PayoutDependencies {
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly payouts: PayoutCommissionRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface PolicyPayoutContext {
  readonly policy: Policy;
  /** The proposal the policy inherited every datum from (REQ-241). */
  readonly proposal: Proposal;
  readonly commission: PayoutCommission | null;
}

/**
 * The policy, its proposal and its payout commission, loaded together.
 *
 * REQ-271, REJ-216: the CR only exists on a policy, so an unknown policy is
 * not found — there is nothing to inform it on.
 */
export async function loadPolicyPayout(
  deps: Pick<PayoutDependencies, 'policies' | 'proposals' | 'payouts'>,
  policyId: string,
): Promise<PolicyPayoutContext> {
  const policy = await deps.policies.findById(policyId);

  if (policy === null) {
    throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
  }

  const proposal = await deps.proposals.findById(policy.proposalId);

  if (proposal === null) {
    throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
  }

  return { policy, proposal, commission: await deps.payouts.findByPolicyId(policy.id) };
}

export function toPolicyPayoutView(context: PolicyPayoutContext): PolicyPayoutView {
  const mode = context.proposal.workedCommissionMode;
  const situation = situationOf(mode, context.commission);

  return {
    policyId: context.policy.id,
    policyNumber: context.policy.policyNumber,
    workedCommissionMode: mode,
    situation,
    // REQ-245: the base is fixed on the policy; the proposal it inherited is
    // frozen from the issuance on (REQ-244), so reading it here is the same.
    usinaValue:
      situation === null ? null : payoutBase(context.proposal.expectedReceipt()).toString(),
    commission: context.commission === null ? null : toPayoutCommissionView(context.commission),
  };
}
