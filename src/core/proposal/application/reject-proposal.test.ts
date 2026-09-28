import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../domain/errors.ts';
import { Money } from '../domain/money.ts';
import { Percentage } from '../domain/percentage.ts';
import { Proposal } from '../domain/proposal.ts';
import { RejectProposal } from './reject-proposal.ts';

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const useCase = new RejectProposal({ proposals });
  return { proposals, useCase };
}

function awaiting(id = 'proposal-1', registeredAt = '2026-09-22T12:00:00.000Z'): Proposal {
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

describe('RejectProposal', () => {
  it('records the refusal with its reason (REQ-253, FA-208)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    const output = await useCase.execute({ proposalId: 'proposal-1', reason: 'perfil de risco' });

    expect(output).toEqual({
      id: 'proposal-1',
      status: 'REJECTED',
      rejectionReason: 'perfil de risco',
    });
  });

  it('keeps the refused proposal consultable (REQ-253, CA-212)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    await useCase.execute({ proposalId: 'proposal-1', reason: 'perfil de risco' });

    const persisted = await proposals.findById('proposal-1');
    expect(persisted?.status).toBe('REJECTED');
    expect(persisted?.rejectionReason).toBe('perfil de risco');
    expect(persisted?.proposalNumber).toBe('PRP-proposal-1');
  });

  it('rejects a refusal without a reason (REJ-208, EX-203)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    await expect(useCase.execute({ proposalId: 'proposal-1', reason: '  ' })).rejects.toThrow(
      BusinessRuleViolation,
    );

    expect((await proposals.findById('proposal-1'))?.status).toBe('AWAITING_ISSUANCE');
  });

  it('does not refuse twice: the refusal is final (REQ-253, REJ-212)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting().reject('perfil de risco'));

    await expect(useCase.execute({ proposalId: 'proposal-1', reason: 'outro' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute({ proposalId: 'ghost', reason: 'motivo' })).rejects.toThrow(
      RecordNotFound,
    );
  });
});
