import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Reference } from './reference.ts';

const AT = new Date('2026-09-21T12:00:00.000Z');

describe('Reference', () => {
  it('registers a record for the identifier the rest of the system stores (IN-01)', () => {
    const reference = Reference.register({
      kind: 'CLIENT',
      id: 'client-1',
      name: 'Maria Souza',
      registeredAt: AT,
    });

    expect(reference.kind).toBe('CLIENT');
    expect(reference.id).toBe('client-1');
    // REQ-096: the name is what a report and a receipt identify a business by.
    expect(reference.name).toBe('Maria Souza');
  });

  it('refuses a record with no identifier', () => {
    expect(() =>
      Reference.register({ kind: 'CLIENT', id: '  ', name: 'Maria Souza', registeredAt: AT }),
    ).toThrow(BusinessRuleViolation);
  });

  it('refuses a record with no name', () => {
    // A record with no name is one REQ-096 could not print: it would be a row
    // that answers the question the registry exists to answer with nothing.
    expect(() =>
      Reference.register({ kind: 'CLIENT', id: 'client-1', name: '   ', registeredAt: AT }),
    ).toThrow(BusinessRuleViolation);
  });

  it('names the field that was missing, for the message to render it', () => {
    try {
      Reference.register({ kind: 'PRODUCT', id: 'auto', name: '', registeredAt: AT });
      expect.unreachable('a reference with no name must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).params).toEqual({ field: 'name' });
      expect((error as BusinessRuleViolation).rule).toBe('IN-01');
    }
  });

  it('stores the identifier trimmed, to match the reference already stored', () => {
    // The proposal keeps `clientId` as it was typed; the registry is matched
    // against it, so a stray space must not make the two sides miss.
    const reference = Reference.register({
      kind: 'INSURER',
      id: '  insurer-1  ',
      name: '  Seguradora Alfa  ',
      registeredAt: AT,
    });

    expect(reference.id).toBe('insurer-1');
    expect(reference.name).toBe('Seguradora Alfa');
  });

  it('restores a persisted record without re-applying the rules (REQ-124)', () => {
    const restored = Reference.restore({
      kind: 'INSURER',
      id: 'insurer-1',
      name: '',
      registeredAt: AT,
    });

    expect(restored.name).toBe('');
  });
});
