import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { Authorship } from '../domain/authorship.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { ListProposals } from './list-proposals.ts';

function proposal(id = 'proposal-1', registeredAt = '2026-09-22T12:00:00.000Z'): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
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

  return { proposals, useCase: new ListProposals({ proposals }) };
}

describe('ListProposals', () => {
  it('lists the proposals awaiting issuance, newest first (REQ-250)', async () => {
    const { useCase } = await scenario();

    const open = await useCase.execute({ status: 'AWAITING_ISSUANCE' });

    expect(open.map((view) => view.id)).toEqual(['open-2', 'open-1']);
    expect(open[0]?.proposalNumber).toBe('PRP-open-2');
    expect(open[0]?.expectedReceipt.usina).toBe('20.00');
  });

  it('lists the refused ones with their reason (REQ-253)', async () => {
    const { useCase } = await scenario();

    const refused = await useCase.execute({ status: 'REJECTED' });

    expect(refused.map((view) => view.id)).toEqual(['refused-1']);
    expect(refused[0]?.rejectionReason).toBe('perfil de risco');
  });

  it('lists every proposal when no state is asked for', async () => {
    const { useCase } = await scenario();

    const all = await useCase.execute();

    expect(all.map((view) => view.id)).toEqual(['open-2', 'refused-1', 'open-1', 'issued-1']);
  });

  it('exposes the money as the decimal string it is stored as (REQ-120)', async () => {
    const { useCase } = await scenario();

    const [first] = await useCase.execute({ status: 'AWAITING_ISSUANCE' });

    expect(first?.netPremium).toBe('100.00');
  });
});
