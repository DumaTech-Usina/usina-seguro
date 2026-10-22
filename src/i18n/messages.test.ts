import { describe, expect, it } from 'vitest';
import { COMMISSION_MESSAGES } from '../core/commission/domain/errors.ts';
import { POLICY_MESSAGES } from '../core/policy/domain/errors.ts';
import { PROPOSAL_MESSAGES } from '../core/proposal/domain/errors.ts';
import { translate } from './messages.ts';

describe('translate', () => {
  it('renders the Portuguese text for a domain key', () => {
    expect(translate(PROPOSAL_MESSAGES.PAYMENT_METHOD_REQUIRED)).toBe(
      'Proposta exige forma de pagamento definida.',
    );
  });

  it('interpolates parameters', () => {
    expect(translate(COMMISSION_MESSAGES.INSTALLMENT_NOT_IN_POLICY, { number: '3' })).toBe(
      'A apólice não tem a parcela 3.',
    );
  });

  it('names a field in Portuguese, never by its identifier in the code', () => {
    expect(translate(PROPOSAL_MESSAGES.FIELD_REQUIRED, { field: 'brokerId' })).toBe(
      'Informe o corretor da proposta.',
    );
  });

  it('names the state of an installment in Portuguese', () => {
    expect(
      translate(POLICY_MESSAGES.ONLY_PENDING_CAN_BE_PAID, { number: '2', status: 'PAID' }),
    ).toBe('Somente parcela pendente pode ser confirmada como paga. Parcela 2 está paga.');
  });

  it('keeps the marker when a parameter is missing, instead of printing undefined', () => {
    expect(translate(PROPOSAL_MESSAGES.FIELD_REQUIRED)).toBe('Informe {field} da proposta.');
  });

  it('falls back to the key when it has no translation', () => {
    expect(translate('unknown.key')).toBe('unknown.key');
  });

  it('has a translation for every key the domain can emit', () => {
    const keys = [
      ...Object.values(PROPOSAL_MESSAGES),
      ...Object.values(POLICY_MESSAGES),
      ...Object.values(COMMISSION_MESSAGES),
    ];

    for (const key of keys) {
      expect(translate(key)).not.toBe(key);
    }
  });
});
