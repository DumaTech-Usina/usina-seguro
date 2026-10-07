import type { DatabaseSync } from 'node:sqlite';
import type { ParcelledPayoutRepository } from '../../../core/commission/application/parcelled-payout-repository.ts';
import {
  type InstallmentPayoutCalculation,
  type InstallmentStatement,
  ParcelledPayoutCommission,
  type ParcelledPayoutEntry,
} from '../../../core/commission/domain/parcelled-payout.ts';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface PayoutRow {
  id: string;
  policy_id: string;
}

interface EntryRow {
  sequence: number;
  first_rate: string;
  subsequent_rate: string;
  previous_first_rate: string | null;
  previous_subsequent_rate: string | null;
  reason: string | null;
  informed_by: string;
  informed_at: string;
}

interface CalculationRow {
  sequence: number;
  number: number;
  amount: string;
  worked_commission: string;
  usina_value: string;
  payout_rate: string;
  payout: string;
  retained: string;
}

interface StatementRow {
  installment_number: number;
  policy_number: string;
  broker: string;
  insurer: string;
  client: string;
  installment_amount: string;
  worked_commission: string;
  payout_rate: string;
  retained: string;
  payout: string;
  eligible_by: string;
  eligible_at: string;
}

/** Rates are read without the 100% ceiling: a parcelled CT may be above it (REQ-295, REQ-124). */
function rate(text: string): Percentage {
  return Percentage.fromStringWithoutCeiling(text);
}

/**
 * The parcelled payout is four tables: the record, the append-only CR entries
 * with the calculation of each installment (REQ-265), and one statement per
 * eligible installment (REQ-266). Nothing already stored is rewritten.
 */
export class SqliteParcelledPayoutRepository implements ParcelledPayoutRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(commission: ParcelledPayoutCommission): Promise<void> {
    await withSavepoint(this.db, 'parcelled_payout_save', async () => {
      this.db
        .prepare(
          'INSERT INTO parcelled_payout (id, policy_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        )
        .run(commission.id, commission.policyId);

      const entry = this.db.prepare(
        `INSERT INTO parcelled_payout_entry (
           parcelled_payout_id, sequence, first_rate, subsequent_rate,
           previous_first_rate, previous_subsequent_rate, reason, informed_by, informed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      const calculation = this.db.prepare(
        `INSERT INTO parcelled_payout_calculation (
           parcelled_payout_id, sequence, number, amount, worked_commission,
           usina_value, payout_rate, payout, retained
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      commission.entries.forEach((item, index) => {
        const sequence = index + 1;
        entry.run(
          commission.id,
          sequence,
          item.firstRate.toString(),
          item.subsequentRate.toString(),
          item.previousFirstRate?.toString() ?? null,
          item.previousSubsequentRate?.toString() ?? null,
          item.reason,
          item.informed.author,
          item.informed.at.toISOString(),
        );
        for (const installment of item.calculations) {
          calculation.run(
            commission.id,
            sequence,
            installment.number,
            installment.amount.toString(),
            installment.workedCommission.toString(),
            installment.usinaValue.toString(),
            installment.payoutRate.toString(),
            installment.payout.toString(),
            installment.retained.toString(),
          );
        }
      });

      const statement = this.db.prepare(
        `INSERT INTO parcelled_installment_statement (
           parcelled_payout_id, installment_number, policy_number, broker, insurer, client,
           installment_amount, worked_commission, payout_rate, retained, payout,
           eligible_by, eligible_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      for (const item of commission.statements) {
        statement.run(
          commission.id,
          item.installmentNumber,
          item.policyNumber,
          item.broker,
          item.insurer,
          item.client,
          item.installmentAmount.toString(),
          item.workedCommission.toString(),
          item.payoutRate.toString(),
          item.retained.toString(),
          item.payout.toString(),
          item.signedBy,
          item.eligibleAt.toISOString(),
        );
      }
    });
  }

  async findByPolicyId(policyId: string): Promise<ParcelledPayoutCommission | null> {
    const row = this.db
      .prepare('SELECT * FROM parcelled_payout WHERE policy_id = ?')
      .get(policyId) as PayoutRow | undefined;

    return row === undefined ? null : this.restore(row);
  }

  async list(): Promise<readonly ParcelledPayoutCommission[]> {
    const rows = this.db.prepare('SELECT * FROM parcelled_payout').all() as unknown as PayoutRow[];
    return rows.map((row) => this.restore(row));
  }

  private restore(row: PayoutRow): ParcelledPayoutCommission {
    const entries = this.db
      .prepare(
        'SELECT * FROM parcelled_payout_entry WHERE parcelled_payout_id = ? ORDER BY sequence',
      )
      .all(row.id) as unknown as EntryRow[];
    const calculations = this.db
      .prepare(
        `SELECT * FROM parcelled_payout_calculation
         WHERE parcelled_payout_id = ? ORDER BY sequence, number`,
      )
      .all(row.id) as unknown as CalculationRow[];
    // The order in which the installments became eligible.
    const statements = this.db
      .prepare(
        `SELECT * FROM parcelled_installment_statement
         WHERE parcelled_payout_id = ? ORDER BY eligible_at, installment_number`,
      )
      .all(row.id) as unknown as StatementRow[];

    return ParcelledPayoutCommission.restore({
      id: row.id,
      policyId: row.policy_id,
      entries: entries.map(
        (entry): ParcelledPayoutEntry => ({
          firstRate: rate(entry.first_rate),
          subsequentRate: rate(entry.subsequent_rate),
          previousFirstRate:
            entry.previous_first_rate === null ? null : rate(entry.previous_first_rate),
          previousSubsequentRate:
            entry.previous_subsequent_rate === null ? null : rate(entry.previous_subsequent_rate),
          reason: entry.reason,
          informed: Authorship.restore(entry.informed_by, new Date(entry.informed_at)),
          calculations: calculations
            .filter((item) => item.sequence === entry.sequence)
            .map(
              (item): InstallmentPayoutCalculation => ({
                number: item.number,
                amount: Money.fromString(item.amount),
                workedCommission: rate(item.worked_commission),
                usinaValue: Money.fromString(item.usina_value),
                payoutRate: rate(item.payout_rate),
                payout: Money.fromString(item.payout),
                retained: Money.fromString(item.retained),
              }),
            ),
        }),
      ),
      statements: statements.map(
        (item): InstallmentStatement => ({
          policyNumber: item.policy_number,
          broker: item.broker,
          insurer: item.insurer,
          client: item.client,
          installmentNumber: item.installment_number,
          installmentAmount: Money.fromString(item.installment_amount),
          workedCommission: rate(item.worked_commission),
          payoutRate: rate(item.payout_rate),
          retained: Money.fromString(item.retained),
          payout: Money.fromString(item.payout),
          eligibleAt: new Date(item.eligible_at),
          signedBy: item.eligible_by,
        }),
      ),
    });
  }
}
