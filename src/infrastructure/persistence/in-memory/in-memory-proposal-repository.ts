import type { ProposalRepository } from '../../../core/proposal/application/proposal-repository.ts';
import type { Proposal } from '../../../core/proposal/domain/proposal.ts';

/**
 * `ProposalRepository` implementation for unit tests and fast execution.
 *
 * It does not simulate transactions, concurrency or database constraints. When
 * the behaviour under test depends on those, the test must use SQLite.
 */
export class InMemoryProposalRepository implements ProposalRepository {
  private readonly records = new Map<string, Proposal>();

  async save(proposal: Proposal): Promise<void> {
    this.records.set(proposal.id, proposal);
  }

  async findById(id: string): Promise<Proposal | null> {
    return this.records.get(id) ?? null;
  }

  async findByProposalNumber(proposalNumber: string): Promise<Proposal | null> {
    for (const proposal of this.records.values()) {
      if (proposal.proposalNumber === proposalNumber) {
        return proposal;
      }
    }

    return null;
  }
}
