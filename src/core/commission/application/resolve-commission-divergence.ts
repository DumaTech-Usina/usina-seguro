import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionView, toCommissionView } from './commission-view.ts';

export interface ResolveCommissionDivergenceInput {
  readonly policyId: string;
  readonly justification: string;
  readonly userId: string;
}

export interface ResolveCommissionDivergenceDependencies {
  readonly commissions: CommissionRepository;
  readonly now: () => Date;
}

/**
 * FP-02 step 5, REQ-085, CA-026: the Financeiro closes a divergence by hand,
 * leaving user, date and justification on the record (REQ-123).
 */
export class ResolveCommissionDivergence {
  private readonly deps: ResolveCommissionDivergenceDependencies;

  constructor(deps: ResolveCommissionDivergenceDependencies) {
    this.deps = deps;
  }

  async execute(input: ResolveCommissionDivergenceInput): Promise<CommissionView> {
    const commission = await this.deps.commissions.findByPolicyId(input.policyId);

    if (commission === null) {
      throw new RecordNotFound(COMMISSION_MESSAGES.NOT_FOUND, { policyId: input.policyId });
    }

    const resolved = commission.resolveDivergence({
      justification: input.justification,
      userId: input.userId,
      at: this.deps.now(),
    });

    await this.deps.commissions.save(resolved);

    return toCommissionView(resolved);
  }
}
