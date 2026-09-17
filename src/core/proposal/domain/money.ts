import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';

/**
 * Monetary amount in BRL with fixed decimal precision (REQ-120).
 *
 * Stored internally as cents (`bigint`) so no operation ever goes through
 * binary floating point. The canonical representation for persistence and
 * transport is the 2-decimal string from `toString()`, never `number`.
 *
 * The scale is fixed at 2 because the only confirmed use today is an amount in
 * BRL (net premium, REQ-022). Commission percentages require a different
 * precision (REQ-121) and will be modelled when the commission module exists.
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
