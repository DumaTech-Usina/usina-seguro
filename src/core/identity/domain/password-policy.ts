import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from './errors.ts';

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/**
 * REQ-415: from 12 to 128 characters, with no composition rule.
 *
 * Characters, not UTF-16 code units: a password written with accents or emoji
 * is measured the way the person typing it counts it.
 */
export function assertPasswordPolicy(password: string): void {
  const length = [...password].length;

  if (length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new BusinessRuleViolation('REQ-415', IDENTITY_MESSAGES.PASSWORD_LENGTH, {
      min: String(MIN_LENGTH),
      max: String(MAX_LENGTH),
    });
  }
}
