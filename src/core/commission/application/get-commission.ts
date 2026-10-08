import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionView, toCommissionView } from './commission-view.ts';

export interface GetCommissionDependencies {
  readonly commissions: CommissionRepository;
}

/**
 * REQ-236: the agreed commission of a policy.
 */
export class GetCommission {
  private readonly deps: GetCommissionDependencies;

  constructor(deps: GetCommissionDependencies) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<CommissionView> {
    const commission = await this.deps.commissions.findByPolicyId(policyId);

    if (commission === null) {
      throw new RecordNotFound(COMMISSION_MESSAGES.NOT_FOUND, { policyId });
    }

    return toCommissionView(commission);
  }
}
