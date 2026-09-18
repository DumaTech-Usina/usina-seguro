import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';

/**
 * Commission percentage (REQ-041: worked commission informed at transmission;
 * REQ-065, REQ-093: the rates of the commercial agreement and of the broker
 * table).
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
 * The percentage does not apply itself to an amount: the rounding happens in
 * `Money`, which is the type that owns the scale the result has to fit. What is
 * exposed here is the exact fraction behind the text, so no step of the
 * calculation goes through binary floating point.
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

  /**
   * The exact value as `numerator / 10 ** scale`, e.g. '32.5' becomes
   * `{ numerator: 325n, scale: 1 }`.
   *
   * REQ-121 requires the informed precision to survive the calculation, so the
   * fraction is exact and the caller decides where to round (see
   * `Money.applyRate`).
   */
  asFraction(): { readonly numerator: bigint; readonly scale: number } {
    const [whole = '0', fraction = ''] = this.value.split('.');
    return { numerator: BigInt(whole + fraction), scale: fraction.length };
  }

  equals(other: Percentage): boolean {
    const mine = this.asFraction();
    const theirs = other.asFraction();
    const scale = Math.max(mine.scale, theirs.scale);
    return (
      mine.numerator * 10n ** BigInt(scale - mine.scale) ===
      theirs.numerator * 10n ** BigInt(scale - theirs.scale)
    );
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
