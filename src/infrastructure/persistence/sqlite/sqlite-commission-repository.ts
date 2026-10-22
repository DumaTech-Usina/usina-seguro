import type { DatabaseSync } from 'node:sqlite';
import type {
  CommissionListFilter,
  CommissionRepository,
} from '../../../core/commission/application/commission-repository.ts';
import { Commission, type CommissionStatus } from '../../../core/commission/domain/commission.ts';
import type { Page, PageRequest } from '../../../core/proposal/application/page.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';
import { readPage } from './sqlite-page.ts';

interface CommissionRow {
  id: string;
  policy_id: string;
  status: string;
  calculated_at: string;
  premium: string;
  insurer_rate: string;
  insurer_amount: string;
  intermediary_id: string | null;
  intermediary_rate: string | null;
  agreed_receivable: string;
  override_receivable: string | null;
  override_justification: string | null;
  override_user_id: string | null;
  override_at: string | null;
}

/**
 * The commission is a single row: the basis, the agreed value and the
 * override belong to the same record and are never written apart.
 *
 * Nothing is ever deleted (REQ-124): an override is extra columns on the
 * record, next to the values it explains, not a replacement of them.
 */
export class SqliteCommissionRepository implements CommissionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(commission: Commission): Promise<void> {
    const { basis, override } = commission;

    this.db
      .prepare(
        `INSERT INTO commission (
           id, policy_id, status, calculated_at,
           premium, insurer_rate, insurer_amount, intermediary_id, intermediary_rate,
           agreed_receivable,
           override_receivable, override_justification,
           override_user_id, override_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status                   = excluded.status,
           override_receivable      = excluded.override_receivable,
           override_justification   = excluded.override_justification,
           override_user_id         = excluded.override_user_id,
           override_at              = excluded.override_at`,
      )
      .run(
        commission.id,
        commission.policyId,
        commission.status,
        commission.calculatedAt.toISOString(),
        basis.premium.toString(),
        basis.insurerRate.toString(),
        basis.insurerAmount.toString(),
        basis.intermediaryId,
        basis.intermediaryRate?.toString() ?? null,
        commission.agreedReceivable.toString(),
        override?.receivable.toString() ?? null,
        override?.justification ?? null,
        override?.userId ?? null,
        override?.at.toISOString() ?? null,
      );
  }

  async findByPolicyId(policyId: string): Promise<Commission | null> {
    const row = this.db.prepare('SELECT * FROM commission WHERE policy_id = ?').get(policyId) as
      | CommissionRow
      | undefined;

    return row === undefined ? null : toCommission(row);
  }

  /** OUT-05: the panel reads every policy at once, newest calculation first. */
  async list(filter: CommissionListFilter): Promise<readonly Commission[]> {
    const rows = (filter.status === undefined
      ? this.db.prepare('SELECT * FROM commission ORDER BY calculated_at DESC, id DESC').all()
      : this.db
          .prepare('SELECT * FROM commission WHERE status = ? ORDER BY calculated_at DESC, id DESC')
          .all(filter.status)) as unknown as CommissionRow[];

    return rows.map(toCommission);
  }

  /** REQ-330: one page of `list`, in the same order. */
  async page(filter: CommissionListFilter, page: PageRequest): Promise<Page<Commission>> {
    const rows = readPage<CommissionRow>(
      this.db,
      {
        columns: '*',
        from: filter.status === undefined ? 'commission' : 'commission WHERE status = ?',
        orderBy: 'calculated_at DESC, id DESC',
      },
      filter.status === undefined ? [] : [filter.status],
      page,
    );
    return { ...rows, items: rows.items.map(toCommission) };
  }
}

function toCommission(row: CommissionRow): Commission {
  return Commission.restore(
    {
      id: row.id,
      policyId: row.policy_id,
      basis: {
        premium: Money.fromString(row.premium),
        insurerRate: Percentage.fromString(row.insurer_rate),
        insurerAmount: Money.fromString(row.insurer_amount),
        intermediaryId: row.intermediary_id,
        intermediaryRate:
          row.intermediary_rate === null ? null : Percentage.fromString(row.intermediary_rate),
      },
      agreedReceivable: Money.fromString(row.agreed_receivable),
      calculatedAt: new Date(row.calculated_at),
    },
    {
      status: row.status as CommissionStatus,
      override:
        row.override_at === null || row.override_receivable === null
          ? null
          : {
              receivable: Money.fromString(row.override_receivable),
              justification: row.override_justification ?? '',
              userId: row.override_user_id ?? '',
              at: new Date(row.override_at),
            },
    },
  );
}
