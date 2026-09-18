import type { CalendarDate } from '../../policy/domain/calendar-date.ts';
import type { CommissionAgreement } from '../domain/commission-agreement.ts';

export interface CommissionAgreementRepository {
  save(agreement: CommissionAgreement): Promise<void>;
  /**
   * The agreement in force for the insurer and product on that day (REQ-065):
   * the most recent one whose validity started on or before it.
   *
   * Selecting by date is what keeps a later edit out of a calculation already
   * made (CA-012): a new agreement is a new record with a new start, never a
   * rewrite of the previous one (REQ-124).
   */
  findInForce(
    insurerId: string,
    productId: string,
    on: CalendarDate,
  ): Promise<CommissionAgreement | null>;
}
