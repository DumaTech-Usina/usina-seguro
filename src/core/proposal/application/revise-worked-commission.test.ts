import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../domain/errors.ts';
import { RegisterProposal } from './register-proposal.ts';
import { ReviseWorkedCommission } from './revise-worked-commission.ts';

const REGISTERED_AT = new Date('2026-09-22T12:00:00.000Z');
const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

async function scenario() {
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
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'ana.souza',
  });

  return {
    proposals,
    useCase: new ReviseWorkedCommission({ proposals, now: () => REVISED_AT }),
  };
}

describe('ReviseWorkedCommission', () => {
  it('corrects the CT and its mode, signed, keeping the earlier entry (REQ-214, REQ-215, CA-204, CA-217)', async () => {
    const { useCase } = await scenario();

    const view = await useCase.execute({
      proposalId: 'proposal-1',
      workedCommission: '25',
      subsequentWorkedCommission: '10',
      workedCommissionMode: 'PARCELLED',
      author: 'bruno.lima',
    });

    expect(view.workedCommission).toBe('25');
    expect(view.subsequentWorkedCommission).toBe('10');
    expect(view.workedCommissionMode).toBe('PARCELLED');
    expect(view.expectedInstallments?.map((installment) => installment.usina)).toEqual([
      '12.50',
      '5.00',
    ]);
    expect(view.workedCommissionHistory).toEqual([
      {
        workedCommission: '20',
        subsequentWorkedCommission: null,
        workedCommissionMode: 'INTEGRAL',
        informedBy: 'ana.souza',
        informedAt: REGISTERED_AT.toISOString(),
      },
      {
        workedCommission: '25',
        subsequentWorkedCommission: '10',
        workedCommissionMode: 'PARCELLED',
        informedBy: 'bruno.lima',
        informedAt: REVISED_AT.toISOString(),
      },
    ]);
  });

  it('refuses the switch to parcelled without the CT of the subsequent installments (REQ-291)', async () => {
    const { proposals, useCase } = await scenario();

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        workedCommission: '25',
        workedCommissionMode: 'PARCELLED',
        author: 'bruno.lima',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    expect((await proposals.findById('proposal-1'))?.workedCommissionMode).toBe('INTEGRAL');
  });

  it('persists the correction', async () => {
    const { proposals, useCase } = await scenario();

    await useCase.execute({
      proposalId: 'proposal-1',
      workedCommission: '25',
      workedCommissionMode: 'INTEGRAL',
      author: 'bruno.lima',
    });

    expect((await proposals.findById('proposal-1'))?.workedCommission.toString()).toBe('25');
  });

  it('refuses an unsigned correction and keeps the CT (REQ-216, REJ-206)', async () => {
    const { proposals, useCase } = await scenario();

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        workedCommission: '25',
        workedCommissionMode: 'INTEGRAL',
        author: '  ',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    expect((await proposals.findById('proposal-1'))?.workedCommission.toString()).toBe('20');
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({
        proposalId: 'ghost',
        workedCommission: '25',
        workedCommissionMode: 'INTEGRAL',
        author: 'bruno.lima',
      }),
    ).rejects.toThrow(RecordNotFound);
  });
});
