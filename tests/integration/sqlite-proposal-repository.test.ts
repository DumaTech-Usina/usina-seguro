import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Authorship } from '../../src/core/proposal/domain/authorship.ts';
import { CalendarDate } from '../../src/core/proposal/domain/calendar-date.ts';
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

const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

function proposal(
  id: string,
  registeredAt = '2026-09-22T12:00:00.000Z',
  proposalNumber = `PRP-${id}`,
): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    proposalNumber,
    netPremium: Money.fromString('1500.75'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [
      { amount: Money.fromString('750.38'), dueDate: CalendarDate.fromString('2026-10-10') },
      { amount: Money.fromString('750.37'), dueDate: null },
    ],
    workedCommission: Percentage.fromString('32.5'),
    workedCommissionMode: 'INTEGRAL',
    receipt: {
      kind: 'INTERMEDIARY',
      intermediaryId: 'intermediary-1',
      ctu: Percentage.fromString('50'),
    },
    registeredBy: 'ana.souza',
    registeredAt: new Date(registeredAt),
  });
}

describe('SqliteProposalRepository', () => {
  it('stores and restores every datum informed at registration (REQ-202, REQ-204)', async () => {
    await repository.save(proposal('proposal-1'));

    const read = await repository.findById('proposal-1');

    expect(read?.status).toBe('AWAITING_ISSUANCE');
    expect(read?.clientId).toBe('client-1');
    expect(read?.paymentMethodId).toBe('bank-slip');
    expect(read?.customerAccepted).toBe(true);
    expect(read?.proposalNumber).toBe('PRP-proposal-1');
    expect(read?.netPremium.toString()).toBe('1500.75');
    expect(read?.coverageStart.toString()).toBe('2026-10-01');
    expect(read?.renewalDate.toString()).toBe('2027-10-01');
    expect(read?.registeredAt.toISOString()).toBe('2026-09-22T12:00:00.000Z');
    expect(
      read?.installments.map((installment) => [
        installment.amount.toString(),
        installment.dueDate?.toString() ?? null,
      ]),
    ).toEqual([
      ['750.38', '2026-10-10'],
      ['750.37', null],
    ]);
  });

  it('keeps the percentages with the informed scale (REQ-121)', async () => {
    await repository.save(proposal('proposal-1'));

    const read = await repository.findById('proposal-1');

    expect(read?.workedCommission.toString()).toBe('32.5');
    expect(read?.receipt).toMatchObject({ kind: 'INTERMEDIARY', intermediaryId: 'intermediary-1' });
    expect(read?.receipt.kind === 'INTERMEDIARY' && read.receipt.ctu.toString()).toBe('50');
  });

  it('keeps every signed CT and receipt entry across saves (REQ-215, REQ-223, REQ-124)', async () => {
    const registered = proposal('proposal-1');
    await repository.save(registered);

    const revised = registered
      .reviseWorkedCommission({
        rate: Percentage.fromString('25'),
        mode: 'PARCELLED',
        informed: Authorship.of('bruno.lima', REVISED_AT),
      })
      .reviseReceipt({
        receipt: { kind: 'DIRECT' },
        declared: Authorship.of('bruno.lima', REVISED_AT),
      });
    await repository.save(revised);

    const read = await repository.findById('proposal-1');

    expect(
      read?.workedCommissionHistory.map((entry) => [
        entry.rate.toString(),
        entry.mode,
        entry.informed.author,
        entry.informed.at.toISOString(),
      ]),
    ).toEqual([
      ['32.5', 'INTEGRAL', 'ana.souza', '2026-09-22T12:00:00.000Z'],
      ['25', 'PARCELLED', 'bruno.lima', REVISED_AT.toISOString()],
    ]);
    expect(
      read?.receiptHistory.map((declaration) => [
        declaration.receipt.kind,
        declaration.declared.author,
      ]),
    ).toEqual([
      ['INTERMEDIARY', 'ana.souza'],
      ['DIRECT', 'bruno.lima'],
    ]);
    expect(read?.expectedReceipt().usina.toString()).toBe('375.19');
  });

  it('stores the refusal and its reason (REQ-253)', async () => {
    const registered = proposal('proposal-1');
    await repository.save(registered);
    await repository.save(registered.reject('perfil de risco'));

    const read = await repository.findById('proposal-1');

    expect(read?.status).toBe('REJECTED');
    expect(read?.rejectionReason).toBe('perfil de risco');
  });

  it('answers null for an unknown id', async () => {
    expect(await repository.findById('ghost')).toBeNull();
  });

  it('survives closing and reopening the database file', async () => {
    await repository.save(proposal('proposal-1'));
    db.close();

    db = openSqliteConnection(file);
    repository = new SqliteProposalRepository(db);

    expect((await repository.findById('proposal-1'))?.workedCommission.toString()).toBe('32.5');
  });

  it('accepts two proposals with the same number (DEC-207); the first registered answers', async () => {
    await repository.save(proposal('later', '2026-09-23T12:00:00.000Z', 'PRP-SAME'));
    await repository.save(proposal('earlier', '2026-09-21T12:00:00.000Z', 'PRP-SAME'));

    expect((await repository.findByProposalNumber('PRP-SAME'))?.id).toBe('earlier');
    expect(await repository.findByProposalNumber('PRP-GHOST')).toBeNull();
  });

  it('lists newest first, filtered by state when asked', async () => {
    await repository.save(proposal('a', '2026-09-20T12:00:00.000Z'));
    await repository.save(proposal('b', '2026-09-22T12:00:00.000Z').reject('motivo'));
    await repository.save(proposal('c', '2026-09-21T12:00:00.000Z'));

    expect((await repository.list({})).map((read) => read.id)).toEqual(['b', 'c', 'a']);
    expect((await repository.list({ status: 'AWAITING_ISSUANCE' })).map((read) => read.id)).toEqual(
      ['c', 'a'],
    );
  });
});
