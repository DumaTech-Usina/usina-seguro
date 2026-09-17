import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';

/**
 * Commission percentage (REQ-041: worked commission informed at transmission).
 *
 * REQ-121 requires the percentage to be kept with the precision needed to
 * reproduce the apportioned value without a rounding that diverges from what
 * the insurer informed. So the value object keeps the **exact decimal text that
 * was informed** and never goes through binary floating point. It does not
 * impose a scale: fixing one here would silently round an input the business
 * did not agree to round.
 *
 * `Money` is not reused: it is a BRL amount with a fixed scale of 2, and a
 * percentage is neither an amount nor limited to two decimals.
 *
 * No arithmetic is exposed yet. Applying a percentage to an amount requires a
 * rounding rule, and no requirement defines one; that decision belongs to the
 * commission slice (REQ-062..REQ-069), not here.
 */
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export class Percentage {
  /** Exact decimal text as informed, e.g. '40', '32.5', '12.3456'. */
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static fromString(value: string): Percentage {
    const text = value.trim();

    if (!DECIMAL_STRING.test(text)) {
      throw new BusinessRuleViolation('REQ-121', PROPOSAL_MESSAGES.INVALID_PERCENTAGE_FORMAT, {
        value,
      });
    }

    const [whole = '0', fraction = ''] = text.split('.');
    const aboveHundred = BigInt(whole) > 100n;
    const hundredPlusFraction = BigInt(whole) === 100n && /[1-9]/.test(fraction);

    if (aboveHundred || hundredPlusFraction) {
      throw new BusinessRuleViolation('REQ-121', PROPOSAL_MESSAGES.PERCENTAGE_OUT_OF_RANGE, {
        value,
      });
    }

    return new Percentage(text);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
