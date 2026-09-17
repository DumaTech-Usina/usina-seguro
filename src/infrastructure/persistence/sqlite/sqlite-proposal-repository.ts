import type { DatabaseSync } from 'node:sqlite';
import type { ProposalRepository } from '../../../core/proposal/application/proposal-repository.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
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
           payment_method_id, customer_accepted, net_premium, registered_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
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
      );
  }

  async findById(id: string): Promise<Proposal | null> {
    const row = this.db.prepare('SELECT * FROM proposal WHERE id = ?').get(id) as
      | ProposalRow
      | undefined;

    if (row === undefined) {
      return null;
    }

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
      row.status as ProposalStatus,
    );
  }
}
