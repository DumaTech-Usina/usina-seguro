import type { Money } from '../../proposal/domain/money.ts';

/**
 * A line of the commission report that did not match any policy (REQ-083,
 * EX-01, OUT-06).
 *
 * It is a business record, not a leftover: REQ-083 says the line becomes a
 * pendency for manual handling and generates **no** commission entry
 * (REJ-013), and REQ-124 keeps it rather than discarding it. What the report
 * claimed is preserved exactly as it arrived, because the whole point of the
 * pendency is to let a human compare it with what the system knows.
 */
export interface ReconciliationPendencyData {
  readonly id: string;
  /** REQ-086: the period of the report that produced the line. */
  readonly competence: string;
  readonly proposalNumber: string;
  readonly policyNumber: string | null;
  /** "Comissao do produtor (valor)" as reported (REQ-081). */
  readonly reportedCommission: Money;
  readonly registeredAt: Date;
}

export class ReconciliationPendency {
  readonly id: string;
  readonly competence: string;
  readonly proposalNumber: string;
  readonly policyNumber: string | null;
  readonly reportedCommission: Money;
  readonly registeredAt: Date;

  private constructor(data: ReconciliationPendencyData) {
    this.id = data.id;
    this.competence = data.competence;
    this.proposalNumber = data.proposalNumber;
    this.policyNumber = data.policyNumber;
    this.reportedCommission = data.reportedCommission;
    this.registeredAt = data.registeredAt;
  }

  static open(data: ReconciliationPendencyData): ReconciliationPendency {
    return new ReconciliationPendency(data);
  }

  /** Rebuilds a persisted pendency without re-applying the rules (REQ-124). */
  static restore(data: ReconciliationPendencyData): ReconciliationPendency {
    return new ReconciliationPendency(data);
  }
}
