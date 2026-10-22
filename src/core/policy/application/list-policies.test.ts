import { describe, expect, it } from 'vitest';
import { InMemoryClientRepository } from '../../../infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { InMemoryListings } from '../../../infrastructure/persistence/in-memory/in-memory-listings.ts';
import { InMemoryPayoutCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-payout-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Client } from '../../registry/domain/client.ts';
import { Reference } from '../../registry/domain/reference.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import { ListPolicies } from './list-policies.ts';

interface BusinessOptions {
  readonly suffix: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /** REQ-020, REQ-055: the day the renewal is controlled against. */
  readonly renewalDate: string;
  readonly premium: string;
}

async function business(
  repositories: {
    proposals: InMemoryProposalRepository;
    policies: InMemoryPolicyRepository;
  },
  options: BusinessOptions,
): Promise<void> {
  const { suffix, coverageStart, coverageEnd, renewalDate, premium } = options;

  await repositories.proposals.save(
    Proposal.register({
      id: `proposal-${suffix}`,
      clientId: `client-${suffix}`,
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      proposalNumber: `PRP-${suffix}`,
      netPremium: Money.fromString(premium),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [],
      workedCommission: Percentage.fromString('40'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }),
  );

  await repositories.policies.save(
    Policy.register({
      id: `policy-${suffix}`,
      proposalId: `proposal-${suffix}`,
      policyNumber: `APL-${suffix}`,
      premium: Money.fromString(premium),
      coverageStart: CalendarDate.fromString(coverageStart),
      coverageEnd: CalendarDate.fromString(coverageEnd),
      renewalDate: CalendarDate.fromString(renewalDate),
      installments: [
        Installment.create({
          id: `installment-${suffix}`,
          policyId: `policy-${suffix}`,
          number: 1,
          amount: Money.fromString(premium),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
      registeredAt: new Date('2026-09-20T10:00:00.000Z'),
    }),
  );
}

/**
 * Three policies renewing on three different days, saved in an order that is
 * not the order they renew in: an answer that came out sorted by accident of
 * insertion would pass a listing that never sorted anything.
 */
async function scenario() {
  const repositories = {
    proposals: new InMemoryProposalRepository(),
    policies: new InMemoryPolicyRepository(),
    // IN-01 is empty unless a test registers a name: an unregistered
    // reference is the ordinary case until somebody maintains the registry.
    references: new InMemoryReferenceRepository(),
    // V2 section 9E: empty unless a test registers a client. A proposal whose
    // client is no registered client holds a typed text (REQ-320).
    clients: new InMemoryClientRepository(),
  };

  await business(repositories, {
    suffix: 'MID',
    coverageStart: '2026-07-01',
    coverageEnd: '2027-06-30',
    renewalDate: '2027-06-30',
    premium: '2400.00',
  });
  await business(repositories, {
    suffix: 'LAST',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    premium: '1200.00',
  });
  await business(repositories, {
    suffix: 'FIRST',
    coverageStart: '2026-01-15',
    coverageEnd: '2027-01-14',
    renewalDate: '2027-01-14',
    premium: '600.00',
  });

  return { ...repositories, useCase: listPolicies(repositories) };
}

/** The use case over the in-memory drivers, the listing included (REQ-330). */
function listPolicies(repositories: {
  proposals: InMemoryProposalRepository;
  policies: InMemoryPolicyRepository;
  references: InMemoryReferenceRepository;
  clients: InMemoryClientRepository;
}): ListPolicies {
  return new ListPolicies({
    ...repositories,
    listing: new InMemoryListings({
      ...repositories,
      payouts: new InMemoryPayoutCommissionRepository(),
    }),
  });
}

describe('ListPolicies', () => {
  it('lists the policies sold, nearest renewal first (OUT-03, REQ-055)', async () => {
    const { useCase } = await scenario();

    const listing = await useCase.execute();

    expect(listing.items.map((line) => line.policyNumber)).toEqual([
      'APL-FIRST',
      'APL-MID',
      'APL-LAST',
    ]);

    // REQ-020: the coverage period, the premium and the state, which is what
    // OUT-03 asks a control of policies to show.
    const [first] = listing.items;
    expect(first?.coverageStart).toBe('2026-01-15');
    expect(first?.coverageEnd).toBe('2027-01-14');
    expect(first?.renewalDate).toBe('2027-01-14');
    expect(first?.premium).toBe('600.00');
    expect(first?.status).toBe('ACTIVE');
  });

  it('narrows to the policies about to renew (OUT-04, CA-032)', async () => {
    const { useCase } = await scenario();

    const expiring = await useCase.execute({ renewalUntil: '2027-06-30' });

    // The day informed is inside the window, not one day short.
    expect(expiring.items.map((line) => line.policyNumber)).toEqual(['APL-FIRST', 'APL-MID']);
  });

  it('leaves out what renews after the informed day', async () => {
    const { useCase } = await scenario();

    const expiring = await useCase.execute({ renewalUntil: '2027-06-29' });

    expect(expiring.items.map((line) => line.policyNumber)).toEqual(['APL-FIRST']);
  });

  it('identifies each line by the records that hold a readable reference', async () => {
    const { useCase } = await scenario();

    const {
      items: [line],
    } = await useCase.execute({ renewalUntil: '2027-01-14' });

    // REQ-050: both numbers; REQ-022: who the business is for. The registries
    // of IN-01 are not modelled, so the references travel as stored.
    expect(line?.policyNumber).toBe('APL-FIRST');
    expect(line?.proposalNumber).toBe('PRP-FIRST');
    expect(line?.clientId).toBe('client-FIRST');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.productId).toBe('auto');
    // The line has to be able to hand the operator over to the policy itself.
    expect(line?.id).toBe('policy-FIRST');
    expect(line?.proposalId).toBe('proposal-FIRST');
  });

  it('answers an empty listing rather than failing when nothing renews until then', async () => {
    const { useCase } = await scenario();

    await expect(useCase.execute({ renewalUntil: '2026-12-31' })).resolves.toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('refuses a malformed day instead of reading it as no window at all', async () => {
    const { useCase } = await scenario();

    // Answering the whole listing to a question that was not understood would
    // show policies that renew long after what was asked for (REQ-020).
    await expect(useCase.execute({ renewalUntil: '30/06/2027' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
    await expect(useCase.execute({ renewalUntil: '2027-02-31' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
  });

  it('refuses to answer a policy whose proposal is gone', async () => {
    const { policies } = await scenario();

    const useCase = listPolicies({
      policies,
      proposals: new InMemoryProposalRepository(),
      references: new InMemoryReferenceRepository(),
      clients: new InMemoryClientRepository(),
    });

    await expect(useCase.execute()).rejects.toBeInstanceOf(RecordNotFound);
  });

  it('identifies each line by the name IN-01 registered, and the client by its registry (REQ-096, REQ-318)', async () => {
    const { references, clients, useCase } = await scenario();

    await clients.save(anaLima());
    await references.save(
      Reference.register({
        kind: 'INSURER',
        id: 'insurer-1',
        name: 'Seguradora Norte',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );
    await references.save(
      Reference.register({
        kind: 'PRODUCT',
        id: 'auto',
        name: 'Automovel',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );

    const listing = await useCase.execute();
    const mid = listing.items.find((line) => line.policyNumber === 'APL-MID');

    expect(mid?.clientName).toBe('Ana Lima');
    expect(mid?.insurerName).toBe('Seguradora Norte');
    // REQ-022 names the field "produto/ramo": the product's name is the ramo.
    expect(mid?.productName).toBe('Automovel');
    // The identifier travels beside the name: it is what every other record
    // is matched on, and the name never replaces it.
    expect(mid?.clientId).toBe('client-MID');
  });

  it('shows the text of a client that is no registered client, and lists it anyway (REQ-320)', async () => {
    const { clients, useCase } = await scenario();

    await clients.save(anaLima());

    const listing = await useCase.execute();
    const last = listing.items.find((line) => line.policyNumber === 'APL-LAST');

    // A proposal registered before the client registry keeps its text, shown
    // as it is; it is never a business to hide or refuse.
    expect(last?.clientName).toBe('client-LAST');
    expect(last?.clientId).toBe('client-LAST');
    expect(last?.insurerName).toBeNull();
    expect(listing.items).toHaveLength(3);
  });
});

describe('ListPolicies by client (REQ-319, REQ-320)', () => {
  it('finds the policies of the clients whose name or CPF matches (CA-316)', async () => {
    const { clients, useCase } = await scenario();
    await clients.save(anaLima());

    const numbers = async (client: string) =>
      (await useCase.execute({ client })).items.map((line) => line.policyNumber);

    expect(await numbers('lima')).toEqual(['APL-MID']);
    expect(await numbers('529.982.247-25')).toEqual(['APL-MID']);
    expect(await numbers('52998')).toEqual(['APL-MID']);
    expect(await numbers('carlos')).toEqual([]);
  });

  it('does not find a policy by the text its proposal held before the registry (REQ-320)', async () => {
    const { useCase } = await scenario();

    expect((await useCase.execute({ client: 'client-LAST' })).items).toEqual([]);
  });

  it('combines with the renewal filter, and a blank term is no filter', async () => {
    const { clients, useCase } = await scenario();
    await clients.save(anaLima());

    expect((await useCase.execute({ client: 'lima', renewalUntil: '2027-01-31' })).items).toEqual(
      [],
    );
    expect(
      (await useCase.execute({ client: 'lima', renewalUntil: '2027-06-30' })).items.map(
        (line) => line.policyNumber,
      ),
    ).toEqual(['APL-MID']);
    expect((await useCase.execute({ client: '  ' })).total).toBe(3);
  });
});

describe('ListPolicies in pages (REQ-330 to REQ-333)', () => {
  async function many(count: number) {
    const repositories = {
      proposals: new InMemoryProposalRepository(),
      policies: new InMemoryPolicyRepository(),
      references: new InMemoryReferenceRepository(),
      clients: new InMemoryClientRepository(),
    };
    for (let day = 1; day <= count; day++) {
      const renewal = new Date(Date.UTC(2027, 0, day)).toISOString().slice(0, 10);
      await business(repositories, {
        suffix: String(day).padStart(3, '0'),
        coverageStart: '2026-01-01',
        coverageEnd: renewal,
        renewalDate: renewal,
        premium: '100.00',
      });
    }
    return { ...repositories, useCase: listPolicies(repositories) };
  }

  it('cuts the nearest renewals first, and the next page goes on from there (CA-330)', async () => {
    const { useCase } = await many(30);

    const first = await useCase.execute({ size: 25 });
    const second = await useCase.execute({ page: 2, size: 25 });

    expect(first).toMatchObject({ total: 30, number: 1, size: 25 });
    expect(first.items[0]?.policyNumber).toBe('APL-001');
    expect(second.items.map((line) => line.policyNumber)).toEqual([
      'APL-026',
      'APL-027',
      'APL-028',
      'APL-029',
      'APL-030',
    ]);
  });

  it('finds by client a policy of the last page, with the total of the matches (CA-332)', async () => {
    const { clients, useCase } = await many(30);
    await clients.save(
      Client.register({
        id: 'client-030',
        name: 'Ana Lima',
        cpf: '52998224725',
        signed: Authorship.of('operator', new Date('2026-09-20T12:00:00.000Z')),
      }),
    );

    const found = await useCase.execute({ client: 'lima', size: 25 });

    expect(found.total).toBe(1);
    expect(found.items.map((line) => line.policyNumber)).toEqual(['APL-030']);
  });
});

/** The client of the proposal MID, registered (V2 section 9E). */
function anaLima(): Client {
  return Client.register({
    id: 'client-MID',
    name: 'Ana Lima',
    cpf: '52998224725',
    signed: Authorship.of('operator', new Date('2026-09-20T12:00:00.000Z')),
  });
}
