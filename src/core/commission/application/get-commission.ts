import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionView, toCommissionView } from './commission-view.ts';

export interface GetCommissionDependencies {
  readonly commissions: CommissionRepository;
}

/**
 * CA-016, REQ-076, OUT-05: the agreed and the real commission of a policy side
 * by side, with the divergence signalled.
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
