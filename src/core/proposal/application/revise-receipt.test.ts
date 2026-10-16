import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import { RegisterProposal } from './register-proposal.ts';
import { ReviseReceipt } from './revise-receipt.ts';

const REGISTERED_AT = new Date('2026-09-22T12:00:00.000Z');
const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

/** REQ-229: the intermediaries the reference registry knows. */
function registeredIntermediaries(...ids: string[]) {
  const asked: string[] = [];
  return {
    asked,
    port: {
      isRegistered: async (id: string) => {
        asked.push(id);
        return ids.includes(id);
      },
    },
  };
}

/**
 * A proposal awaiting issuance. `receivedThrough` registers it through that
 * intermediary, accepted whatever it is: the proposal of a registry that did
 * not yet refuse an unknown one (REQ-229, compatibility).
 */
async function scenario(receivedThrough: string | null = null) {
  const proposals = new InMemoryProposalRepository();
  const intermediaries = registeredIntermediaries('mega');

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
    installments: [],
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: receivedThrough === null ? null : { intermediaryId: receivedThrough, ctu: '50' },
    author: 'ana.souza',
  });

  return {
    proposals,
    intermediaries,
    useCase: new ReviseReceipt({
      proposals,
      intermediaries: intermediaries.port,
      now: () => REVISED_AT,
    }),
  };
}

describe('ReviseReceipt', () => {
  it('declares an intermediary with its CTU, signed (REQ-225, REQ-223, FA-204)', async () => {
    const { useCase } = await scenario();

    const view = await useCase.execute({
      proposalId: 'proposal-1',
      intermediary: { intermediaryId: 'mega', ctu: '50' },
      author: 'bruno.lima',
    });

    expect(view.intermediaryId).toBe('mega');
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
        intermediaryId: 'mega',
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
      intermediary: { intermediaryId: 'mega', ctu: '50' },
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

  describe('the registered intermediary (REQ-229)', () => {
    it('refuses an intermediary the registry does not know and keeps the receipt (REJ-246, EX-216)', async () => {
      const { proposals, useCase } = await scenario();

      const error = await useCase
        .execute({
          proposalId: 'proposal-1',
          intermediary: { intermediaryId: 'Intermediaria Digitada', ctu: '50' },
          author: 'bruno.lima',
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).rule).toBe('REQ-229');
      expect((error as BusinessRuleViolation).messageKey).toBe(
        PROPOSAL_MESSAGES.INTERMEDIARY_NOT_REGISTERED,
      );
      const stored = await proposals.findById('proposal-1');
      expect(stored?.receipt).toEqual({ kind: 'DIRECT' });
      expect(stored?.receiptHistory).toHaveLength(1);
    });

    it('never asks the registry when the intermediary is removed (FA-209)', async () => {
      const { intermediaries, useCase } = await scenario('mega');

      const view = await useCase.execute({
        proposalId: 'proposal-1',
        intermediary: null,
        author: 'bruno.lima',
      });

      expect(view.intermediaryId).toBeNull();
      expect(intermediaries.asked).toEqual([]);
    });

    it('keeps a proposal registered through an unknown intermediary readable, and lets it go direct or to a registered one (REQ-229)', async () => {
      const { proposals, useCase } = await scenario('Mega Antiga');

      expect((await proposals.findById('proposal-1'))?.receipt).toMatchObject({
        intermediaryId: 'Mega Antiga',
      });

      const registered = await useCase.execute({
        proposalId: 'proposal-1',
        intermediary: { intermediaryId: 'mega', ctu: '50' },
        author: 'bruno.lima',
      });
      expect(registered.intermediaryId).toBe('mega');

      const direct = await useCase.execute({
        proposalId: 'proposal-1',
        intermediary: null,
        author: 'bruno.lima',
      });
      expect(direct.intermediaryId).toBeNull();
    });

    it('refuses to declare again the unknown intermediary an older proposal holds (REQ-229, REQ-225)', async () => {
      const { useCase } = await scenario('Mega Antiga');

      await expect(
        useCase.execute({
          proposalId: 'proposal-1',
          intermediary: { intermediaryId: 'Mega Antiga', ctu: '60' },
          author: 'bruno.lima',
        }),
      ).rejects.toMatchObject({ rule: 'REQ-229' });
    });
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
