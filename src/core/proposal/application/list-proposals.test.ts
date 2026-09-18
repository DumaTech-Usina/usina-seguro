import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { ListProposals } from './list-proposals.ts';

function proposal(id: string, registeredAt: string): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString('1000.00'),
    registeredAt: new Date(registeredAt),
  });
}

function transmit(record: Proposal, proposalNumber: string): Proposal {
  return record.transmit({
    proposalNumber,
    workedCommission: Percentage.fromString('32.5'),
    transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
  });
}

async function scenario() {
  const proposals = new InMemoryProposalRepository();

  // One of each outcome the flow can reach, registered on different days.
  await proposals.save(proposal('draft-1', '2026-09-15T12:00:00.000Z'));
  await proposals.save(transmit(proposal('open-1', '2026-09-16T12:00:00.000Z'), 'PRP-1'));
  await proposals.save(transmit(proposal('open-2', '2026-09-18T12:00:00.000Z'), 'PRP-2'));
  await proposals.save(
    transmit(proposal('refused-1', '2026-09-17T12:00:00.000Z'), 'PRP-3').reject('perfil de risco'),
  );

  return { proposals, useCase: new ListProposals({ proposals }) };
}

describe('ListProposals', () => {
  it('lists the proposals still open, newest first (REQ-043, OUT-01)', async () => {
    const { useCase } = await scenario();

    const open = await useCase.execute({ status: 'TRANSMITTED' });

    expect(open.map((view) => view.id)).toEqual(['open-2', 'open-1']);
    expect(open[0]?.proposalNumber).toBe('PRP-2');
    // REQ-041: what the operator follows an open proposal by.
    expect(open[0]?.workedCommission).toBe('32.5');
    expect(open[0]?.transmittedAt).toBe('2026-09-18T09:00:00.000Z');
  });

  it('lists the refused ones with their reason (REQ-045, OUT-02)', async () => {
    const { useCase } = await scenario();

    const refused = await useCase.execute({ status: 'REJECTED' });

    expect(refused).toHaveLength(1);
    expect(refused[0]?.id).toBe('refused-1');
    // REQ-046, ITP-004: the record stays consultable after the cycle ends.
    expect(refused[0]?.rejectionReason).toBe('perfil de risco');
  });

  it('lists every proposal when no state is asked for', async () => {
    const { useCase } = await scenario();

    const all = await useCase.execute();

    expect(all.map((view) => view.id)).toEqual(['open-2', 'refused-1', 'open-1', 'draft-1']);
  });

  it('answers an empty listing rather than failing when nothing matches', async () => {
    const { useCase } = await scenario();

    await expect(useCase.execute({ status: 'ACCEPTED' })).resolves.toEqual([]);
  });

  it('exposes the money as the decimal string it is stored as (REQ-120)', async () => {
    const { useCase } = await scenario();

    const [first] = await useCase.execute({ status: 'TRANSMITTED' });

    expect(first?.netPremium).toBe('1000.00');
  });
});
