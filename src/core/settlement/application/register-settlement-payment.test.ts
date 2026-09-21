import { describe, expect, it } from 'vitest';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemorySettlementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-settlement-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Settlement } from '../domain/settlement.ts';
import { GetSettlementPaymentProof } from './get-settlement-payment-proof.ts';
import {
  RegisterSettlementPayment,
  type RegisterSettlementPaymentInput,
} from './register-settlement-payment.ts';

const NOW = new Date('2026-09-21T15:00:00.000Z');

/** A PDF header plus a byte no text encoding round-trips (0xFF). */
const CONTENT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff]);

function scenario(status: 'RELEASED' | 'AWAITING_CONFIRMATION' = 'RELEASED') {
  const settlements = new InMemorySettlementRepository();
  const documents = new InMemoryDocumentStorage();
  let sequence = 0;

  const useCase = new RegisterSettlementPayment({
    settlements,
    documents,
    newId: () => `document-${++sequence}`,
    now: () => NOW,
  });

  return {
    settlements,
    documents,
    useCase,
    proof: new GetSettlementPaymentProof({ settlements, documents }),
    open: async () => {
      await settlements.save(
        Settlement.open(
          {
            id: 'settlement-1',
            policyId: 'policy-1',
            brokerId: 'broker-1',
            amount: Money.fromString('20.00'),
            releaseRule: status === 'RELEASED' ? 'IMMEDIATE' : 'REQUIRES_RECEIPT_CONFIRMATION',
            openedAt: new Date('2026-09-20T10:00:00.000Z'),
          },
          false,
        ),
      );
    },
  };
}

function input(overrides: Partial<RegisterSettlementPaymentInput> = {}) {
  return {
    policyId: 'policy-1',
    amount: '20.00',
    proof: {
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      content: CONTENT,
    },
    userId: 'financeiro-1',
    ...overrides,
  };
}

describe('RegisterSettlementPayment', () => {
  it('records the payment with the proof attached (REQ-095, CA-028, IN-15)', async () => {
    const { useCase, open } = scenario();
    await open();

    const paid = await useCase.execute(input());

    expect(paid.status).toBe('PAID');
    expect(paid.payment).toEqual({
      paidAt: NOW.toISOString(),
      amount: '20.00',
      proof: {
        fileName: 'comprovante.pdf',
        contentType: 'application/pdf',
        byteSize: CONTENT.length,
      },
      userId: 'financeiro-1',
    });
  });

  it('stores the document itself, byte for byte (REQ-095)', async () => {
    const { useCase, proof, open } = scenario();
    await open();

    await useCase.execute(input());

    const stored = await proof.execute('policy-1');
    expect(stored.fileName).toBe('comprovante.pdf');
    expect(stored.contentType).toBe('application/pdf');
    expect([...stored.content]).toEqual([...CONTENT]);
  });

  it('does not carry the bytes on the settlement view (REQ-095)', async () => {
    // The statement of OUT-07 lists one line per policy; twenty payments must
    // not mean twenty files travelling with the listing.
    const { useCase, open } = scenario();
    await open();

    const paid = await useCase.execute(input());

    expect(Object.keys(paid.payment?.proof ?? {})).toEqual(['fileName', 'contentType', 'byteSize']);
  });

  it('refuses a payment with an empty document and writes nothing (REQ-095)', async () => {
    const { useCase, documents, settlements, open } = scenario();
    await open();

    await expect(
      useCase.execute(input({ proof: { ...input().proof, content: new Uint8Array() } })),
    ).rejects.toThrow(BusinessRuleViolation);

    expect(await documents.findById('document-1')).toBeNull();
    expect((await settlements.findByPolicyId('policy-1'))?.status).toBe('RELEASED');
  });

  it('leaves no orphan document when the transfer cannot be paid (REJ-009)', async () => {
    // The transition runs before anything is written, which is the whole
    // reason the order in the use case is what it is.
    const { useCase, documents, open } = scenario('AWAITING_CONFIRMATION');
    await open();

    await expect(useCase.execute(input())).rejects.toThrow(BusinessRuleViolation);

    expect(await documents.findById('document-1')).toBeNull();
  });

  it('reports an unknown transfer as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute(input({ policyId: 'ghost' }))).rejects.toThrow(RecordNotFound);
  });
});

describe('GetSettlementPaymentProof', () => {
  it('answers not found while no payment was registered (REQ-095)', async () => {
    const { proof, open } = scenario();
    await open();

    await expect(proof.execute('policy-1')).rejects.toThrow(RecordNotFound);
  });

  it('answers not found for a policy with no transfer at all', async () => {
    const { proof } = scenario();

    await expect(proof.execute('policy-1')).rejects.toThrow(RecordNotFound);
  });
});
