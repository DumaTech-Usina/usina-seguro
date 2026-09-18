import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

export interface GetSettlementDependencies {
  readonly settlements: SettlementRepository;
}

/** OUT-07: the state of the broker transfer of a policy. */
export class GetSettlement {
  private readonly deps: GetSettlementDependencies;

  constructor(deps: GetSettlementDependencies) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<SettlementView> {
    const settlement = await this.deps.settlements.findByPolicyId(policyId);

    if (settlement === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.NOT_FOUND, { policyId });
    }

    return toSettlementView(settlement);
  }
}
