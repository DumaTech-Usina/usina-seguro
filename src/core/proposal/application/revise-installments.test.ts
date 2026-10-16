import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../domain/errors.ts';
import { RegisterProposal } from './register-proposal.ts';
import { ReviseInstallments } from './revise-installments.ts';

const REGISTERED_AT = new Date('2026-09-22T12:00:00.000Z');
const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

async function scenario(mode: 'INTEGRAL' | 'PARCELLED' = 'INTEGRAL') {
  const proposals = new InMemoryProposalRepository();

  await new RegisterProposal({
    proposals,
    documents: new InMemoryDocumentStorage(),
    brokers: { isRegistered: async () => true },
    intermediaries: { isRegistered: async () => true },
    clients: {
      resolve: async () => 'client-1',
      matching: async () => new Set<string>(),
    },
    transaction: new ImmediateTransaction(),
    newId: () => 'proposal-1',
    now: () => REGISTERED_AT,
  }).execute({
    client: { name: 'Maria Souza', cpf: '52998224725' },
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-9001',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [
      { amount: '50.00', dueDate: null },
      { amount: '50.00', dueDate: null },
    ],
    workedCommission: '20',
    subsequentWorkedCommission: mode === 'PARCELLED' ? '10' : null,
    workedCommissionMode: mode,
    intermediary: null,
    author: 'ana.souza',
  });

  return { proposals, useCase: new ReviseInstallments({ proposals, now: () => REVISED_AT }) };
}

describe('ReviseInstallments (REQ-254)', () => {
  it('corrects the list before issuance, signed, keeping the earlier list (FA-224, CA-261)', async () => {
    const { useCase } = await scenario();

    const view = await useCase.execute({
      proposalId: 'proposal-1',
      installments: [
        { amount: '40.00', dueDate: '2026-11-10' },
        { amount: '30.00', dueDate: null },
        { amount: '30.00', dueDate: null },
      ],
      author: 'bruno.lima',
    });

    expect(view.installments).toEqual([
      { number: 1, amount: '40.00', dueDate: '2026-11-10' },
      { number: 2, amount: '30.00', dueDate: null },
      { number: 3, amount: '30.00', dueDate: null },
    ]);
    expect(
      view.installmentHistory.map((entry) => [
        entry.installments.length,
        entry.informedBy,
        entry.informedAt,
      ]),
    ).toEqual([
      [2, 'ana.souza', REGISTERED_AT.toISOString()],
      [3, 'bruno.lima', REVISED_AT.toISOString()],
    ]);
  });

  it('persists the correction', async () => {
    const { proposals, useCase } = await scenario();

    await useCase.execute({ proposalId: 'proposal-1', installments: [], author: 'bruno.lima' });

    expect((await proposals.findById('proposal-1'))?.installments).toEqual([]);
  });

  it('refuses an unsigned correction (REQ-216, REJ-244)', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({ proposalId: 'proposal-1', installments: [], author: ' ' }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('refuses leaving a parcelled proposal with fewer than two (REQ-292, CA-268)', async () => {
    const { proposals, useCase } = await scenario('PARCELLED');

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        installments: [{ amount: '100.00', dueDate: null }],
        author: 'bruno.lima',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    expect((await proposals.findById('proposal-1'))?.installments).toHaveLength(2);
  });

  it('refuses a malformed amount or date (REQ-120)', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        installments: [{ amount: '10,00', dueDate: null }],
        author: 'bruno.lima',
      }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({ proposalId: 'ghost', installments: [], author: 'bruno.lima' }),
    ).rejects.toThrow(RecordNotFound);
  });
});
