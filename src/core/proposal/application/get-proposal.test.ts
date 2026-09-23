import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { Authorship } from '../domain/authorship.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { RecordNotFound } from '../domain/errors.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { GetProposal } from './get-proposal.ts';

function scenario() {
  const proposals = new InMemoryProposalRepository();
  return { proposals, useCase: new GetProposal({ proposals }) };
}

function awaiting(id = 'proposal-1', registeredAt = '2026-09-22T12:00:00.000Z'): Proposal {
  return Proposal.register({
    id,
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
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

describe('GetProposal', () => {
  it('returns the proposal with what the Usina expects to receive (REQ-232, CA-203)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    const view = await useCase.execute('proposal-1');

    expect(view.status).toBe('AWAITING_ISSUANCE');
    expect(view.proposalNumber).toBe('PRP-proposal-1');
    expect(view.expectedReceipt).toEqual({ intermediary: null, usina: '20.00' });
  });

  it('keeps a refused proposal consultable with its reason (REQ-253, CA-212)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting().reject('perfil de risco'));

    const view = await useCase.execute('proposal-1');

    expect(view.status).toBe('REJECTED');
    expect(view.rejectionReason).toBe('perfil de risco');
  });

  it('shows who recognised the issuance and when (REQ-209, CA-207)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(
      awaiting().recognizeIssuance(
        Authorship.of('carla.dias', new Date('2026-09-25T14:05:00.000Z')),
      ),
    );

    const view = await useCase.execute('proposal-1');

    expect(view.status).toBe('ISSUED');
    expect(view.issuanceRecognizedBy).toBe('carla.dias');
    expect(view.issuanceRecognizedAt).toBe('2026-09-25T14:05:00.000Z');
  });

  it('shows no recognition while awaiting issuance', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    const view = await useCase.execute('proposal-1');

    expect(view.issuanceRecognizedBy).toBeNull();
    expect(view.issuanceRecognizedAt).toBeNull();
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
