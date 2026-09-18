import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

export interface ReleaseSettlementInput {
  readonly policyId: string;
}

export interface ReleaseSettlementDependencies {
  readonly policies: PolicyRepository;
  readonly settlements: SettlementRepository;
  readonly now: () => Date;
}

/**
 * FP-03 step 3: the Financeiro releases a transfer that was waiting for the
 * confirmation of the client's first installment (REQ-091, REQ-092).
 *
 * The use case reads the schedule and hands the answer to the domain, which
 * owns REJ-009.
 */
export class ReleaseSettlement {
  private readonly deps: ReleaseSettlementDependencies;

  constructor(deps: ReleaseSettlementDependencies) {
    this.deps = deps;
  }

  async execute(input: ReleaseSettlementInput): Promise<SettlementView> {
    const settlement = await this.deps.settlements.findByPolicyId(input.policyId);

    if (settlement === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.NOT_FOUND, { policyId: input.policyId });
    }

    const policy = await this.deps.policies.findById(settlement.policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: settlement.policyId });
    }

    const released = settlement.release(policy.isFirstInstallmentPaid, this.deps.now());
    await this.deps.settlements.save(released);

    return toSettlementView(released);
  }
}
