import type { Proposal } from '../domain/proposal.ts';

/**
 * Persistence contract for proposals, declared by the side that needs it.
 *
 * It lives in `application/` because it describes an orchestration need, not a
 * business truth. The implementations (InMemory, SQLite, PostgreSQL) live in
 * `infrastructure/` and are never referenced by the core.
 *
 * Deliberately minimal: only the methods an existing use case calls. No generic
 * `Repository<T>` and no speculative CRUD.
 */
export interface ProposalRepository {
  save(proposal: Proposal): Promise<void>;
  findById(id: string): Promise<Proposal | null>;
}
