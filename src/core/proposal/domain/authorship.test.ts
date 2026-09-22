import { describe, expect, it } from 'vitest';
import { Authorship } from './authorship.ts';
import { BusinessRuleViolation } from './errors.ts';

const AT = new Date('2026-09-22T10:00:00.000Z');

describe('Authorship', () => {
  it('records who signed the act and when (REQ-215, REQ-223)', () => {
    const authorship = Authorship.of('ana.souza', AT);

    expect(authorship.author).toBe('ana.souza');
    expect(authorship.at).toEqual(AT);
  });

  it('keeps the identifier without the surrounding blanks the user typed', () => {
    expect(Authorship.of('  ana.souza  ', AT).author).toBe('ana.souza');
  });

  it('rejects an act nobody signed (REQ-216, REJ-206, REJ-213)', () => {
    try {
      Authorship.of('   ', AT);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).rule).toBe('REQ-216');
      expect((error as BusinessRuleViolation).messageKey).toBe('proposal.author_required');
    }
  });
});
