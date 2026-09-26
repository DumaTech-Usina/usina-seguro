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
 * premium REQ-022, policy premium REQ-020, commission and broker transfer
 * REQ-068, REQ-069, REQ-093). Percentages keep their own precision in
 * `Percentage` (REQ-121).
 */
const DECIMAL_PLACES = 2;
const DECIMAL_STRING = /^-?\d+(\.\d{1,2})?$/;

/**
 * How a rate applied to an amount lands on the cent. V2 states two modes:
 * the Usina value rounds half up at each step (REQ-237), and the broker's
 * amount from the CR is floored (REQ-275).
 */
export type Rounding = 'HALF_UP' | 'FLOOR';

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

  /** Zero, the neutral element of `plus`: where a total starts (OUT-07). */
  static zero(): Money {
    return new Money(0n);
  }

  /**
   * Applies a commission rate to this amount (REQ-062..REQ-069, REQ-093).
   *
   * The whole operation runs on integers: cents times the percentage's exact
   * numerator, divided by `100 * 10 ** scale`. Nothing goes through binary
   * floating point (REQ-120) and the informed precision of the rate is used in
   * full (REQ-121).
   *
   * The result has to land on a cent. By default it rounds half away from
   * zero, which is half up for the Usina value (REQ-237); the broker's amount
   * from the CR is floored instead (REQ-275). The mode is stated here, in one
   * place, rather than reappearing in each step of a chain.
   */
  applyRate(rate: Percentage, rounding: Rounding = 'HALF_UP'): Money {
    const { numerator, scale } = rate.asFraction();
    const product = this.cents * numerator;
    const denominator = 100n * 10n ** BigInt(scale);

    return new Money(
      rounding === 'FLOOR' ? divideFloor(product, denominator) : divideHalfUp(product, denominator),
    );
  }

  /**
   * Exact sum, on integer cents (REQ-120).
   *
   * It exists because a statement adds amounts up (OUT-07): the totals of what
   * the Usina expects to pay, holds, released and paid are sums of values the
   * system already holds, and adding them through `number` would reintroduce
   * the binary floating point the whole type avoids.
   */
  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
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

/** Integer division rounding halves away from zero. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const rounded = (absolute % denominator) * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Integer division rounding towards negative infinity. */
function divideFloor(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator < 0n ? quotient - 1n : quotient;
}
