import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
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

function transmitted(): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString('1000.00'),
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
  }).transmit({
    proposalNumber: 'PRP-9001',
    workedCommission: Percentage.fromString('40'),
    transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
  });
}

describe('RejectProposal', () => {
  it('records the refusal with its reason (REQ-045)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    const output = await useCase.execute({
      proposalId: 'proposal-1',
      reason: 'perfil de risco',
    });

    expect(output).toEqual({
      id: 'proposal-1',
      status: 'REJECTED',
      rejectionReason: 'perfil de risco',
    });
  });

  it('keeps the refused proposal consultable (REQ-046, CA-005, OUT-02)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    await useCase.execute({ proposalId: 'proposal-1', reason: 'perfil de risco' });

    const persisted = await proposals.findById('proposal-1');
    expect(persisted?.status).toBe('REJECTED');
    expect(persisted?.rejectionReason).toBe('perfil de risco');
    expect(persisted?.proposalNumber).toBe('PRP-9001');
  });

  it('rejects a refusal without a reason (CA-004, REJ-003)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    await expect(useCase.execute({ proposalId: 'proposal-1', reason: '  ' })).rejects.toThrow(
      BusinessRuleViolation,
    );

    expect((await proposals.findById('proposal-1'))?.status).toBe('TRANSMITTED');
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute({ proposalId: 'ghost', reason: 'motivo' })).rejects.toThrow(
      RecordNotFound,
    );
  });
});
