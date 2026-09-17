import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation } from '../domain/errors.ts';
import { RegisterProposal, type RegisterProposalInput } from './register-proposal.ts';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const useCase = new RegisterProposal({
    proposals,
    newId: () => 'fixed-id',
    now: () => NOW,
  });
  return { proposals, useCase };
}

function input(overrides: Partial<RegisterProposalInput> = {}): RegisterProposalInput {
  return {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: '1500.75',
    ...overrides,
  };
}

describe('RegisterProposal', () => {
  it('persists the registered proposal and returns the registration data', async () => {
    const { proposals, useCase } = scenario();

    const output = await useCase.execute(input());

    expect(output).toEqual({
      id: 'fixed-id',
      status: 'DRAFT',
      netPremium: '1500.75',
      registeredAt: NOW.toISOString(),
    });

    const persisted = await proposals.findById('fixed-id');
    expect(persisted?.netPremium.toString()).toBe('1500.75');
  });

  it('persists nothing when the domain rejects the registration (CA-001)', async () => {
    const { proposals, useCase } = scenario();

    await expect(useCase.execute(input({ customerAccepted: false }))).rejects.toThrow(
      BusinessRuleViolation,
    );

    expect(await proposals.findById('fixed-id')).toBeNull();
  });

  it('rejects a net premium that is not a valid decimal (REQ-120)', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute(input({ netPremium: '1500,75' }))).rejects.toThrow(
      BusinessRuleViolation,
    );
  });
});
