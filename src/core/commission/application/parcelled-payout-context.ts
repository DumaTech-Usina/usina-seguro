import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { Policy } from '../../policy/domain/policy.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { InstallmentBase, ParcelledPayoutCommission } from '../domain/parcelled-payout.ts';
import type { ParcelledPayoutRepository } from './parcelled-payout-repository.ts';

export interface ParcelledPayoutDependencies {
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly parcelledPayouts: ParcelledPayoutRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface ParcelledPayoutContext {
  readonly policy: Policy;
  /** The proposal the policy inherited every datum from (REQ-241). */
  readonly proposal: Proposal;
  readonly commission: ParcelledPayoutCommission | null;
}

/**
 * The policy, its proposal and its parcelled payout, loaded together. Only a
 * policy with parcelled CT has one (REQ-287); the integral CT's payout is the
 * single CR of section 9A.
 */
export async function loadParcelledPayout(
  deps: Pick<ParcelledPayoutDependencies, 'policies' | 'proposals' | 'parcelledPayouts'>,
  policyId: string,
): Promise<ParcelledPayoutContext> {
  const policy = await deps.policies.findById(policyId);

  if (policy === null) {
    throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
  }

  const proposal = await deps.proposals.findById(policy.proposalId);

  if (proposal === null) {
    throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
  }

  if (proposal.workedCommissionMode !== 'PARCELLED') {
    throw new BusinessRuleViolation(
      'REQ-287',
      COMMISSION_MESSAGES.PARCELLED_PAYOUT_REQUIRES_PARCELLED_CT,
    );
  }

  return {
    policy,
    proposal,
    commission: await deps.parcelledPayouts.findByPolicyId(policy.id),
  };
}

/** REQ-293, REQ-245: each installment with the CT and Usina value fixed on the policy. */
export function installmentBases(proposal: Proposal): InstallmentBase[] {
  return (proposal.expectedInstallmentReceipts() ?? []).map((installment) => ({
    number: installment.number,
    amount: installment.amount,
    workedCommission: installment.workedCommission,
    usinaValue: installment.usina,
  }));
}
