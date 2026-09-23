import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ProposalPdfReader,
  identifyByText,
} from '../../src/infrastructure/pdf/proposal-pdf-reader.ts';

/**
 * The reader against real PDF bytes (REQ-218).
 *
 * The reference proposal holds personal data, so it is never versioned: it
 * lives at the repository root, ignored by git, and the test that needs it is
 * skipped — saying so — when the file is not there.
 */
const REFERENCE_PDF = path.resolve(import.meta.dirname, '../../proposta-exemplo.pdf');
const hasReference = existsSync(REFERENCE_PDF);

const reader = new ProposalPdfReader({ identify: identifyByText });

describe('ProposalPdfReader', () => {
  it.skipIf(!hasReference)(
    'reads the reference Allianz proposal into every known field (CA-220)',
    async () => {
      const reading = await reader.read(new Uint8Array(readFileSync(REFERENCE_PDF)));

      expect(reading.status).toBe('SUCCESS');
      expect(reading.missing).toEqual([]);
      expect(reading.fields).toMatchObject({
        proposalNumber: '140839725',
        clientId: 'JOSE WENDSON GOMES DE QUEIROZ COSTA',
        brokerId: 'PAISSANDU CORRETORA DE SEGUROS LTDA',
        insurerId: 'ALLIANZ',
        productId: 'Auto',
        paymentMethodId: 'Cartão de Crédito',
        netPremium: '643.85',
        coverageStart: '2026-09-17',
        coverageEnd: '2027-09-17',
      });
      expect(reading.fields.installments).toHaveLength(10);
      expect(reading.fields.installments?.[0]).toEqual({ amount: '69.14', dueDate: null });
      expect(reading.fields.installments?.[9]).toEqual({ amount: '69.10', dueDate: null });
    },
  );

  it('answers FAILED for bytes that are not a PDF (CA-222)', async () => {
    const reading = await reader.read(new TextEncoder().encode('isto não é um pdf'));

    expect(reading).toMatchObject({ status: 'FAILED', reason: 'UNREADABLE' });
    expect(reading.fields).toEqual({});
  });

  it('answers FAILED for an empty file (CA-222)', async () => {
    const reading = await reader.read(new Uint8Array());

    expect(reading.status).toBe('FAILED');
  });
});
