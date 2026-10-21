import { describe, expect, it } from 'vitest';
import { readPolicyText } from './policy-pdf-reader.ts';

/**
 * The reading of the policy number (REQ-248) on text. Synthetic on purpose:
 * the example policy PDF holds personal data and stays out of the repository;
 * it is exercised by the integration suite.
 *
 * The example PDF is a sample, not a model: these cases vary the label the
 * number is printed under, as another insurer — or another version of the same
 * insurer's document — would.
 */
describe('readPolicyText — the policy number (REQ-248)', () => {
  it('reads the number printed on every page and in the policy data (CA-270)', () => {
    const text = [
      'Página 1 de 8 Nº Apólice: 5177202641312121285',
      'Página 3 de 8 Nº Apólice: 5177202641312121285 Nº Endosso: 0',
      'Vigência: das 24H de 17/09/2026 às 24H de 17/09/2027 Apólice Nº.: 5177202641312121285',
      'Tipo de Seguro: Renovação de outra seguradora sem sinistro Proposta Nº.: 140839725',
      'Nº. Apólice Anterior: 05310312660034 Cód. CI: 58825485136805',
    ].join('\n');

    expect(readPolicyText(text)).toEqual({
      status: 'SUCCESS',
      fields: { policyNumber: '5177202641312121285' },
      missing: [],
    });
  });

  it.each([
    ['Número da Apólice: 1234567'],
    ['NÚMERO DA APÓLICE 1234567'],
    ['Numero Apolice: 1234567'],
    ['N° da Apólice: 1234567'],
    ['No. Apólice: 1234567'],
    ['Apólice nº 1234567'],
    ['APÓLICE: 1234567'],
  ])('reads the number under another label: %s', (line) => {
    expect(readPolicyText(`SEGURADORA EXEMPLO\n${line}\nVigência: 01/10/2026`).fields).toEqual({
      policyNumber: '1234567',
    });
  });

  it('keeps the number as printed, separators included', () => {
    expect(readPolicyText('Apólice Nº: 01.31.1234567-8').fields.policyNumber).toBe(
      '01.31.1234567-8',
    );
  });

  it('never takes the previous policy, the proposal or the endorsement for the policy (CA-270)', () => {
    const text = [
      'Nº. Apólice Anterior: 05310312660034',
      'Proposta Nº.: 140839725',
      'Nº Endosso: 0',
    ].join('\n');

    expect(readPolicyText(text)).toEqual({
      status: 'PARTIAL',
      fields: {},
      missing: ['policyNumber'],
    });
  });

  it('leaves the number absent when the occurrences disagree, rather than choose one', () => {
    const text = 'Nº Apólice: 1111111\nApólice Nº: 2222222';

    expect(readPolicyText(text)).toMatchObject({ status: 'PARTIAL', missing: ['policyNumber'] });
  });

  it('answers PARTIAL for a document with no policy number in it (CA-272)', () => {
    expect(readPolicyText('ALLIANZ\nPROPOSTA\nNº Proposta: 140839725')).toEqual({
      status: 'PARTIAL',
      fields: {},
      missing: ['policyNumber'],
    });
  });

  it('answers FAILED for a document with no text (CA-272)', () => {
    expect(readPolicyText('  \n ')).toEqual({
      status: 'FAILED',
      reason: 'NO_TEXT',
      fields: {},
      missing: ['policyNumber'],
    });
  });
});
