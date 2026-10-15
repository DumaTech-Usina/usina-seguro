import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';
import { assertPasswordPolicy } from './password-policy.ts';

describe('password policy (REQ-415)', () => {
  it('accepts 12 and 128 characters, with no composition rule', () => {
    expect(() => assertPasswordPolicy('a'.repeat(12))).not.toThrow();
    expect(() => assertPasswordPolicy('a'.repeat(128))).not.toThrow();
    expect(() => assertPasswordPolicy('frase longa sem simbolo')).not.toThrow();
  });

  it('refuses 11 and 129 characters (EX-407)', () => {
    for (const password of ['a'.repeat(11), 'a'.repeat(129)]) {
      try {
        assertPasswordPolicy(password);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessRuleViolation);
        expect((error as BusinessRuleViolation).messageKey).toBe(IDENTITY_MESSAGES.PASSWORD_LENGTH);
        expect((error as BusinessRuleViolation).params).toEqual({ min: '12', max: '128' });
      }
    }
  });

  it('counts characters, not UTF-16 code units', () => {
    // Twelve characters that take two code units each.
    expect(() => assertPasswordPolicy('😀'.repeat(12))).not.toThrow();
    expect(() => assertPasswordPolicy('😀'.repeat(11))).toThrow(BusinessRuleViolation);
  });
});
