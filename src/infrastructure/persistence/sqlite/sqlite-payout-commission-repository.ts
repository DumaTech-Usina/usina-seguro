import type { DatabaseSync } from 'node:sqlite';
import type { PayoutCommissionRepository } from '../../../core/commission/application/payout-commission-repository.ts';
import {
  type EligibilityStatement,
  PayoutCommission,
  type PayoutStatus,
} from '../../../core/commission/domain/payout-commission.ts';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface CommissionRow {
  id: string;
  policy_id: string;
  status: string;
  statement_policy_number: string | null;
  statement_broker: string | null;
  statement_client: string | null;
  statement_net_premium: string | null;
  statement_worked_commission: string | null;
  statement_payout_rate: string | null;
  statement_ctu: string | null;
  statement_usina_value: string | null;
  statement_retained: string | null;
  statement_payout: string | null;
  eligible_by: string | null;
  eligible_at: string | null;
}

interface EntryRow {
  rate: string;
  previous_rate: string | null;
  reason: string | null;
  base: string;
  payout: string;
  retained: string;
  informed_by: string;
  informed_at: string;
}

/**
 * The payout commission is two tables: the record, with its statement once
 * eligible, and the append-only CR entries (REQ-279). An entry already stored
 * is left as it is; only the state and the statement are written in place.
 */
export class SqlitePayoutCommissionRepository implements PayoutCommissionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(commission: PayoutCommission): Promise<void> {
    const statement = commission.statement;

    await withSavepoint(this.db, 'payout_commission_save', async () => {
      this.db
        .prepare(
          `INSERT INTO payout_commission (
             id, policy_id, status,
             statement_policy_number, statement_broker, statement_client,
             statement_net_premium, statement_worked_commission, statement_payout_rate,
             statement_ctu, statement_usina_value, statement_retained, statement_payout,
             eligible_by, eligible_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status                      = excluded.status,
             statement_policy_number     = excluded.statement_policy_number,
             statement_broker            = excluded.statement_broker,
             statement_client            = excluded.statement_client,
             statement_net_premium       = excluded.statement_net_premium,
             statement_worked_commission = excluded.statement_worked_commission,
             statement_payout_rate       = excluded.statement_payout_rate,
             statement_ctu               = excluded.statement_ctu,
             statement_usina_value       = excluded.statement_usina_value,
             statement_retained          = excluded.statement_retained,
             statement_payout            = excluded.statement_payout,
             eligible_by                 = excluded.eligible_by,
             eligible_at                 = excluded.eligible_at`,
        )
        .run(
          commission.id,
          commission.policyId,
          commission.status,
          statement?.policyNumber ?? null,
          statement?.broker ?? null,
          statement?.client ?? null,
          statement?.netPremium.toString() ?? null,
          statement?.workedCommission.toString() ?? null,
          statement?.payoutRate.toString() ?? null,
          statement?.ctu?.toString() ?? null,
          statement?.usinaValue.toString() ?? null,
          statement?.retained.toString() ?? null,
          statement?.payout.toString() ?? null,
          statement?.signedBy ?? null,
          statement?.eligibleAt.toISOString() ?? null,
        );

      const entry = this.db.prepare(
        `INSERT INTO payout_rate_entry (
           payout_commission_id, sequence, rate, previous_rate, reason,
           base, payout, retained, informed_by, informed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      commission.entries.forEach((item, index) => {
        entry.run(
          commission.id,
          index + 1,
          item.calculation.rate.toString(),
          item.previousRate?.toString() ?? null,
          item.reason,
          item.calculation.base.toString(),
          item.calculation.payout.toString(),
          item.calculation.retained.toString(),
          item.informed.author,
          item.informed.at.toISOString(),
        );
      });
    });
  }

  async findByPolicyId(policyId: string): Promise<PayoutCommission | null> {
    const row = this.db
      .prepare('SELECT * FROM payout_commission WHERE policy_id = ?')
      .get(policyId) as CommissionRow | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async list(): Promise<readonly PayoutCommission[]> {
    const rows = this.db
      .prepare('SELECT * FROM payout_commission ORDER BY id')
      .all() as unknown as CommissionRow[];

    return rows.map((row) => this.restore(row));
  }

  private restore(row: CommissionRow): PayoutCommission {
    const entries = this.db
      .prepare('SELECT * FROM payout_rate_entry WHERE payout_commission_id = ? ORDER BY sequence')
      .all(row.id) as unknown as EntryRow[];

    return PayoutCommission.restore({
      id: row.id,
      policyId: row.policy_id,
      status: row.status as PayoutStatus,
      entries: entries.map((entry) => ({
        calculation: {
          rate: Percentage.fromString(entry.rate),
          base: Money.fromString(entry.base),
          payout: Money.fromString(entry.payout),
          retained: Money.fromString(entry.retained),
        },
        previousRate:
          entry.previous_rate === null ? null : Percentage.fromString(entry.previous_rate),
        reason: entry.reason,
        informed: Authorship.restore(entry.informed_by, new Date(entry.informed_at)),
      })),
      statement: toStatement(row),
    });
  }
}

function toStatement(row: CommissionRow): EligibilityStatement | null {
  if (row.eligible_at === null) {
    return null;
  }

  return {
    policyNumber: row.statement_policy_number ?? '',
    broker: row.statement_broker ?? '',
    client: row.statement_client ?? '',
    netPremium: Money.fromString(row.statement_net_premium ?? '0'),
    workedCommission: Percentage.fromString(row.statement_worked_commission ?? '0'),
    payoutRate: Percentage.fromString(row.statement_payout_rate ?? '0'),
    ctu: row.statement_ctu === null ? null : Percentage.fromString(row.statement_ctu),
    usinaValue: Money.fromString(row.statement_usina_value ?? '0'),
    retained: Money.fromString(row.statement_retained ?? '0'),
    payout: Money.fromString(row.statement_payout ?? '0'),
    eligibleAt: new Date(row.eligible_at),
    signedBy: row.eligible_by ?? '',
  };
}
