import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../domain/errors.ts';
import { Money } from '../domain/money.ts';
import { Proposal } from '../domain/proposal.ts';
import { TransmitProposal } from './transmit-proposal.ts';

const NOW = new Date('2026-09-18T09:00:00.000Z');

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const useCase = new TransmitProposal({ proposals, now: () => NOW });
  return { proposals, useCase };
}

function draft(): Proposal {
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
  });
}

describe('TransmitProposal', () => {
  it('records the transmission and persists it (REQ-041)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(draft());

    const output = await useCase.execute({
      proposalId: 'proposal-1',
      proposalNumber: 'PRP-9001',
      workedCommission: '32.5',
    });

    expect(output).toEqual({
      id: 'proposal-1',
      status: 'TRANSMITTED',
      proposalNumber: 'PRP-9001',
      workedCommission: '32.5',
      transmittedAt: NOW.toISOString(),
    });

    const persisted = await proposals.findById('proposal-1');
    expect(persisted?.status).toBe('TRANSMITTED');
    expect(persisted?.workedCommission?.toString()).toBe('32.5');
  });

  it('reports an unknown proposal as not found, not as a rule violation', async () => {
    const { useCase } = scenario();

    await expect(
      useCase.execute({ proposalId: 'ghost', proposalNumber: 'PRP-1', workedCommission: '10' }),
    ).rejects.toThrow(RecordNotFound);
  });

  it('rejects a worked commission that is not a decimal (REQ-121)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(draft());

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        proposalNumber: 'PRP-9001',
        workedCommission: '32,5',
      }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('persists nothing when the domain rejects the transition', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(draft());

    await useCase.execute({
      proposalId: 'proposal-1',
      proposalNumber: 'PRP-9001',
      workedCommission: '40',
    });

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        proposalNumber: 'PRP-9002',
        workedCommission: '50',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    const persisted = await proposals.findById('proposal-1');
    expect(persisted?.proposalNumber).toBe('PRP-9001');
    expect(persisted?.workedCommission?.toString()).toBe('40');
  });
});
