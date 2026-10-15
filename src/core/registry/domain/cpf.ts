import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { REGISTRY_MESSAGES } from './errors.ts';

/**
 * The CPF of a broker (REQ-301): 11 digits whose two check digits are valid.
 *
 * Informed with or without punctuation; only the digits are kept. Nothing
 * beyond the check digits is validated: V2 states no other rule.
 */
export class Cpf {
  readonly digits: string;

  private constructor(digits: string) {
    this.digits = digits;
  }

  static parse(text: string): Cpf {
    const trimmed = text.trim();

    if (trimmed === '') {
      throw new BusinessRuleViolation('REQ-300', REGISTRY_MESSAGES.BROKER_CPF_REQUIRED);
    }

    const digits = trimmed.replace(/[.-]/g, '');

    if (!/^\d{11}$/.test(digits) || !hasValidCheckDigits(digits)) {
      throw new BusinessRuleViolation('REQ-301', REGISTRY_MESSAGES.BROKER_CPF_INVALID);
    }

    return new Cpf(digits);
  }

  /** Rebuilds a stored CPF without re-applying the rule (REQ-124). */
  static restore(digits: string): Cpf {
    return new Cpf(digits);
  }
}

/** The two check digits of the CPF, each a mod-11 sum over the digits before it. */
function hasValidCheckDigits(digits: string): boolean {
  const values = [...digits].map(Number);

  return [9, 10].every((position) => {
    let sum = 0;
    for (let index = 0; index < position; index++) {
      sum += (values[index] ?? 0) * (position + 1 - index);
    }
    return ((sum * 10) % 11) % 10 === values[position];
  });
}
