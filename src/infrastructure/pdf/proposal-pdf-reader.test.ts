import { describe, expect, it } from 'vitest';
import { categoryOfLineOfBusiness } from './line-of-business-dictionary.ts';
import { identifyByText, readAllianzProposalText } from './proposal-pdf-reader.ts';

/**
 * Text shaped like what the extraction answers for an Allianz proposal
 * (REQ-218). Synthetic on purpose: the real reference PDF holds personal data
 * and stays out of the repository; it is exercised by the integration suite.
 */
function allianzText(overrides: Partial<Record<string, string>> = {}): string {
  const part = { ...DEFAULT_PARTS, ...overrides };
  return [
    'Página 1 de 6 Nº Proposta: 123456789',
    'AUTO',
    'MOTO',
    'ALLIANZ',
    'PROPOSTA',
    'SEU CORRETOR',
    part.broker,
    'E-mail: corretor@example.com Telefone: 0000000000 Código: 1',
    'SUAS INFORMAÇÕES',
    part.client,
    part.clientDocument,
    'INFORMAÇÕES DO SEU SEGURO',
    `${part.coverage} Nº da Proposta: ${part.secondNumber}`,
    `Tipo de Seguro: Seguro novo ${part.lineOfBusiness}`,
    'Página 2 de 6 Nº Proposta: 123456789',
    'Assistência 24 hs Intermediário R$ 246,46',
    part.netPremium,
    'Preço Total (IOF + Juros inclusos) R$ 1.391,36',
    'INFORMAÇÕES DE PAGAMENTO',
    'Forma de pagamento Nº. do Cartão: 0000********0000',
    part.netPremiumAgain,
    part.paymentMethod,
    `em ${part.count} parcelas Valor juros: R$ 0,00 IOF: R$ 47,51`,
    'Vencimento: Fatura Cartão Preço Total (impostos inclusos)',
    'Parcelas Valor da Parcela Parcelas Valor da Parcela',
    '1 R$ 434,62 3 R$ 434,62',
    '2 R$ 434,62',
    'Declaro, como Intermediário nesta contratação, que na forma da legislação vigente',
  ].join('\n');
}

const DEFAULT_PARTS: Record<string, string> = {
  broker: 'CORRETORA EXEMPLO LTDA',
  client: 'Nome: MARIA DA SILVA',
  clientDocument: 'CPF/CNPJ: 529.982.247-25 Tel: 0000000000',
  coverage: 'Vigência: das 24H de 17/09/2026 às 24H de 17/09/2027',
  secondNumber: '123456789',
  lineOfBusiness: 'Ramo: 31 - Moto',
  netPremium: 'Preço Líquido R$ 1.303,85',
  netPremiumAgain: 'Preço líquido: R$ 1.303,85 Taxa mensal juros: 0,00',
  paymentMethod: 'Cartão de Crédito*',
  count: '3',
};

describe('readAllianzProposalText', () => {
  it('reads every field it knows and answers SUCCESS (REQ-218, CA-220)', () => {
    const reading = readAllianzProposalText(allianzText(), identifyByText);

    expect(reading.status).toBe('SUCCESS');
    expect(reading.missing).toEqual([]);
    expect(reading.fields).toEqual({
      proposalNumber: '123456789',
      clientId: 'MARIA DA SILVA',
      clientCpf: '52998224725',
      brokerId: 'CORRETORA EXEMPLO LTDA',
      insurerId: 'ALLIANZ',
      productId: 'Auto',
      paymentMethodId: 'Cartão de Crédito',
      netPremium: '1303.85',
      coverageStart: '2026-09-17',
      coverageEnd: '2027-09-17',
      installments: [
        { amount: '434.62', dueDate: null },
        { amount: '434.62', dueDate: null },
        { amount: '434.62', dueDate: null },
      ],
    });
  });

  it.each([
    ['a CNPJ', 'CPF/CNPJ: 11.222.333/0001-81 Tel: 0000000000'],
    ['a CPF with invalid check digits', 'CPF/CNPJ: 529.982.247-24 Tel: 0000000000'],
    ['a masked CPF', 'CPF/CNPJ: ***.982.247-** Tel: 0000000000'],
    ['no document line', 'Tel: 0000000000'],
  ])('leaves the client CPF absent for %s, keeping the name (REQ-321)', (_case, line) => {
    const reading = readAllianzProposalText(allianzText({ clientDocument: line }), identifyByText);

    expect(reading.status).toBe('PARTIAL');
    expect(reading.missing).toEqual(['clientCpf']);
    expect(reading.fields.clientId).toBe('MARIA DA SILVA');
    expect(reading.fields.clientCpf).toBeUndefined();
  });

  it('reads the CPF printed without punctuation as well (REQ-321)', () => {
    const reading = readAllianzProposalText(
      allianzText({ clientDocument: 'CPF/CNPJ: 52998224725 Tel: 0000000000' }),
      identifyByText,
    );

    expect(reading.fields.clientCpf).toBe('52998224725');
  });

  it('normalizes money to the decimal string of the domain (REQ-120)', () => {
    const reading = readAllianzProposalText(allianzText(), identifyByText);

    expect(reading.fields.netPremium).toBe('1303.85');
  });

  it('keeps the printed coverage dates, without the hour (REQ-218)', () => {
    const reading = readAllianzProposalText(allianzText(), identifyByText);

    expect([reading.fields.coverageStart, reading.fields.coverageEnd]).toEqual([
      '2026-09-17',
      '2027-09-17',
    ]);
  });

  it('answers PARTIAL, keeping what it found, when a field is absent (CA-221)', () => {
    const reading = readAllianzProposalText(
      allianzText({ netPremium: '', netPremiumAgain: '' }),
      identifyByText,
    );

    expect(reading.status).toBe('PARTIAL');
    expect(reading.missing).toEqual(['netPremium']);
    expect(reading.fields.netPremium).toBeUndefined();
    expect(reading.fields.proposalNumber).toBe('123456789');
  });

  it('invents nothing when two occurrences of a field disagree', () => {
    const reading = readAllianzProposalText(
      allianzText({ netPremiumAgain: 'Preço líquido: R$ 999,00 Taxa mensal juros: 0,00' }),
      identifyByText,
    );

    expect(reading.fields.netPremium).toBeUndefined();
    expect(reading.missing).toContain('netPremium');
  });

  it('does not take the number of a proposal that disagrees with itself', () => {
    const reading = readAllianzProposalText(
      allianzText({ secondNumber: '987654321' }),
      identifyByText,
    );

    expect(reading.fields.proposalNumber).toBeUndefined();
    expect(reading.missing).toContain('proposalNumber');
  });

  it('leaves the installments absent when the table does not match the count', () => {
    const reading = readAllianzProposalText(allianzText({ count: '4' }), identifyByText);

    expect(reading.fields.installments).toBeUndefined();
    expect(reading.missing).toContain('installments');
  });

  it('leaves the product absent when the line of business is not in the dictionary', () => {
    const reading = readAllianzProposalText(
      allianzText({ lineOfBusiness: 'Ramo: 99 - Embarcação' }),
      identifyByText,
    );

    expect(reading.fields.productId).toBeUndefined();
    expect(reading.missing).toContain('productId');
  });

  it('leaves an unparsable date absent instead of guessing it', () => {
    const reading = readAllianzProposalText(
      allianzText({ coverage: 'Vigência: das 24H de 31/02/2026 às 24H de 17/09/2027' }),
      identifyByText,
    );

    expect(reading.fields.coverageStart).toBeUndefined();
    expect(reading.missing).toContain('coverageStart');
  });

  it('identifies references through the function it is given (DEC-208)', () => {
    const reading = readAllianzProposalText(allianzText(), (kind, text) => `${kind}:${text}`);

    expect(reading.fields.clientId).toBe('CLIENT:MARIA DA SILVA');
    expect(reading.fields.brokerId).toBe('BROKER:CORRETORA EXEMPLO LTDA');
    expect(reading.fields.paymentMethodId).toBe('PAYMENT_METHOD:Cartão de Crédito');
  });

  it('answers FAILED for a document in a layout it does not know (CA-222)', () => {
    const reading = readAllianzProposalText('Proposta de outra seguradora\nNº 1', identifyByText);

    expect(reading).toMatchObject({ status: 'FAILED', reason: 'UNRECOGNIZED_LAYOUT' });
    expect(reading.fields).toEqual({});
  });

  it('answers FAILED for a document with no text (CA-222)', () => {
    const reading = readAllianzProposalText('  \n ', identifyByText);

    expect(reading).toMatchObject({ status: 'FAILED', reason: 'NO_TEXT' });
  });
});

describe('categoryOfLineOfBusiness', () => {
  it.each([
    ['Moto', 'Auto'],
    ['CARRO', 'Auto'],
  ])('puts %s under %s', (lineOfBusiness, category) => {
    expect(categoryOfLineOfBusiness(lineOfBusiness)).toBe(category);
  });

  it('answers null for a line of business it does not know', () => {
    expect(categoryOfLineOfBusiness('Embarcação')).toBeNull();
  });
});
