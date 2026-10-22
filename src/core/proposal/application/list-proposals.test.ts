import { describe, expect, it } from 'vitest';
import { InMemoryListings } from '../../../infrastructure/persistence/in-memory/in-memory-listings.ts';
import { InMemoryPayoutCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-payout-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { Authorship } from '../domain/authorship.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { ListProposals } from './list-proposals.ts';

function proposal(
  id = 'proposal-1',
  registeredAt = '2026-09-22T12:00:00.000Z',
  clientId = 'client-1',
): Proposal {
  return Proposal.register({
    id,
    clientId,
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    proposalNumber: `PRP-${id}`,
    netPremium: Money.fromString('100.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [],
    workedCommission: Percentage.fromString('20'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'ana.souza',
    registeredAt: new Date(registeredAt),
  });
}

async function scenario() {
  const proposals = new InMemoryProposalRepository();

  // One of each state the flow can reach, registered on different days.
  await proposals.save(proposal('open-1', '2026-09-16T12:00:00.000Z'));
  await proposals.save(proposal('open-2', '2026-09-18T12:00:00.000Z'));
  await proposals.save(proposal('refused-1', '2026-09-17T12:00:00.000Z').reject('perfil de risco'));
  await proposals.save(
    proposal('issued-1', '2026-09-15T12:00:00.000Z').recognizeIssuance(
      Authorship.of('operator', new Date('2026-09-20T10:00:00.000Z')),
    ),
  );

  return { proposals, useCase: listProposals(proposals, registry()) };
}

/** The use case over the in-memory drivers, the client registry included (REQ-319). */
function listProposals(proposals: InMemoryProposalRepository, clients: Clients) {
  return new ListProposals({
    proposals,
    listing: new InMemoryListings({
      proposals,
      policies: new InMemoryPolicyRepository(),
      clients,
      payouts: new InMemoryPayoutCommissionRepository(),
    }),
    clients: {
      resolve: async () => {
        throw new Error('not used');
      },
      nameOf: async (id: string) => (await clients.findById(id))?.name ?? id,
    },
  });
}

/**
 * The client registry as the listing reads it: the proposal module never
 * builds a client (it imports no other module), so the registry is a stand-in
 * holding the name and the CPF digits each client has (REQ-316).
 */
type Clients = ConstructorParameters<typeof InMemoryListings>[0]['clients'];

function registry(...clients: { id: string; name: string; cpf: string }[]): Clients {
  const records = clients.map((client) => ({ ...client, cpf: { digits: client.cpf } }));
  return {
    list: async () => records,
    findById: async (id: string) => records.find((client) => client.id === id) ?? null,
  } as unknown as Clients;
}

const ids = (page: { items: readonly { id: string }[] }) => page.items.map((view) => view.id);

describe('ListProposals', () => {
  it('lists the proposals awaiting issuance, newest first (REQ-250)', async () => {
    const { useCase } = await scenario();

    const open = await useCase.execute({ status: 'AWAITING_ISSUANCE' });

    expect(ids(open)).toEqual(['open-2', 'open-1']);
    expect(open.items[0]?.proposalNumber).toBe('PRP-open-2');
    expect(open.items[0]?.expectedReceipt?.usina).toBe('20.00');
  });

  it('lists the refused ones with their reason (REQ-253)', async () => {
    const { useCase } = await scenario();

    const refused = await useCase.execute({ status: 'REJECTED' });

    expect(ids(refused)).toEqual(['refused-1']);
    expect(refused.items[0]?.rejectionReason).toBe('perfil de risco');
  });

  it('lists every proposal when no state is asked for', async () => {
    const { useCase } = await scenario();

    const all = await useCase.execute();

    expect(ids(all)).toEqual(['open-2', 'refused-1', 'open-1', 'issued-1']);
    expect(all).toMatchObject({ total: 4, number: 1, size: 50 });
  });

  it('exposes the money as the decimal string it is stored as (REQ-120)', async () => {
    const { useCase } = await scenario();

    const {
      items: [first],
    } = await useCase.execute({ status: 'AWAITING_ISSUANCE' });

    expect(first?.netPremium).toBe('100.00');
  });
});

describe('ListProposals by client (REQ-319, REQ-320)', () => {
  async function byClient() {
    const proposals = new InMemoryProposalRepository();
    await proposals.save(proposal('maria-1', '2026-09-16T12:00:00.000Z', 'client-maria'));
    await proposals.save(proposal('bruno-1', '2026-09-17T12:00:00.000Z', 'client-bruno'));
    await proposals.save(
      proposal('maria-2', '2026-09-18T12:00:00.000Z', 'client-maria').reject('perfil'),
    );
    // Registered before the client registry: the typed text, no client (REQ-320).
    await proposals.save(proposal('legacy-1', '2026-09-19T12:00:00.000Z', 'Maria Antiga'));

    return listProposals(
      proposals,
      registry(
        { id: 'client-maria', name: 'Maria Souza', cpf: '52998224725' },
        { id: 'client-bruno', name: 'Bruno Lima', cpf: '11144477735' },
      ),
    );
  }

  it('keeps only the proposals of the clients the term matches, by name or CPF (CA-316)', async () => {
    const useCase = await byClient();

    const found = async (client: string) => ids(await useCase.execute({ client }));

    expect(await found('maria')).toEqual(['maria-2', 'maria-1']);
    expect(await found('529.982')).toEqual(['maria-2', 'maria-1']);
    expect(await found('carlos')).toEqual([]);
  });

  it('does not find a proposal by the text it held before the registry (REQ-320)', async () => {
    const useCase = await byClient();

    expect(ids(await useCase.execute({ client: 'maria' }))).not.toContain('legacy-1');
  });

  it('combines with the state filter, and a blank term is no filter', async () => {
    const useCase = await byClient();

    expect(ids(await useCase.execute({ status: 'AWAITING_ISSUANCE', client: 'maria' }))).toEqual([
      'maria-1',
    ]);
    expect((await useCase.execute({ client: '  ' })).total).toBe(4);
  });

  it('shows the name of the client on each line, and the typed text of an older one (REQ-318, REQ-320)', async () => {
    const useCase = await byClient();

    const lines = (await useCase.execute()).items.map((view) => [view.id, view.clientName]);

    expect(lines).toContainEqual(['maria-1', 'Maria Souza']);
    expect(lines).toContainEqual(['legacy-1', 'Maria Antiga']);
  });
});

describe('ListProposals in pages (REQ-330 to REQ-333)', () => {
  async function many(count: number) {
    const proposals = new InMemoryProposalRepository();
    const clients = registry({ id: 'client-maria', name: 'Maria Souza', cpf: '52998224725' });
    for (let day = 1; day <= count; day++) {
      const at = new Date(Date.UTC(2026, 0, day, 12)).toISOString();
      // The oldest one is Maria's: it lands on the last page, newest first.
      await proposals.save(proposal(`p-${day}`, at, day === 1 ? 'client-maria' : 'client-x'));
    }
    return listProposals(proposals, clients);
  }

  it('answers the first 50 with the total, and the next page goes on in the same order (CA-330, CA-331)', async () => {
    const useCase = await many(60);

    const first = await useCase.execute();
    const second = await useCase.execute({ page: 2 });

    expect(first).toMatchObject({ total: 60, number: 1, size: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.id).toBe('p-60');
    expect(ids(second)).toEqual([
      'p-10',
      'p-9',
      'p-8',
      'p-7',
      'p-6',
      'p-5',
      'p-4',
      'p-3',
      'p-2',
      'p-1',
    ]);
  });

  it('holds 25 or 100 when asked, and a page past the last is empty with the total (CA-331)', async () => {
    const useCase = await many(60);

    expect((await useCase.execute({ size: 25 })).items).toHaveLength(25);
    expect((await useCase.execute({ size: 100 })).items).toHaveLength(60);
    expect(await useCase.execute({ page: 4, size: 25 })).toMatchObject({ items: [], total: 60 });
  });

  it('filters all the proposals before cutting the page (CA-332)', async () => {
    const useCase = await many(60);

    expect(await useCase.execute({ client: 'maria' })).toMatchObject({ total: 1 });
    expect(ids(await useCase.execute({ client: 'maria' }))).toEqual(['p-1']);
  });
});
