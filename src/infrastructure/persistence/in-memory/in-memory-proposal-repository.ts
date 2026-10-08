import type {
  ProposalListFilter,
  ProposalRepository,
} from '../../../core/proposal/application/proposal-repository.ts';
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

  /** Same order the SQLite driver answers: newest first. */
  async list(filter: ProposalListFilter): Promise<readonly Proposal[]> {
    return [...this.records.values()]
      .filter((proposal) => filter.status === undefined || proposal.status === filter.status)
      .sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
  }
}
