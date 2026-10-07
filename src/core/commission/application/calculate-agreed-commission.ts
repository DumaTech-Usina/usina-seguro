import type {
  AgreedCommissionCalculator,
  AgreedCommissionRequest,
} from '../../policy/application/agreed-commission-calculator.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { calculateCommission } from '../domain/commission-basis.ts';
import { Commission } from '../domain/commission.ts';
import type { CommissionRepository } from './commission-repository.ts';

export interface CalculateAgreedCommissionDependencies {
  readonly proposals: ProposalRepository;
  readonly commissions: CommissionRepository;
  readonly newId: () => string;
}

/**
 * The policy was registered, so its agreed commission is calculated.
 *
 * It implements the port the policy module declares, which is the whole of the
 * `commission -> policy` coupling: the policy hands over the originating
 * proposal and learns nothing about commissions.
 *
 * REQ-236: the Usina side comes from the proposal — its CT, or CT then CTU
 * through the intermediary — never from a registered commercial agreement,
 * which no longer exists.
 */
export class CalculateAgreedCommission implements AgreedCommissionCalculator {
  private readonly deps: CalculateAgreedCommissionDependencies;

  constructor(deps: CalculateAgreedCommissionDependencies) {
    this.deps = deps;
  }

  async calculateFor(request: AgreedCommissionRequest): Promise<void> {
    const proposal = await this.deps.proposals.findById(request.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: request.proposalId });
    }

    // REQ-227: a parcelled CT has no single agreed value (REJ-232), so the
    // policy gets no agreed commission.
    if (proposal.workedCommissionMode === 'PARCELLED') {
      return;
    }

    const calculated = calculateCommission(proposal);

    await this.deps.commissions.save(
      Commission.forecast({
        id: this.deps.newId(),
        policyId: request.policyId,
        basis: calculated.basis,
        agreedReceivable: calculated.receivable,
        calculatedAt: request.calculatedAt,
      }),
    );
  }
}
