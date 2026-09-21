import type { CommissionAgreementRepository } from '../../../core/commission/application/commission-agreement-repository.ts';
import type { CommissionAgreement } from '../../../core/commission/domain/commission-agreement.ts';
import type { CalendarDate } from '../../../core/policy/domain/calendar-date.ts';

/** The key `commission_agreement` is UNIQUE on: insurer, product and validity. */
function keyOf(agreement: CommissionAgreement): string {
  return [agreement.insurerId, agreement.productId, agreement.effectiveFrom.toString()].join(
    '\u0000',
  );
}

export class InMemoryCommissionAgreementRepository implements CommissionAgreementRepository {
  private readonly records = new Map<string, CommissionAgreement>();

  /**
   * Re-registering the same validity replaces it, which is what the SQLite
   * adapter does through `ON CONFLICT`. Keeping both here would make the same
   * call answer one record in one driver and two in the other — a divergence
   * of this class was already found once and is recorded in the checklist.
   *
   * REQ-124 is not at stake: a new *validity* is still a new record, and a
   * calculation already made copied the rates it used (REJ-011).
   */
  async save(agreement: CommissionAgreement): Promise<void> {
    this.records.set(keyOf(agreement), agreement);
  }

  /** REQ-065: the most recent validity that already started on that day. */
  async findInForce(
    insurerId: string,
    productId: string,
    on: CalendarDate,
  ): Promise<CommissionAgreement | null> {
    const candidates = [...this.records.values()]
      .filter(
        (agreement) =>
          agreement.insurerId === insurerId &&
          agreement.productId === productId &&
          !on.isBefore(agreement.effectiveFrom),
      )
      .sort((a, b) => a.effectiveFrom.toString().localeCompare(b.effectiveFrom.toString()));

    return candidates.at(-1) ?? null;
  }

  /** IN-02: insurer, then product, then the most recent validity first. */
  async list(): Promise<readonly CommissionAgreement[]> {
    return [...this.records.values()].sort(
      (a, b) =>
        compare(a.insurerId, b.insurerId) ||
        compare(a.productId, b.productId) ||
        compare(b.effectiveFrom.toString(), a.effectiveFrom.toString()),
    );
  }
}

/**
 * Code-unit comparison rather than `localeCompare`: SQLite orders `TEXT` by
 * bytes, and a locale-aware order here would make the two drivers answer the
 * same listing in different orders. See SQLITE-NOTES.md.
 */
function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
