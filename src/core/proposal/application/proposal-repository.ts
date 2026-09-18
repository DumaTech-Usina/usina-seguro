import type { Proposal, ProposalStatus } from '../domain/proposal.ts';

/**
 * What narrows a listing. Absent means "every proposal".
 */
export interface ProposalListFilter {
  readonly status?: ProposalStatus;
}

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
  /**
   * REQ-082: the commission report identifies the business by the number the
   * insurer issued, and the policy is reached from the proposal it originated
   * (REQ-050). Only a transmitted proposal has a number, so an unknown one
   * answers null rather than an error.
   */
  findByProposalNumber(proposalNumber: string): Promise<Proposal | null>;
  /**
   * REQ-043, OUT-01: the proposals to follow, most recently registered first.
   *
   * The order is part of the contract and not an accident of the driver: a
   * worklist that reshuffles between two reads is unusable, and both
   * implementations are tested against it.
   */
  list(filter: ProposalListFilter): Promise<readonly Proposal[]>;
}
