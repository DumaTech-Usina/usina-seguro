import type { CommissionAgreementRepository } from '../../../core/commission/application/commission-agreement-repository.ts';
import type { CommissionAgreement } from '../../../core/commission/domain/commission-agreement.ts';
import type { CalendarDate } from '../../../core/policy/domain/calendar-date.ts';

export class InMemoryCommissionAgreementRepository implements CommissionAgreementRepository {
  private readonly records: CommissionAgreement[] = [];

  async save(agreement: CommissionAgreement): Promise<void> {
    this.records.push(agreement);
  }

  /** REQ-065: the most recent validity that already started on that day. */
  async findInForce(
    insurerId: string,
    productId: string,
    on: CalendarDate,
  ): Promise<CommissionAgreement | null> {
    const candidates = this.records
      .filter(
        (agreement) =>
          agreement.insurerId === insurerId &&
          agreement.productId === productId &&
          !on.isBefore(agreement.effectiveFrom),
      )
      .sort((a, b) => a.effectiveFrom.toString().localeCompare(b.effectiveFrom.toString()));

    return candidates.at(-1) ?? null;
  }
}
