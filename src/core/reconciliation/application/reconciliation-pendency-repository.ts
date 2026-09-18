import type { ReconciliationPendency } from '../domain/reconciliation-pendency.ts';

export interface ReconciliationPendencyRepository {
  save(pendency: ReconciliationPendency): Promise<void>;
  /**
   * CA-021, EX-05: the pendency a previous import of the same report already
   * opened for this line. The competence and the proposal number identify it —
   * the proposal number is the one field REQ-081 always brings, and the policy
   * number is precisely what is missing when a line becomes a pendency.
   */
  findByCompetenceAndProposalNumber(
    competence: string,
    proposalNumber: string,
  ): Promise<ReconciliationPendency | null>;
  /** OUT-06: the lines waiting for a human, most recent first. */
  listOpen(): Promise<readonly ReconciliationPendency[]>;
}
