import type { DatabaseSync } from 'node:sqlite';
import type {
  PolicyListFilter,
  PolicyRepository,
} from '../../../core/policy/application/policy-repository.ts';
import { Installment, type InstallmentStatus } from '../../../core/policy/domain/installment.ts';
import { Policy, type PolicyStatus } from '../../../core/policy/domain/policy.ts';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import { CalendarDate } from '../../../core/proposal/domain/calendar-date.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface PolicyRow {
  id: string;
  proposal_id: string;
  policy_number: string;
  premium: string;
  coverage_start: string;
  coverage_end: string;
  renewal_date: string;
  registered_at: string;
  status: string;
  document_id: string | null;
  document_file_name: string | null;
  document_attached_by: string | null;
  document_attached_at: string | null;
}

interface InstallmentRow {
  id: string;
  policy_id: string;
  number: number;
  amount: string;
  due_date: string | null;
  status: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export class SqlitePolicyRepository implements PolicyRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Writes the policy and its installments as one record (REQ-020): the rows
   * go in a savepoint of their own, so a failure halfway never leaves a policy
   * with part of its schedule.
   */
  async save(policy: Policy): Promise<void> {
    await withSavepoint(this.db, 'policy_save', async () => {
      this.db
        .prepare(
          `INSERT INTO policy (
             id, proposal_id, policy_number, premium,
             coverage_start, coverage_end, renewal_date, registered_at, status,
             document_id, document_file_name, document_attached_by, document_attached_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status               = excluded.status,
             document_id          = excluded.document_id,
             document_file_name   = excluded.document_file_name,
             document_attached_by = excluded.document_attached_by,
             document_attached_at = excluded.document_attached_at`,
        )
        .run(
          policy.id,
          policy.proposalId,
          policy.policyNumber,
          policy.premium.toString(),
          policy.coverageStart.toString(),
          policy.coverageEnd.toString(),
          policy.renewalDate.toString(),
          policy.registeredAt.toISOString(),
          policy.status,
          // REQ-247: the PDF in force and its signature.
          policy.document?.documentId ?? null,
          policy.document?.fileName ?? null,
          policy.document?.attached.author ?? null,
          policy.document?.attached.at.toISOString() ?? null,
        );

      const installment = this.db.prepare(
        `INSERT INTO installment (
           id, policy_id, number, amount, due_date, status, confirmed_at, confirmed_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status       = excluded.status,
           confirmed_at = excluded.confirmed_at,
           confirmed_by = excluded.confirmed_by`,
      );

      for (const item of policy.installments) {
        installment.run(
          item.id,
          item.policyId,
          item.number,
          item.amount.toString(),
          item.dueDate?.toString() ?? null,
          item.status,
          // REQ-123: who confirmed the receipt, and when (IN-13).
          item.confirmation?.at.toISOString() ?? null,
          item.confirmation?.userId ?? null,
        );
      }
    });
  }

  async findById(id: string): Promise<Policy | null> {
    return this.load('SELECT * FROM policy WHERE id = ?', id);
  }

  /**
   * REQ-082, CA-018: the conciliation key is the policy number. It may repeat
   * (DEC-207): the policy registered first answers.
   */
  async findByPolicyNumber(policyNumber: string): Promise<Policy | null> {
    return this.load(
      'SELECT * FROM policy WHERE policy_number = ? ORDER BY registered_at, id LIMIT 1',
      policyNumber,
    );
  }

  /** REQ-082, CA-019: reached through the link of REQ-050. */
  async findByProposalId(proposalId: string): Promise<Policy | null> {
    return this.load('SELECT * FROM policy WHERE proposal_id = ?', proposalId);
  }

  /**
   * OUT-03, OUT-04: the listing, nearest renewal first (REQ-055).
   *
   * The cut-off compares ISO days as text, which is chronological order for
   * this format, so the query needs no date function of the driver — the same
   * comparison the domain makes (`CalendarDate.isBefore`) and the same one
   * PostgreSQL would make on a `date` column.
   */
  async list(filter: PolicyListFilter): Promise<readonly Policy[]> {
    const { renewalUntil } = filter;

    const rows = (renewalUntil === undefined
      ? this.db.prepare('SELECT * FROM policy ORDER BY renewal_date, id').all()
      : this.db
          .prepare('SELECT * FROM policy WHERE renewal_date <= ? ORDER BY renewal_date, id')
          .all(renewalUntil.toString())) as unknown as PolicyRow[];

    return rows.map((row) => this.restore(row));
  }

  private async load(sql: string, parameter: string): Promise<Policy | null> {
    const row = this.db.prepare(sql).get(parameter) as PolicyRow | undefined;

    if (row === undefined) {
      return null;
    }

    return this.restore(row);
  }

  private restore(row: PolicyRow): Policy {
    const installments = this.db
      .prepare('SELECT * FROM installment WHERE policy_id = ? ORDER BY number')
      .all(row.id) as unknown as InstallmentRow[];

    return Policy.restore(
      {
        id: row.id,
        proposalId: row.proposal_id,
        policyNumber: row.policy_number,
        premium: Money.fromString(row.premium),
        coverageStart: CalendarDate.fromString(row.coverage_start),
        coverageEnd: CalendarDate.fromString(row.coverage_end),
        renewalDate: CalendarDate.fromString(row.renewal_date),
        registeredAt: new Date(row.registered_at),
        document:
          row.document_id === null
            ? null
            : {
                documentId: row.document_id,
                fileName: row.document_file_name ?? '',
                attached: Authorship.restore(
                  row.document_attached_by ?? '',
                  new Date(row.document_attached_at ?? ''),
                ),
              },
        installments: installments.map((item) =>
          Installment.restore(
            {
              id: item.id,
              policyId: item.policy_id,
              number: item.number,
              amount: Money.fromString(item.amount),
              dueDate: item.due_date === null ? null : CalendarDate.fromString(item.due_date),
            },
            item.status as InstallmentStatus,
            item.confirmed_at === null
              ? null
              : { userId: item.confirmed_by ?? '', at: new Date(item.confirmed_at) },
          ),
        ),
      },
      row.status as PolicyStatus,
    );
  }
}
