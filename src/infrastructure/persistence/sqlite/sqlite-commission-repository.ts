import type { DatabaseSync } from 'node:sqlite';
import type {
  CommissionListFilter,
  CommissionRepository,
} from '../../../core/commission/application/commission-repository.ts';
import type { BrokerBase } from '../../../core/commission/domain/commission-basis.ts';
import { Commission, type CommissionStatus } from '../../../core/commission/domain/commission.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';

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
  broker_base: string;
  broker_base_amount: string;
  broker_rate: string;
  agreed_receivable: string;
  agreed_payable: string;
  override_receivable: string | null;
  override_payable: string | null;
  override_justification: string | null;
  override_user_id: string | null;
  override_at: string | null;
  real_receivable: string | null;
  reconciled_competence: string | null;
  reconciled_at: string | null;
  resolution_justification: string | null;
  resolution_user_id: string | null;
  resolved_at: string | null;
}

/**
 * The commission is a single row: the basis, the agreed pair, the override and
 * the real value all belong to the same record and are never written apart.
 *
 * Nothing is ever deleted (REQ-124): an override and a resolution are extra
 * columns on the record, next to the values they explain, not a replacement
 * of them.
 */
export class SqliteCommissionRepository implements CommissionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(commission: Commission): Promise<void> {
    const { basis, override, resolution } = commission;

    this.db
      .prepare(
        `INSERT INTO commission (
           id, policy_id, status, calculated_at,
           premium, insurer_rate, insurer_amount, intermediary_id, intermediary_rate,
           broker_base, broker_base_amount, broker_rate,
           agreed_receivable, agreed_payable,
           override_receivable, override_payable, override_justification,
           override_user_id, override_at,
           real_receivable, reconciled_competence, reconciled_at,
           resolution_justification, resolution_user_id, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status                   = excluded.status,
           override_receivable      = excluded.override_receivable,
           override_payable         = excluded.override_payable,
           override_justification   = excluded.override_justification,
           override_user_id         = excluded.override_user_id,
           override_at              = excluded.override_at,
           real_receivable          = excluded.real_receivable,
           reconciled_competence    = excluded.reconciled_competence,
           reconciled_at            = excluded.reconciled_at,
           resolution_justification = excluded.resolution_justification,
           resolution_user_id       = excluded.resolution_user_id,
           resolved_at              = excluded.resolved_at`,
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
        basis.brokerBase,
        basis.brokerBaseAmount.toString(),
        basis.brokerRate.toString(),
        commission.agreedReceivable.toString(),
        commission.agreedPayable.toString(),
        override?.receivable?.toString() ?? null,
        override?.payable?.toString() ?? null,
        override?.justification ?? null,
        override?.userId ?? null,
        override?.at.toISOString() ?? null,
        commission.realReceivable?.toString() ?? null,
        commission.reconciledCompetence,
        commission.reconciledAt?.toISOString() ?? null,
        resolution?.justification ?? null,
        resolution?.userId ?? null,
        resolution?.at.toISOString() ?? null,
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
        brokerBase: row.broker_base as BrokerBase,
        brokerBaseAmount: Money.fromString(row.broker_base_amount),
        brokerRate: Percentage.fromString(row.broker_rate),
      },
      agreedReceivable: Money.fromString(row.agreed_receivable),
      agreedPayable: Money.fromString(row.agreed_payable),
      calculatedAt: new Date(row.calculated_at),
    },
    {
      status: row.status as CommissionStatus,
      override:
        row.override_at === null
          ? null
          : {
              receivable:
                row.override_receivable === null ? null : Money.fromString(row.override_receivable),
              payable:
                row.override_payable === null ? null : Money.fromString(row.override_payable),
              justification: row.override_justification ?? '',
              userId: row.override_user_id ?? '',
              at: new Date(row.override_at),
            },
      realReceivable: row.real_receivable === null ? null : Money.fromString(row.real_receivable),
      reconciledCompetence: row.reconciled_competence,
      reconciledAt: row.reconciled_at === null ? null : new Date(row.reconciled_at),
      resolution:
        row.resolved_at === null
          ? null
          : {
              justification: row.resolution_justification ?? '',
              userId: row.resolution_user_id ?? '',
              at: new Date(row.resolved_at),
            },
    },
  );
}
