import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Installment } from '../../src/core/policy/domain/installment.ts';
import { Policy } from '../../src/core/policy/domain/policy.ts';
import { CalendarDate } from '../../src/core/proposal/domain/calendar-date.ts';
import { Money } from '../../src/core/proposal/domain/money.ts';
import { Percentage } from '../../src/core/proposal/domain/percentage.ts';
import { Proposal } from '../../src/core/proposal/domain/proposal.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqlitePolicyRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-policy-repository.ts';
import { SqliteProposalRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';
import { SqliteTransaction } from '../../src/infrastructure/persistence/sqlite/sqlite-transaction.ts';

let directory: string;
let file: string;
let db: DatabaseSync;
let proposals: SqliteProposalRepository;
let policies: SqlitePolicyRepository;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-policy-'));
  file = path.join(directory, 'usina.sqlite');
  db = openSqliteConnection(file);
  proposals = new SqliteProposalRepository(db);
  policies = new SqlitePolicyRepository(db);
  await proposals.save(transmittedProposal());
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function transmittedProposal(id = 'proposal-1', proposalNumber = 'PRP-9001'): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    proposalNumber,
    netPremium: Money.fromString('1200.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [],
    workedCommission: Percentage.fromString('32.5'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'operator',
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
  });
}

/**
 * A policy that renews on a given day, for the listing of OUT-03/OUT-04.
 *
 * Each one gets its own proposal because REQ-049 allows a single policy per
 * proposal and the table enforces it.
 */
async function renewingOn(id: string, renewalDate: string): Promise<void> {
  await proposals.save(transmittedProposal(`proposal-${id}`, `PRP-${id}`));

  await policies.save(
    Policy.register({
      id,
      proposalId: `proposal-${id}`,
      policyNumber: `APL-${id}`,
      premium: Money.fromString('1200.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString(renewalDate),
      renewalDate: CalendarDate.fromString(renewalDate),
      registeredAt: new Date('2026-09-20T10:00:00.000Z'),
      installments: [
        Installment.create({
          id: `${id}-installment-1`,
          policyId: id,
          number: 1,
          amount: Money.fromString('1200.00'),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
    }),
  );
}

function policy(id = 'policy-1', proposalId = 'proposal-1', amounts = ['0.10', '0.20']): Policy {
  return Policy.register({
    id,
    proposalId,
    policyNumber: 'APL-4711',
    premium: Money.fromString('1200.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-09-30'),
    renewalDate: CalendarDate.fromString('2027-09-30'),
    registeredAt: new Date('2026-09-20T10:00:00.000Z'),
    installments: amounts.map((amount, index) =>
      Installment.create({
        id: `${id}-installment-${index + 1}`,
        policyId: id,
        number: index + 1,
        amount: Money.fromString(amount),
        dueDate: CalendarDate.fromString(`2026-10-1${index}`),
      }),
    ),
  });
}

describe('SqlitePolicyRepository', () => {
  it('stores and restores the policy with its schedule', async () => {
    await policies.save(policy());

    const read = await policies.findById('policy-1');

    expect(read?.policyNumber).toBe('APL-4711');
    expect(read?.proposalId).toBe('proposal-1');
    expect(read?.status).toBe('ACTIVE');
    expect(read?.premium.toString()).toBe('1200.00');
    expect(read?.coverageStart.toString()).toBe('2026-10-01');
    expect(read?.coverageEnd.toString()).toBe('2027-09-30');
    expect(read?.renewalDate.toString()).toBe('2027-09-30');
    expect(read?.registeredAt.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(read?.installments.map((item) => item.number)).toEqual([1, 2]);
    expect(read?.installments.map((item) => item.status)).toEqual(['PENDING', 'PENDING']);
  });

  it('returns the schedule in order regardless of insertion order', async () => {
    await policies.save(policy('policy-1', 'proposal-1', ['10.00', '20.00', '30.00']));

    const read = await policies.findById('policy-1');

    expect(read?.installments.map((item) => item.amount.toString())).toEqual([
      '10.00',
      '20.00',
      '30.00',
    ]);
  });

  it('returns null for an unknown id', async () => {
    expect(await policies.findById('does-not-exist')).toBeNull();
  });

  it('stores premium and installment amounts as exact text, never as REAL (REQ-120)', async () => {
    await policies.save(policy('policy-1', 'proposal-1', ['0.10', '9007199254740993.99']));

    const types = db
      .prepare('SELECT typeof(amount) AS type, amount FROM installment ORDER BY number')
      .all() as Array<{ type: string; amount: string }>;

    expect(types.map((row) => row.type)).toEqual(['text', 'text']);
    expect(types[1]?.amount).toBe('9007199254740993.99');
    expect(
      (db.prepare('SELECT typeof(premium) AS type FROM policy').get() as { type: string }).type,
    ).toBe('text');
  });

  it('keeps calendar dates as plain days, with no time zone attached', async () => {
    await policies.save(policy());

    const row = db.prepare('SELECT coverage_start, renewal_date FROM policy').get() as {
      coverage_start: string;
      renewal_date: string;
    };

    expect(row.coverage_start).toBe('2026-10-01');
    expect(row.renewal_date).toBe('2027-09-30');
  });

  it('enforces one policy per proposal the way PostgreSQL would (REQ-049)', async () => {
    await policies.save(policy());

    // Raw insert: the domain guard is not in the way, the constraint must be.
    expect(() =>
      db
        .prepare(
          `INSERT INTO policy (id, proposal_id, policy_number, premium,
             coverage_start, coverage_end, renewal_date, registered_at, status)
           VALUES ('policy-2', 'proposal-1', 'APL-9', '1.00',
             '2026-10-01', '2027-09-30', '2027-09-30', '2026-09-20T10:00:00.000Z', 'ACTIVE')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces one policy per policy number the way PostgreSQL would (REQ-082)', async () => {
    await policies.save(policy());

    // Raw insert: the use case refuses it first, the constraint is what holds
    // if anything ever reaches the table around it. REQ-082 makes this number
    // the conciliation key, so it has to identify one policy.
    expect(() =>
      db
        .prepare(
          `INSERT INTO policy (id, proposal_id, policy_number, premium,
             coverage_start, coverage_end, renewal_date, registered_at, status)
           VALUES ('policy-2', 'proposal-2', 'APL-4711', '1.00',
             '2026-10-01', '2027-09-30', '2027-09-30', '2026-09-20T10:00:00.000Z', 'ACTIVE')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('round-trips who confirmed the receipt of an installment and when (REQ-123)', async () => {
    const confirmedAt = new Date('2026-10-11T12:00:00.000Z');
    await policies.save(policy().payInstallment(1, { userId: 'financeiro-1', at: confirmedAt }));

    const stored = await policies.findById('policy-1');
    const first = stored?.installments[0];

    expect(first?.status).toBe('PAID');
    expect(first?.confirmation?.userId).toBe('financeiro-1');
    expect(first?.confirmation?.at.toISOString()).toBe(confirmedAt.toISOString());
    // The installment nobody confirmed carries no confirmation.
    expect(stored?.installments[1]?.confirmation).toBeNull();
  });

  it('refuses an installment pointing at a policy that does not exist', async () => {
    // Foreign keys are off by default in SQLite; the connection turns them on.
    expect(() =>
      db
        .prepare(
          `INSERT INTO installment (id, policy_id, number, amount, due_date, status)
           VALUES ('x', 'ghost-policy', 1, '1.00', '2026-10-10', 'PENDING')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('writes the policy and its schedule atomically', async () => {
    // Restored, not registered: the domain guards are bypassed on purpose so
    // the second installment row breaks the CHECK constraint after the policy
    // row is already written.
    const valid = policy();
    const broken = Policy.restore(
      {
        ...valid,
        installments: [
          valid.installments[0] as Installment,
          Installment.restore(
            {
              id: 'policy-1-installment-2',
              policyId: 'policy-1',
              number: 0,
              amount: Money.fromString('20.00'),
              dueDate: CalendarDate.fromString('2026-11-10'),
            },
            'PENDING',
          ),
        ],
      },
      'ACTIVE',
    );

    await expect(policies.save(broken)).rejects.toThrow(/CHECK constraint failed/);

    expect(db.prepare('SELECT count(*) AS n FROM policy').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM installment').get()).toEqual({ n: 0 });
  });

  it('rolls back both aggregates when a unit of work fails', async () => {
    const transaction = new SqliteTransaction(db);

    await expect(
      transaction.run(async () => {
        await policies.save(policy());
        throw new Error('something failed after the policy was written');
      }),
    ).rejects.toThrow('something failed after the policy was written');

    expect(await policies.findById('policy-1')).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM installment').get()).toEqual({ n: 0 });
  });

  it('lists the policies nearest renewal first, whatever the insertion order (OUT-03)', async () => {
    await renewingOn('policy-mid', '2027-06-30');
    await renewingOn('policy-last', '2027-09-30');
    await renewingOn('policy-first', '2027-01-14');

    const listing = await policies.list({});

    expect(listing.map((item) => item.id)).toEqual(['policy-first', 'policy-mid', 'policy-last']);
    // The listing carries whole policies, schedule included, like every other
    // read of this repository.
    expect(listing[0]?.installments.map((item) => item.number)).toEqual([1]);
  });

  it('cuts the listing at the informed renewal day, inclusive (OUT-04, CA-032)', async () => {
    await renewingOn('policy-mid', '2027-06-30');
    await renewingOn('policy-last', '2027-09-30');
    await renewingOn('policy-first', '2027-01-14');

    const upToMid = await policies.list({ renewalUntil: CalendarDate.fromString('2027-06-30') });
    const beforeMid = await policies.list({
      renewalUntil: CalendarDate.fromString('2027-06-29'),
    });

    expect(upToMid.map((item) => item.id)).toEqual(['policy-first', 'policy-mid']);
    expect(beforeMid.map((item) => item.id)).toEqual(['policy-first']);
  });

  it('answers an empty listing when nothing renews until the informed day', async () => {
    await renewingOn('policy-last', '2027-09-30');

    const listing = await policies.list({ renewalUntil: CalendarDate.fromString('2026-12-31') });

    expect(listing).toEqual([]);
  });

  it('keeps the data after closing and reopening the connection', async () => {
    await policies.save(policy());
    db.close();

    db = openSqliteConnection(file);
    const reread = await new SqlitePolicyRepository(db).findById('policy-1');

    expect(reread?.installments).toHaveLength(2);
  });
});
