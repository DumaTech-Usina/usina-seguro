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
  /**
   * Every agreement registered, grouped by the pair it applies to (IN-02).
   *
   * The order is part of the contract, not an accident of the driver: insurer,
   * then product, then the most recent validity first. REQ-065 scopes an
   * agreement to an insurer and a product, and REQ-124 keeps each validity as
   * a record of its own, so the pair is what a reader looks for and the
   * validities below it are its history.
   *
   * There is no filter. REQ-065 asks for the registry to be maintained and no
   * requirement narrows the reading of it; the registry is small by nature,
   * one row per insurer, product and validity.
   */
  list(): Promise<readonly CommissionAgreement[]>;
}
