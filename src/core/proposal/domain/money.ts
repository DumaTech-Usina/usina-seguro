import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';
import type { Percentage } from './percentage.ts';

/**
 * Monetary amount in BRL with fixed decimal precision (REQ-120).
 *
 * Stored internally as cents (`bigint`) so no operation ever goes through
 * binary floating point. The canonical representation for persistence and
 * transport is the 2-decimal string from `toString()`, never `number`.
 *
 * The scale is fixed at 2 because every confirmed amount is in BRL (net
 * premium REQ-202, the Usina value REQ-230/REQ-231, the broker's amount
 * REQ-275). Percentages keep their own precision in `Percentage` (REQ-121).
 */
const DECIMAL_PLACES = 2;
const DECIMAL_STRING = /^-?\d+(\.\d{1,2})?$/;

export class Money {
  private readonly cents: bigint;

  private constructor(cents: bigint) {
    this.cents = cents;
  }

  /**
   * Accepts a decimal string only (e.g. '1234.56'). `number` is rejected on
   * purpose: it would already carry the representation error when it got here.
   */
  static fromString(value: string): Money {
    const text = value.trim();
    if (!DECIMAL_STRING.test(text)) {
      throw new BusinessRuleViolation('REQ-120', PROPOSAL_MESSAGES.INVALID_MONEY_FORMAT, {
        value,
        scale: String(DECIMAL_PLACES),
      });
    }

    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
    const cents = BigInt(whole + fraction.padEnd(DECIMAL_PLACES, '0'));

    return new Money(negative ? -cents : cents);
  }

  /**
   * Applies a commission rate to this amount (CT, CTU and CR — REQ-230,
   * REQ-231, REQ-274).
   *
   * The whole operation runs on integers: cents times the percentage's exact
   * numerator, divided by `100 * 10 ** scale`. Nothing goes through binary
   * floating point (REQ-120) and the informed precision of the rate is used in
   * full (REQ-121).
   *
   * The result has to land on a cent, and it does by ABNT NBR 5891 — the one
   * rounding of every requirement (REQ-298): the Usina value at each step
   * (REQ-237), the broker's amount (REQ-275) and each installment of a
   * parcelled CT (REQ-294, REQ-264). It is stated here, in one place, rather
   * than reappearing in each step of a chain.
   */
  applyRate(rate: Percentage): Money {
    const { numerator, scale } = rate.asFraction();
    const denominator = 100n * 10n ** BigInt(scale);

    return new Money(divideAbnt5891(this.cents * numerator, denominator));
  }

  /** Exact difference, on integer cents (REQ-275: what stays with the Usina). */
  minus(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** Canonical representation: exact decimal string, never rounded. */
  toString(): string {
    const negative = this.cents < 0n;
    const absolute = (negative ? -this.cents : this.cents).toString().padStart(3, '0');
    const whole = absolute.slice(0, -DECIMAL_PLACES);
    const fraction = absolute.slice(-DECIMAL_PLACES);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

/**
 * Integer division rounded by ABNT NBR 5891 (REQ-298): less than half of the
 * last place discarded keeps it, more than half raises it, and exactly half
 * leaves it even. Symmetric around zero.
 */
function divideAbnt5891(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const twiceRemainder = (absolute % denominator) * 2n;
  const raise =
    twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n);
  const rounded = raise ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
