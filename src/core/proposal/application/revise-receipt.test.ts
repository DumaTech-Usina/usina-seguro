import { describe, expect, it } from 'vitest';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../domain/errors.ts';
import { RegisterProposal } from './register-proposal.ts';
import { ReviseReceipt } from './revise-receipt.ts';

const REGISTERED_AT = new Date('2026-09-22T12:00:00.000Z');
const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

async function scenario() {
  const proposals = new InMemoryProposalRepository();

  await new RegisterProposal({
    proposals,
    documents: new InMemoryDocumentStorage(),
    newId: () => 'proposal-1',
    now: () => REGISTERED_AT,
  }).execute({
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
    installments: [],
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'ana.souza',
  });

  return { proposals, useCase: new ReviseReceipt({ proposals, now: () => REVISED_AT }) };
}

describe('ReviseReceipt', () => {
  it('declares an intermediary with its CTU, signed (REQ-225, REQ-223, FA-204)', async () => {
    const { useCase } = await scenario();

    const view = await useCase.execute({
      proposalId: 'proposal-1',
      intermediary: { intermediaryId: 'intermediary-1', ctu: '50' },
      author: 'bruno.lima',
    });

    expect(view.intermediaryId).toBe('intermediary-1');
    expect(view.ctu).toBe('50');
    expect(view.expectedReceipt).toEqual({ intermediary: '20.00', usina: '10.00' });
    expect(view.receiptHistory).toEqual([
      {
        intermediaryId: null,
        ctu: null,
        declaredBy: 'ana.souza',
        declaredAt: REGISTERED_AT.toISOString(),
      },
      {
        intermediaryId: 'intermediary-1',
        ctu: '50',
        declaredBy: 'bruno.lima',
        declaredAt: REVISED_AT.toISOString(),
      },
    ]);
  });

  it('removes the intermediary and the expected value goes back to premium x CT (FA-209, CA-214)', async () => {
    const { useCase } = await scenario();
    await useCase.execute({
      proposalId: 'proposal-1',
      intermediary: { intermediaryId: 'intermediary-1', ctu: '50' },
      author: 'bruno.lima',
    });

    const view = await useCase.execute({
      proposalId: 'proposal-1',
      intermediary: null,
      author: 'bruno.lima',
    });

    expect(view.ctu).toBeNull();
    expect(view.expectedReceipt).toEqual({ intermediary: null, usina: '20.00' });
  });

  it('refuses an intermediary without CTU and keeps the receipt (REJ-202, EX-202)', async () => {
    const { proposals, useCase } = await scenario();

    await expect(
      useCase.execute({
        proposalId: 'proposal-1',
        intermediary: { intermediaryId: 'intermediary-1', ctu: null },
        author: 'bruno.lima',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    expect((await proposals.findById('proposal-1'))?.receipt).toEqual({ kind: 'DIRECT' });
  });

  it('refuses an unsigned declaration (REQ-216, REJ-213)', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({ proposalId: 'proposal-1', intermediary: null, author: '' }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = await scenario();

    await expect(
      useCase.execute({ proposalId: 'ghost', intermediary: null, author: 'bruno.lima' }),
    ).rejects.toThrow(RecordNotFound);
  });
});
