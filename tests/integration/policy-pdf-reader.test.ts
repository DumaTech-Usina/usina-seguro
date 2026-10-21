import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PolicyPdfReader } from '../../src/infrastructure/pdf/policy-pdf-reader.ts';

/**
 * The reader against real PDF bytes (REQ-248).
 *
 * The example policy and proposal hold personal data, so they are never
 * versioned: they live at the repository root, ignored by git, and the tests
 * that need them are skipped — saying so — when the files are not there.
 */
const POLICY_PDF = path.resolve(import.meta.dirname, '../../apolice-exemplo.pdf');
const PROPOSAL_PDF = path.resolve(import.meta.dirname, '../../proposta-exemplo.pdf');

const reader = new PolicyPdfReader();

describe('PolicyPdfReader', () => {
  it.skipIf(!existsSync(POLICY_PDF))(
    'reads the policy number of the example policy, not its proposal number (CA-270)',
    async () => {
      const reading = await reader.read(new Uint8Array(readFileSync(POLICY_PDF)));

      expect(reading).toEqual({
        status: 'SUCCESS',
        fields: { policyNumber: '5177202641312121285' },
        missing: [],
      });
    },
  );

  it.skipIf(!existsSync(PROPOSAL_PDF))(
    'finds no policy number in a proposal, whose previous policy is not this one (CA-272)',
    async () => {
      const reading = await reader.read(new Uint8Array(readFileSync(PROPOSAL_PDF)));

      expect(reading).toMatchObject({ status: 'PARTIAL', missing: ['policyNumber'] });
    },
  );

  it('answers FAILED for bytes that are not a PDF (CA-272)', async () => {
    const reading = await reader.read(new TextEncoder().encode('isto não é um pdf'));

    expect(reading).toMatchObject({ status: 'FAILED', reason: 'UNREADABLE', fields: {} });
  });
});
