import type { DatabaseSync } from 'node:sqlite';
import type { PolicyRepository } from '../../../core/policy/application/policy-repository.ts';
import { CalendarDate } from '../../../core/policy/domain/calendar-date.ts';
import { Installment, type InstallmentStatus } from '../../../core/policy/domain/installment.ts';
import { Policy, type PolicyStatus } from '../../../core/policy/domain/policy.ts';
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
}

interface InstallmentRow {
  id: string;
  policy_id: string;
  number: number;
  amount: string;
  due_date: string;
  status: string;
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
             coverage_start, coverage_end, renewal_date, registered_at, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
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
        );

      const installment = this.db.prepare(
        `INSERT INTO installment (id, policy_id, number, amount, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
      );

      for (const item of policy.installments) {
        installment.run(
          item.id,
          item.policyId,
          item.number,
          item.amount.toString(),
          item.dueDate.toString(),
          item.status,
        );
      }
    });
  }

  async findById(id: string): Promise<Policy | null> {
    const row = this.db.prepare('SELECT * FROM policy WHERE id = ?').get(id) as
      | PolicyRow
      | undefined;

    if (row === undefined) {
      return null;
    }

    const installments = this.db
      .prepare('SELECT * FROM installment WHERE policy_id = ? ORDER BY number')
      .all(id) as unknown as InstallmentRow[];

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
        installments: installments.map((item) =>
          Installment.restore(
            {
              id: item.id,
              policyId: item.policy_id,
              number: item.number,
              amount: Money.fromString(item.amount),
              dueDate: CalendarDate.fromString(item.due_date),
            },
            item.status as InstallmentStatus,
          ),
        ),
      },
      row.status as PolicyStatus,
    );
  }
}
