import type { DatabaseSync } from 'node:sqlite';
import { Money } from '../../../core/proposal/domain/money.ts';
import type { ReconciliationPendencyRepository } from '../../../core/reconciliation/application/reconciliation-pendency-repository.ts';
import { ReconciliationPendency } from '../../../core/reconciliation/domain/reconciliation-pendency.ts';

interface PendencyRow {
  id: string;
  competence: string;
  proposal_number: string;
  policy_number: string | null;
  reported_commission: string;
  registered_at: string;
}

export class SqliteReconciliationPendencyRepository implements ReconciliationPendencyRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(pendency: ReconciliationPendency): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO reconciliation_pendency (
           id, competence, proposal_number, policy_number, reported_commission, registered_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pendency.id,
        pendency.competence,
        pendency.proposalNumber,
        pendency.policyNumber,
        pendency.reportedCommission.toString(),
        pendency.registeredAt.toISOString(),
      );
  }

  async findByCompetenceAndProposalNumber(
    competence: string,
    proposalNumber: string,
  ): Promise<ReconciliationPendency | null> {
    const row = this.db
      .prepare('SELECT * FROM reconciliation_pendency WHERE competence = ? AND proposal_number = ?')
      .get(competence, proposalNumber) as PendencyRow | undefined;

    return row === undefined ? null : toPendency(row);
  }

  async listOpen(): Promise<readonly ReconciliationPendency[]> {
    const rows = this.db
      .prepare('SELECT * FROM reconciliation_pendency ORDER BY registered_at DESC, id')
      .all() as unknown as PendencyRow[];

    return rows.map(toPendency);
  }
}

function toPendency(row: PendencyRow): ReconciliationPendency {
  return ReconciliationPendency.restore({
    id: row.id,
    competence: row.competence,
    proposalNumber: row.proposal_number,
    policyNumber: row.policy_number,
    reportedCommission: Money.fromString(row.reported_commission),
    registeredAt: new Date(row.registered_at),
  });
}
