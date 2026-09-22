import { describe, expect, it } from 'vitest';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation } from '../domain/errors.ts';
import { RegisterProposal, type RegisterProposalInput } from './register-proposal.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');

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
    proposalNumber: 'PRP-9001',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [
      { amount: '50.00', dueDate: '2026-10-10' },
      { amount: '50.00', dueDate: null },
    ],
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'ana.souza',
    ...overrides,
  };
}

describe('RegisterProposal', () => {
  it('persists the proposal awaiting issuance and answers what it holds (FP-01 steps 1-6)', async () => {
    const { proposals, useCase } = scenario();

    const view = await useCase.execute(input());

    expect(view).toEqual({
      id: 'fixed-id',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      status: 'AWAITING_ISSUANCE',
      proposalNumber: 'PRP-9001',
      netPremium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      renewalDate: '2027-10-01',
      installments: [
        { number: 1, amount: '50.00', dueDate: '2026-10-10' },
        { number: 2, amount: '50.00', dueDate: null },
      ],
      workedCommission: '20',
      workedCommissionMode: 'INTEGRAL',
      intermediaryId: null,
      ctu: null,
      expectedReceipt: { intermediary: null, usina: '20.00' },
      workedCommissionHistory: [
        {
          workedCommission: '20',
          workedCommissionMode: 'INTEGRAL',
          informedBy: 'ana.souza',
          informedAt: NOW.toISOString(),
        },
      ],
      receiptHistory: [
        { intermediaryId: null, ctu: null, declaredBy: 'ana.souza', declaredAt: NOW.toISOString() },
      ],
      registeredAt: NOW.toISOString(),
      rejectionReason: null,
    });

    expect((await proposals.findById('fixed-id'))?.status).toBe('AWAITING_ISSUANCE');
  });

  it('declares the intermediary with its CTU and shows both amounts (REQ-231, CA-202)', async () => {
    const { useCase } = scenario();

    const view = await useCase.execute(
      input({ intermediary: { intermediaryId: 'intermediary-1', ctu: '50' } }),
    );

    expect(view.intermediaryId).toBe('intermediary-1');
    expect(view.ctu).toBe('50');
    expect(view.expectedReceipt).toEqual({ intermediary: '20.00', usina: '10.00' });
  });

  it('refuses an intermediary without CTU and persists nothing (REJ-202)', async () => {
    const { proposals, useCase } = scenario();

    await expect(
      useCase.execute(input({ intermediary: { intermediaryId: 'intermediary-1', ctu: null } })),
    ).rejects.toThrow(BusinessRuleViolation);

    expect(await proposals.findById('fixed-id')).toBeNull();
  });

  it('refuses an unsigned registration (REQ-216, REJ-206)', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute(input({ author: '' }))).rejects.toThrow(BusinessRuleViolation);
  });

  it('accepts a registration without installments (REQ-202, CA-216)', async () => {
    const { useCase } = scenario();

    const view = await useCase.execute(input({ installments: [] }));

    expect(view.installments).toEqual([]);
  });

  it('does not refuse a proposal number another proposal already has (DEC-207)', async () => {
    const proposals = new InMemoryProposalRepository();
    let next = 0;
    const useCase = new RegisterProposal({
      proposals,
      newId: () => `id-${++next}`,
      now: () => NOW,
    });

    await useCase.execute(input());
    await expect(useCase.execute(input())).resolves.toMatchObject({ proposalNumber: 'PRP-9001' });
  });

  it.each([
    ['netPremium', { netPremium: '1500,75' }],
    ['workedCommission', { workedCommission: '20,5' }],
    ['coverageStart', { coverageStart: '01/10/2026' }],
  ] as const)('refuses a malformed %s (REQ-120, REQ-121)', async (_field, overrides) => {
    const { useCase } = scenario();

    await expect(useCase.execute(input(overrides))).rejects.toThrow(BusinessRuleViolation);
  });
});
