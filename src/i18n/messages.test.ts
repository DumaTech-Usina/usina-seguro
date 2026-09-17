import { describe, expect, it } from 'vitest';
import { PROPOSAL_MESSAGES } from '../core/proposal/domain/errors.ts';
import { translate } from './messages.ts';

describe('translate', () => {
  it('renders the Portuguese text for a domain key', () => {
    expect(translate(PROPOSAL_MESSAGES.CUSTOMER_ACCEPTANCE_REQUIRED)).toBe(
      'Proposta exige aceite do cliente registrado.',
    );
  });

  it('interpolates parameters', () => {
    expect(translate(PROPOSAL_MESSAGES.FIELD_REQUIRED, { field: 'clientId' })).toBe(
      'Proposta exige o campo clientId.',
    );
  });

  it('keeps the marker when a parameter is missing, instead of printing undefined', () => {
    expect(translate(PROPOSAL_MESSAGES.FIELD_REQUIRED)).toBe('Proposta exige o campo {field}.');
  });

  it('falls back to the key when it has no translation', () => {
    expect(translate('unknown.key')).toBe('unknown.key');
  });

  it('has a translation for every key the domain can emit', () => {
    for (const key of Object.values(PROPOSAL_MESSAGES)) {
      expect(translate(key)).not.toBe(key);
    }
  });
});
