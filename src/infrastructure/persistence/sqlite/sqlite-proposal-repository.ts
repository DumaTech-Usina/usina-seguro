import type { DatabaseSync } from 'node:sqlite';
import type {
  ProposalListFilter,
  ProposalRepository,
} from '../../../core/proposal/application/proposal-repository.ts';
import { Authorship } from '../../../core/proposal/domain/authorship.ts';
import { CalendarDate } from '../../../core/proposal/domain/calendar-date.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';
import { Proposal, type ProposalStatus } from '../../../core/proposal/domain/proposal.ts';
import type { Receipt, ReceiptDeclaration } from '../../../core/proposal/domain/receipt.ts';
import type {
  WorkedCommission,
  WorkedCommissionMode,
} from '../../../core/proposal/domain/worked-commission.ts';
import { withSavepoint } from './sqlite-transaction.ts';

interface ProposalRow {
  id: string;
  client_id: string;
  broker_id: string;
  insurer_id: string;
  product_id: string;
  payment_method_id: string;
  customer_accepted: number;
  proposal_number: string;
  net_premium: string;
  coverage_start: string;
  coverage_end: string;
  registered_at: string;
  status: string;
  rejection_reason: string | null;
  issuance_recognized_by: string | null;
  issuance_recognized_at: string | null;
  source_document_id: string | null;
  source_document_file_name: string | null;
}

interface InstallmentRow {
  amount: string;
  due_date: string | null;
}

interface WorkedCommissionRow {
  rate: string;
  mode: string;
  informed_by: string;
  informed_at: string;
}

interface ReceiptRow {
  intermediary_id: string | null;
  ctu: string | null;
  declared_by: string;
  declared_at: string;
}

export class SqliteProposalRepository implements ProposalRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * One proposal is four tables, written together. Only the state and the
   * refusal reason are updated in place; installments are written once
   * (REQ-261) and the CT and receipt histories only gain rows (REQ-124), so
   * an entry already stored is left as it is.
   */
  async save(proposal: Proposal): Promise<void> {
    await withSavepoint(this.db, 'proposal_save', async () => {
      this.db
        .prepare(
          `INSERT INTO proposal (
             id, client_id, broker_id, insurer_id, product_id, payment_method_id,
             customer_accepted, proposal_number, net_premium, coverage_start,
             coverage_end, registered_at, status, rejection_reason,
             issuance_recognized_by, issuance_recognized_at,
             source_document_id, source_document_file_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status                 = excluded.status,
             rejection_reason       = excluded.rejection_reason,
             issuance_recognized_by = excluded.issuance_recognized_by,
             issuance_recognized_at = excluded.issuance_recognized_at`,
        )
        .run(
          proposal.id,
          proposal.clientId,
          proposal.brokerId,
          proposal.insurerId,
          proposal.productId,
          proposal.paymentMethodId,
          proposal.customerAccepted ? 1 : 0,
          proposal.proposalNumber,
          // Exact decimal string; see the column comment in schema.sql.
          proposal.netPremium.toString(),
          proposal.coverageStart.toString(),
          proposal.coverageEnd.toString(),
          proposal.registeredAt.toISOString(),
          proposal.status,
          proposal.rejectionReason,
          proposal.issuanceRecognition?.author ?? null,
          proposal.issuanceRecognition?.at.toISOString() ?? null,
          proposal.sourceDocument?.documentId ?? null,
          proposal.sourceDocument?.fileName ?? null,
        );

      const installment = this.db.prepare(
        `INSERT INTO proposal_installment (proposal_id, number, amount, due_date)
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      proposal.installments.forEach((entry, index) => {
        installment.run(
          proposal.id,
          index + 1,
          entry.amount.toString(),
          entry.dueDate?.toString() ?? null,
        );
      });

      const commission = this.db.prepare(
        `INSERT INTO proposal_worked_commission
           (proposal_id, sequence, rate, mode, informed_by, informed_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      proposal.workedCommissionHistory.forEach((entry, index) => {
        commission.run(
          proposal.id,
          index + 1,
          entry.rate.toString(),
          entry.mode,
          entry.informed.author,
          entry.informed.at.toISOString(),
        );
      });

      const receipt = this.db.prepare(
        `INSERT INTO proposal_receipt_declaration
           (proposal_id, sequence, intermediary_id, ctu, declared_by, declared_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      proposal.receiptHistory.forEach((declaration, index) => {
        const through = declaration.receipt.kind === 'INTERMEDIARY' ? declaration.receipt : null;
        receipt.run(
          proposal.id,
          index + 1,
          through?.intermediaryId ?? null,
          through?.ctu.toString() ?? null,
          declaration.declared.author,
          declaration.declared.at.toISOString(),
        );
      });
    });
  }

  async findById(id: string): Promise<Proposal | null> {
    const row = this.db.prepare('SELECT * FROM proposal WHERE id = ?').get(id) as
      | ProposalRow
      | undefined;

    return row === undefined ? null : this.toProposal(row);
  }

  /** The number is not unique (DEC-207): the first registered answers. */
  async findByProposalNumber(proposalNumber: string): Promise<Proposal | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM proposal WHERE proposal_number = ? ORDER BY registered_at, id LIMIT 1',
      )
      .get(proposalNumber) as ProposalRow | undefined;

    return row === undefined ? null : this.toProposal(row);
  }

  /**
   * `registered_at` is an ISO-8601 UTC string, so ordering it as text orders
   * it chronologically; the id breaks a tie so two proposals registered in the
   * same millisecond keep a stable position between reads.
   */
  async list(filter: ProposalListFilter): Promise<readonly Proposal[]> {
    const rows = (filter.status === undefined
      ? this.db.prepare('SELECT * FROM proposal ORDER BY registered_at DESC, id DESC').all()
      : this.db
          .prepare('SELECT * FROM proposal WHERE status = ? ORDER BY registered_at DESC, id DESC')
          .all(filter.status)) as unknown as ProposalRow[];

    return rows.map((row) => this.toProposal(row));
  }

  private toProposal(row: ProposalRow): Proposal {
    const installments = this.db
      .prepare('SELECT * FROM proposal_installment WHERE proposal_id = ? ORDER BY number')
      .all(row.id) as unknown as InstallmentRow[];

    const commissions = this.db
      .prepare('SELECT * FROM proposal_worked_commission WHERE proposal_id = ? ORDER BY sequence')
      .all(row.id) as unknown as WorkedCommissionRow[];

    const receipts = this.db
      .prepare('SELECT * FROM proposal_receipt_declaration WHERE proposal_id = ? ORDER BY sequence')
      .all(row.id) as unknown as ReceiptRow[];

    return Proposal.restore(
      {
        id: row.id,
        clientId: row.client_id,
        brokerId: row.broker_id,
        insurerId: row.insurer_id,
        productId: row.product_id,
        paymentMethodId: row.payment_method_id,
        customerAccepted: row.customer_accepted === 1,
        proposalNumber: row.proposal_number,
        netPremium: Money.fromString(row.net_premium),
        coverageStart: CalendarDate.fromString(row.coverage_start),
        coverageEnd: CalendarDate.fromString(row.coverage_end),
        installments: installments.map((installment) => ({
          amount: Money.fromString(installment.amount),
          dueDate:
            installment.due_date === null ? null : CalendarDate.fromString(installment.due_date),
        })),
        sourceDocument:
          row.source_document_id === null || row.source_document_file_name === null
            ? null
            : { documentId: row.source_document_id, fileName: row.source_document_file_name },
        registeredAt: new Date(row.registered_at),
      },
      {
        status: row.status as ProposalStatus,
        workedCommissionHistory: commissions.map(toWorkedCommission),
        receiptHistory: receipts.map(toReceiptDeclaration),
        rejectionReason: row.rejection_reason,
        issuanceRecognition:
          row.issuance_recognized_by === null || row.issuance_recognized_at === null
            ? null
            : Authorship.restore(row.issuance_recognized_by, new Date(row.issuance_recognized_at)),
      },
    );
  }
}

function toWorkedCommission(row: WorkedCommissionRow): WorkedCommission {
  return {
    rate: Percentage.fromString(row.rate),
    mode: row.mode as WorkedCommissionMode,
    informed: Authorship.restore(row.informed_by, new Date(row.informed_at)),
  };
}

function toReceiptDeclaration(row: ReceiptRow): ReceiptDeclaration {
  const receipt: Receipt =
    row.intermediary_id === null || row.ctu === null
      ? { kind: 'DIRECT' }
      : {
          kind: 'INTERMEDIARY',
          intermediaryId: row.intermediary_id,
          ctu: Percentage.fromString(row.ctu),
        };

  return {
    receipt,
    declared: Authorship.restore(row.declared_by, new Date(row.declared_at)),
  };
}
