import type { DatabaseSync } from 'node:sqlite';
import type { ProposalRepository } from '../../../core/proposal/application/proposal-repository.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';
import { Proposal, type ProposalStatus } from '../../../core/proposal/domain/proposal.ts';

interface ProposalRow {
  id: string;
  client_id: string;
  broker_id: string;
  insurer_id: string;
  product_id: string;
  payment_method_id: string;
  customer_accepted: number;
  net_premium: string;
  registered_at: string;
  status: string;
  proposal_number: string | null;
  worked_commission: string | null;
  transmitted_at: string | null;
  rejection_reason: string | null;
}

export class SqliteProposalRepository implements ProposalRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(proposal: Proposal): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO proposal (
           id, client_id, broker_id, insurer_id, product_id,
           payment_method_id, customer_accepted, net_premium, registered_at, status,
           proposal_number, worked_commission, transmitted_at, rejection_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status            = excluded.status,
           proposal_number   = excluded.proposal_number,
           worked_commission = excluded.worked_commission,
           transmitted_at    = excluded.transmitted_at,
           rejection_reason  = excluded.rejection_reason`,
      )
      .run(
        proposal.id,
        proposal.clientId,
        proposal.brokerId,
        proposal.insurerId,
        proposal.productId,
        proposal.paymentMethodId,
        proposal.customerAccepted ? 1 : 0,
        // Exact decimal string; see the column comment in schema.sql.
        proposal.netPremium.toString(),
        proposal.registeredAt.toISOString(),
        proposal.status,
        proposal.proposalNumber,
        proposal.workedCommission?.toString() ?? null,
        proposal.transmittedAt?.toISOString() ?? null,
        proposal.rejectionReason,
      );
  }

  async findById(id: string): Promise<Proposal | null> {
    const row = this.db.prepare('SELECT * FROM proposal WHERE id = ?').get(id) as
      | ProposalRow
      | undefined;

    return row === undefined ? null : toProposal(row);
  }

  /** REQ-082: the report identifies the business by the insurer's number. */
  async findByProposalNumber(proposalNumber: string): Promise<Proposal | null> {
    const row = this.db
      .prepare('SELECT * FROM proposal WHERE proposal_number = ?')
      .get(proposalNumber) as ProposalRow | undefined;

    return row === undefined ? null : toProposal(row);
  }
}

function toProposal(row: ProposalRow): Proposal {
  return Proposal.restore(
    {
      id: row.id,
      clientId: row.client_id,
      brokerId: row.broker_id,
      insurerId: row.insurer_id,
      productId: row.product_id,
      paymentMethodId: row.payment_method_id,
      customerAccepted: row.customer_accepted === 1,
      netPremium: Money.fromString(row.net_premium),
      registeredAt: new Date(row.registered_at),
    },
    {
      status: row.status as ProposalStatus,
      proposalNumber: row.proposal_number,
      workedCommission:
        row.worked_commission === null ? null : Percentage.fromString(row.worked_commission),
      transmittedAt: row.transmitted_at === null ? null : new Date(row.transmitted_at),
      rejectionReason: row.rejection_reason,
    },
  );
}
