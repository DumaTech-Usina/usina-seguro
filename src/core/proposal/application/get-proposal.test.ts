import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { RecordNotFound } from '../domain/errors.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { GetProposal } from './get-proposal.ts';

function scenario() {
  const proposals = new InMemoryProposalRepository();
  return { proposals, useCase: new GetProposal({ proposals }) };
}

function transmitted(): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString('1200.00'),
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
  }).transmit({
    proposalNumber: 'PRP-9001',
    workedCommission: Percentage.fromString('32.5'),
    transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
  });
}

describe('GetProposal', () => {
  it('returns the proposal an operator is tracking (REQ-043)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    const view = await useCase.execute('proposal-1');

    expect(view).toEqual({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'bank-slip',
      status: 'TRANSMITTED',
      netPremium: '1200.00',
      proposalNumber: 'PRP-9001',
      workedCommission: '32.5',
      registeredAt: '2026-09-17T12:00:00.000Z',
      transmittedAt: '2026-09-18T09:00:00.000Z',
      rejectionReason: null,
    });
  });

  it('keeps a refused proposal consultable with its reason (REQ-045, REQ-046)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted().reject('perfil de risco'));

    const view = await useCase.execute('proposal-1');

    expect(view.status).toBe('REJECTED');
    expect(view.rejectionReason).toBe('perfil de risco');
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
