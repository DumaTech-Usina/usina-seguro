import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from './errors.ts';

/**
 * A calendar day, with no time and no time zone.
 *
 * The coverage period and the renewal date (REQ-020, REQ-055) and the
 * installment due dates (section 10.4) are calendar facts: "starts on
 * 2026-10-01", not "starts at an instant". Carrying them in a `Date` would add
 * a time zone that the business never informed, and a due date could shift a
 * day depending on where the process runs.
 *
 * `registeredAt` and `transmittedAt` stay as `Date`: those are instants.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class CalendarDate {
  /** ISO-8601 calendar date, e.g. '2026-10-01'. */
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static fromString(value: string): CalendarDate {
    const text = value.trim();
    const match = ISO_DATE.exec(text);

    if (match === null) {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.INVALID_DATE_FORMAT, { value });
    }

    // Guards against 2026-02-31 and friends: `Date.UTC` normalises an overflow
    // instead of failing, so the round trip has to match the input.
    const [, year = '', month = '', day = ''] = match;
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    if (utc.toISOString().slice(0, 10) !== text) {
      throw new BusinessRuleViolation('REQ-020', POLICY_MESSAGES.INVALID_DATE_FORMAT, { value });
    }

    return new CalendarDate(text);
  }

  /** Lexicographic order on an ISO date is chronological order. */
  isBefore(other: CalendarDate): boolean {
    return this.value < other.value;
  }

  equals(other: CalendarDate): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
