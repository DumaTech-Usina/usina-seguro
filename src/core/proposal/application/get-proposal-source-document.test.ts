import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { RecordNotFound } from '../domain/errors.ts';
import { GetProposalSourceDocument } from './get-proposal-source-document.ts';
import { RegisterProposal, type RegisterProposalInput } from './register-proposal.ts';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const documents = new InMemoryDocumentStorage();
  let sequence = 0;
  const register = new RegisterProposal({
    proposals,
    documents,
    brokers: { isRegistered: async () => true },
    intermediaries: { isRegistered: async () => true },
    clients: {
      resolve: async () => 'client-1',
      nameOf: async (id: string) => id,
    },
    transaction: new ImmediateTransaction(),
    newId: () => `id-${++sequence}`,
    now: () => new Date('2026-09-22T12:00:00.000Z'),
  });
  return { register, useCase: new GetProposalSourceDocument({ proposals, documents }) };
}

function input(overrides: Partial<RegisterProposalInput> = {}): RegisterProposalInput {
  return {
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
    intermediary: null,
    author: 'ana.souza',
    ...overrides,
  };
}

describe('GetProposalSourceDocument', () => {
  it('hands back the imported PDF exactly as it was uploaded (REQ-219, CA-223)', async () => {
    const { register, useCase } = scenario();
    const proposal = await register.execute(
      input({
        sourceDocument: {
          fileName: 'proposta.pdf',
          contentType: 'application/pdf',
          content: PDF_BYTES,
        },
      }),
    );

    const document = await useCase.execute(proposal.id);

    expect(document.fileName).toBe('proposta.pdf');
    expect(document.contentType).toBe('application/pdf');
    expect(document.content).toEqual(PDF_BYTES);
  });

  it('reports a proposal typed by hand as having no source document', async () => {
    const { register, useCase } = scenario();
    const proposal = await register.execute(input());

    await expect(useCase.execute(proposal.id)).rejects.toThrow(RecordNotFound);
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
