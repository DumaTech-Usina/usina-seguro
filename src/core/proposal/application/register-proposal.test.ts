import { describe, expect, it } from 'vitest';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, PROPOSAL_MESSAGES } from '../domain/errors.ts';
import { RegisterProposal, type RegisterProposalInput } from './register-proposal.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');

/** REQ-307: the brokers the registry knows, as the port answers it. */
function registeredBrokers(...ids: string[]) {
  return { isRegistered: async (id: string) => ids.includes(id) };
}

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const documents = new InMemoryDocumentStorage();
  let sequence = 0;
  const useCase = new RegisterProposal({
    proposals,
    documents,
    brokers: registeredBrokers('broker-1'),
    newId: () => (sequence++ === 0 ? 'fixed-id' : `id-${sequence}`),
    now: () => NOW,
  });
  return { proposals, documents, useCase };
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function input(overrides: Partial<RegisterProposalInput> = {}): RegisterProposalInput {
  return {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
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
  it('refuses a broker that is not registered, and stores nothing (REQ-307, REJ-304)', async () => {
    const { proposals, documents, useCase } = scenario();

    const error = await useCase
      .execute(
        input({
          brokerId: 'Corretora Digitada',
          sourceDocument: { fileName: 'p.pdf', contentType: 'application/pdf', content: PDF_BYTES },
        }),
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).rule).toBe('REQ-307');
    expect((error as BusinessRuleViolation).messageKey).toBe(
      PROPOSAL_MESSAGES.BROKER_NOT_REGISTERED,
    );
    expect(await proposals.list({})).toEqual([]);
    expect(await documents.findById('id-2')).toBeNull();
  });

  it('keeps the id of the broker chosen (REQ-307, CA-304)', async () => {
    const { proposals, useCase } = scenario();

    await useCase.execute(input());

    expect((await proposals.findById('fixed-id'))?.brokerId).toBe('broker-1');
  });

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
      subsequentWorkedCommission: null,
      workedCommissionMode: 'INTEGRAL',
      intermediaryId: null,
      ctu: null,
      expectedReceipt: { intermediary: null, usina: '20.00' },
      expectedInstallments: null,
      workedCommissionHistory: [
        {
          workedCommission: '20',
          subsequentWorkedCommission: null,
          workedCommissionMode: 'INTEGRAL',
          informedBy: 'ana.souza',
          informedAt: NOW.toISOString(),
        },
      ],
      installmentHistory: [
        {
          installments: [
            { number: 1, amount: '50.00', dueDate: '2026-10-10' },
            { number: 2, amount: '50.00', dueDate: null },
          ],
          informedBy: 'ana.souza',
          informedAt: NOW.toISOString(),
        },
      ],
      receiptHistory: [
        { intermediaryId: null, ctu: null, declaredBy: 'ana.souza', declaredAt: NOW.toISOString() },
      ],
      registeredAt: NOW.toISOString(),
      rejectionReason: null,
      issuanceRecognizedBy: null,
      issuanceRecognizedAt: null,
      sourceDocument: null,
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
      documents: new InMemoryDocumentStorage(),
      brokers: registeredBrokers('broker-1'),
      newId: () => `id-${++next}`,
      now: () => NOW,
    });

    await useCase.execute(input());
    await expect(useCase.execute(input())).resolves.toMatchObject({ proposalNumber: 'PRP-9001' });
  });

  it('keeps the imported PDF, associated with the proposal (REQ-219, CA-223)', async () => {
    const { proposals, documents, useCase } = scenario();

    const view = await useCase.execute(
      input({
        sourceDocument: {
          fileName: 'proposta.pdf',
          contentType: 'application/pdf',
          content: PDF_BYTES,
        },
      }),
    );

    expect(view.sourceDocument).toEqual({ fileName: 'proposta.pdf' });
    const stored = await proposals.findById('fixed-id');
    const documentId = stored?.sourceDocument?.documentId ?? '';
    expect(await documents.findById(documentId)).toEqual({
      id: documentId,
      fileName: 'proposta.pdf',
      contentType: 'application/pdf',
      content: PDF_BYTES,
    });
  });

  it('stores no document for a proposal the domain refuses', async () => {
    const { documents, useCase } = scenario();

    await expect(
      useCase.execute(
        input({
          paymentMethodId: '  ',
          sourceDocument: {
            fileName: 'proposta.pdf',
            contentType: 'application/pdf',
            content: PDF_BYTES,
          },
        }),
      ),
    ).rejects.toThrow(BusinessRuleViolation);

    expect(await documents.findById('id-2')).toBeNull();
  });

  it.each([
    ['netPremium', { netPremium: '1500,75' }],
    ['workedCommission', { workedCommission: '20,5' }],
    ['coverageStart', { coverageStart: '01/10/2026' }],
  ] as const)('refuses a malformed %s (REQ-120, REQ-121)', async (_field, overrides) => {
    const { useCase } = scenario();

    await expect(useCase.execute(input(overrides))).rejects.toThrow(BusinessRuleViolation);
  });

  describe('with parcelled CT (V2 section 6A)', () => {
    const PARCELLED = {
      workedCommissionMode: 'PARCELLED',
      workedCommission: '100',
      subsequentWorkedCommission: '30',
      installments: [
        { amount: '100.00', dueDate: null },
        { amount: '100.00', dueDate: null },
        { amount: '100.00', dueDate: null },
      ],
    } as const;

    it('registers the two CTs and shows only the expected value of each installment (REQ-291, REQ-293, CA-246)', async () => {
      const { useCase } = scenario();

      const view = await useCase.execute(input(PARCELLED));

      expect(view.workedCommission).toBe('100');
      expect(view.subsequentWorkedCommission).toBe('30');
      expect(view.expectedReceipt).toBeNull();
      expect(view.expectedInstallments).toEqual([
        { number: 1, amount: '100.00', workedCommission: '100', usina: '100.00' },
        { number: 2, amount: '100.00', workedCommission: '30', usina: '30.00' },
        { number: 3, amount: '100.00', workedCommission: '30', usina: '30.00' },
      ]);
      expect(view.workedCommissionHistory[0]?.subsequentWorkedCommission).toBe('30');
    });

    it('accepts CTs above 100% (REQ-295, CA-249)', async () => {
      const { useCase } = scenario();

      const view = await useCase.execute(
        input({ ...PARCELLED, workedCommission: '150', subsequentWorkedCommission: '120' }),
      );

      expect(view.expectedInstallments?.[0]?.usina).toBe('150.00');
    });

    it('keeps the integral CT within 100% (REQ-121, CA-251)', async () => {
      const { useCase } = scenario();

      await expect(useCase.execute(input({ workedCommission: '101' }))).rejects.toThrow(
        BusinessRuleViolation,
      );
    });

    it('refuses an intermediary and persists nothing (REQ-296, REJ-230)', async () => {
      const { proposals, useCase } = scenario();

      await expect(
        useCase.execute(
          input({ ...PARCELLED, intermediary: { intermediaryId: 'intermediary-1', ctu: '50' } }),
        ),
      ).rejects.toThrow(BusinessRuleViolation);

      expect(await proposals.findById('fixed-id')).toBeNull();
    });

    it('refuses fewer than two installments or a missing CT (REQ-292, REQ-291, REJ-233)', async () => {
      const { useCase } = scenario();

      await expect(
        useCase.execute(
          input({ ...PARCELLED, installments: [{ amount: '100.00', dueDate: null }] }),
        ),
      ).rejects.toThrow(BusinessRuleViolation);
      await expect(
        useCase.execute(input({ ...PARCELLED, subsequentWorkedCommission: null })),
      ).rejects.toThrow(BusinessRuleViolation);
    });
  });
});
