import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Money } from '../../src/core/proposal/domain/money.ts';
import { Percentage } from '../../src/core/proposal/domain/percentage.ts';
import { Proposal } from '../../src/core/proposal/domain/proposal.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteProposalRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';

let directory: string;
let file: string;
let db: DatabaseSync;
let repository: SqliteProposalRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-integration-'));
  file = path.join(directory, 'usina.sqlite');
  db = openSqliteConnection(file);
  repository = new SqliteProposalRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function proposal(id: string, premium: string): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString(premium),
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
  });
}

describe('SqliteProposalRepository', () => {
  it('stores and restores the proposal preserving every field', async () => {
    await repository.save(proposal('proposal-1', '1500.75'));

    const read = await repository.findById('proposal-1');

    expect(read).not.toBeNull();
    expect(read?.id).toBe('proposal-1');
    expect(read?.clientId).toBe('client-1');
    expect(read?.paymentMethodId).toBe('bank-slip');
    expect(read?.customerAccepted).toBe(true);
    expect(read?.status).toBe('DRAFT');
    expect(read?.netPremium.toString()).toBe('1500.75');
    expect(read?.registeredAt.toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });

  it('returns null for an unknown id', async () => {
    expect(await repository.findById('does-not-exist')).toBeNull();
  });

  it('stores money as exact text, never as REAL (REQ-120)', async () => {
    // Values that lose precision if they go through binary floating point.
    await repository.save(proposal('proposal-1', '0.10'));
    await repository.save(proposal('proposal-2', '0.20'));
    await repository.save(proposal('proposal-3', '9007199254740993.99'));

    const rows = db
      .prepare('SELECT id, typeof(net_premium) AS type, net_premium FROM proposal')
      .all() as Array<{ id: string; type: string; net_premium: string }>;

    expect(rows.map((row) => row.type)).toEqual(['text', 'text', 'text']);
    expect(rows.find((row) => row.id === 'proposal-3')?.net_premium).toBe('9007199254740993.99');
  });

  it('keeps the data after closing and reopening the connection', async () => {
    await repository.save(proposal('proposal-1', '250.00'));
    db.close();

    db = openSqliteConnection(file);
    const reread = await new SqliteProposalRepository(db).findById('proposal-1');

    expect(reread?.netPremium.toString()).toBe('250.00');
  });

  it('round-trips what the transmission recorded (REQ-041)', async () => {
    await repository.save(
      proposal('proposal-1', '1500.75').transmit({
        proposalNumber: 'PRP-9001',
        workedCommission: Percentage.fromString('32.5'),
        transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
      }),
    );

    const read = await repository.findById('proposal-1');

    expect(read?.status).toBe('TRANSMITTED');
    expect(read?.proposalNumber).toBe('PRP-9001');
    expect(read?.workedCommission?.toString()).toBe('32.5');
    expect(read?.transmittedAt?.toISOString()).toBe('2026-09-18T09:00:00.000Z');
  });

  it('stores the commission percentage as exact text, keeping its scale (REQ-121)', async () => {
    await repository.save(
      proposal('proposal-1', '1500.75').transmit({
        proposalNumber: 'PRP-9001',
        workedCommission: Percentage.fromString('32.500000'),
        transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
      }),
    );

    const row = db
      .prepare('SELECT typeof(worked_commission) AS type, worked_commission AS value FROM proposal')
      .get() as { type: string; value: string };

    expect(row.type).toBe('text');
    expect(row.value).toBe('32.500000');
  });

  it('overwrites the outcome of a proposal already stored (REQ-045)', async () => {
    const transmitted = proposal('proposal-1', '1500.75').transmit({
      proposalNumber: 'PRP-9001',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
    });
    await repository.save(transmitted);
    await repository.save(transmitted.reject('perfil de risco'));

    const read = await repository.findById('proposal-1');

    expect(read?.status).toBe('REJECTED');
    expect(read?.rejectionReason).toBe('perfil de risco');
    expect(read?.proposalNumber).toBe('PRP-9001');
  });

  it('leaves the insurer-issued columns empty until the transmission', async () => {
    await repository.save(proposal('proposal-1', '1500.75'));

    const row = db
      .prepare('SELECT proposal_number, worked_commission, transmitted_at FROM proposal')
      .get() as Record<string, unknown>;

    expect(row).toEqual({ proposal_number: null, worked_commission: null, transmitted_at: null });
  });

  it('enforces the PRIMARY KEY the way PostgreSQL would', async () => {
    await repository.save(proposal('proposal-1', '100.00'));

    // Raw insert, without the repository's ON CONFLICT: the constraint must exist.
    expect(() =>
      db
        .prepare(
          `INSERT INTO proposal (id, client_id, broker_id, insurer_id, product_id,
             payment_method_id, customer_accepted, net_premium, registered_at, status)
           VALUES ('proposal-1', 'x', 'x', 'x', 'x', 'x', 1, '1.00', '2026-01-01T00:00:00.000Z', 'DRAFT')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
