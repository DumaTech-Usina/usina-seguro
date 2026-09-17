import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { CalendarDate } from './calendar-date.ts';

describe('CalendarDate', () => {
  it('keeps the calendar day exactly as informed', () => {
    expect(CalendarDate.fromString('2026-10-01').toString()).toBe('2026-10-01');
  });

  it('does not shift the day regardless of the local time zone', () => {
    // A `Date` built from this string in a UTC-3 zone would render 2026-09-30.
    const dueDate = CalendarDate.fromString('2026-10-01');

    expect(dueDate.toJSON()).toBe('2026-10-01');
  });

  it('orders chronologically', () => {
    const start = CalendarDate.fromString('2026-10-01');
    const end = CalendarDate.fromString('2027-09-30');

    expect(start.isBefore(end)).toBe(true);
    expect(end.isBefore(start)).toBe(false);
    expect(start.isBefore(start)).toBe(false);
    expect(start.equals(CalendarDate.fromString('2026-10-01'))).toBe(true);
  });

  it('rejects a day that does not exist', () => {
    expect(() => CalendarDate.fromString('2026-02-31')).toThrow(BusinessRuleViolation);
    expect(() => CalendarDate.fromString('2026-13-01')).toThrow(BusinessRuleViolation);
  });

  it('accepts a leap day and rejects it on a common year', () => {
    expect(CalendarDate.fromString('2028-02-29').toString()).toBe('2028-02-29');
    expect(() => CalendarDate.fromString('2026-02-29')).toThrow(BusinessRuleViolation);
  });

  it('rejects anything that is not an ISO calendar date', () => {
    for (const invalid of ['', '01/10/2026', '2026-10-1', '2026-10-01T00:00:00Z']) {
      expect(() => CalendarDate.fromString(invalid)).toThrow(BusinessRuleViolation);
    }
  });
});
