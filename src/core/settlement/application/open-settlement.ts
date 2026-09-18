import type { CommissionRepository } from '../../commission/application/commission-repository.ts';
import { COMMISSION_MESSAGES } from '../../commission/domain/errors.ts';
import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import { Settlement } from '../domain/settlement.ts';
import type { PaymentMethodReleaseRuleRepository } from './payment-method-release-rule-repository.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

export interface OpenSettlementInput {
  readonly policyId: string;
}

export interface OpenSettlementDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly commissions: CommissionRepository;
  readonly releaseRules: PaymentMethodReleaseRuleRepository;
  readonly settlements: SettlementRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-03 steps 1 to 3: with the real commission apurada, the system evaluates
 * the release rule of the payment method and opens the broker transfer.
 *
 * It is triggered by the Financeiro rather than following the reconciliation
 * on its own: `DEC-008` has not decided the term and the periodicity of the
 * transfer, so the system has nothing to decide *when* from and does not
 * pretend otherwise.
 *
 * The three reads are the whole of what crosses a module boundary here: the
 * amount comes from the commission (REQ-093), the payment method and the
 * broker from the proposal, and the first installment from the policy
 * (REQ-091). Nothing writes outside this module.
 */
export class OpenSettlement {
  private readonly deps: OpenSettlementDependencies;

  constructor(deps: OpenSettlementDependencies) {
    this.deps = deps;
  }

  async execute(input: OpenSettlementInput): Promise<SettlementView> {
    const existing = await this.deps.settlements.findByPolicyId(input.policyId);

    if (existing !== null) {
      throw new BusinessRuleViolation('REQ-094', SETTLEMENT_MESSAGES.ALREADY_OPEN);
    }

    const policy = await this.deps.policies.findById(input.policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: input.policyId });
    }

    const proposal = await this.deps.proposals.findById(policy.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
    }

    const commission = await this.deps.commissions.findByPolicyId(policy.id);

    if (commission === null) {
      throw new RecordNotFound(COMMISSION_MESSAGES.NOT_FOUND, { policyId: policy.id });
    }

    // FP-03 step 1: the transfer follows the apuration of the real commission.
    // A divergence does not stop it (REQ-077); an absent real value does,
    // because there would be nothing apurado to act on.
    if (commission.realReceivable === null) {
      throw new BusinessRuleViolation('REQ-094', SETTLEMENT_MESSAGES.COMMISSION_NOT_RECONCILED, {
        status: commission.status,
      });
    }

    const releaseRule = await this.deps.releaseRules.findByPaymentMethodId(
      proposal.paymentMethodId,
    );

    // REQ-090 makes the rule an attribute of the payment method, and it is
    // configuration (REQ-125). Without it the system cannot know whether the
    // transfer is released, and guessing would be deciding for the business.
    if (releaseRule === null) {
      throw new BusinessRuleViolation('REQ-090', SETTLEMENT_MESSAGES.RELEASE_RULE_NOT_CONFIGURED, {
        paymentMethodId: proposal.paymentMethodId,
      });
    }

    const settlement = Settlement.open(
      {
        id: this.deps.newId(),
        policyId: policy.id,
        brokerId: proposal.brokerId,
        // REQ-093: the broker's table over the base, override of REQ-066
        // included. The commission holds both, already calculated.
        amount: commission.effectivePayable,
        releaseRule: releaseRule.release,
        openedAt: this.deps.now(),
      },
      policy.isFirstInstallmentPaid,
    );

    await this.deps.settlements.save(settlement);

    return toSettlementView(settlement);
  }
}
