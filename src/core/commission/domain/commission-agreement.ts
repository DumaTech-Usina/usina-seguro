import type { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

/**
 * Which amount the broker's commission is calculated on (REQ-062..REQ-064).
 *
 * - `USINA`: the amount the Usina received. Always the case without an
 *   intermediary (REQ-062, CA-010), and selectable with one (REQ-064).
 * - `INTERMEDIARY`: the amount the intermediary received from the insurer.
 *   The default when there is an intermediary (REQ-063, CA-011).
 */
export type BrokerBase = 'USINA' | 'INTERMEDIARY';

/**
 * The two chain configurations of REQ-060, held as data because REQ-061 and
 * REQ-125 require them to be configurable without a code change.
 *
 * ```
 * DIRECT:       Insurer --insurerRate--> Usina --brokerRate--> Broker
 * INTERMEDIARY: Insurer --insurerRate--> Intermediary --intermediaryRate--> Usina
 *                                                          --brokerRate--> Broker
 * ```
 */
export type CommissionChain =
  | { readonly kind: 'DIRECT' }
  | {
      readonly kind: 'INTERMEDIARY';
      readonly intermediaryId: string;
      /** REQ-069: share of the intermediary's amount that reaches the Usina. */
      readonly intermediaryRate: Percentage;
      /** REQ-063 default, REQ-064 configurable per intermediary. */
      readonly brokerBase: BrokerBase;
    };

export interface CommissionAgreementData {
  readonly id: string;
  /** REQ-065: the rates vary by insurer and by product. */
  readonly insurerId: string;
  readonly productId: string;
  /**
   * REQ-065: the agreement has a period of validity. Combined with the rates
   * copied onto each commission, it is what keeps an edit from reaching a
   * calculation already made (CA-012, REJ-011).
   */
  readonly effectiveFrom: CalendarDate;
  /** Percentage the insurer pays over the policy premium (REQ-068, REQ-069). */
  readonly insurerRate: Percentage;
  readonly chain: CommissionChain;
  readonly registeredAt: Date;
}

/**
 * Commercial agreement in force for an insurer and a product (IN-02, IN-03,
 * IN-04, REQ-065).
 *
 * It is cadastral data maintained by the Administrator (ATR-003), not code
 * (REQ-061, REQ-125). The chain lives on the agreement rather than on a
 * registry of its own: REQ-060 scopes it to the Usina-insurer relation, and no
 * confirmed requirement asks the system to enforce that two products of the
 * same insurer agree on it.
 */
export class CommissionAgreement {
  readonly id: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly effectiveFrom: CalendarDate;
  readonly insurerRate: Percentage;
  readonly chain: CommissionChain;
  readonly registeredAt: Date;

  private constructor(data: CommissionAgreementData) {
    this.id = data.id;
    this.insurerId = data.insurerId;
    this.productId = data.productId;
    this.effectiveFrom = data.effectiveFrom;
    this.insurerRate = data.insurerRate;
    this.chain = data.chain;
    this.registeredAt = data.registeredAt;
  }

  static register(data: CommissionAgreementData): CommissionAgreement {
    for (const [field, value] of [
      ['insurerId', data.insurerId],
      ['productId', data.productId],
    ] as const) {
      if (value.trim() === '') {
        throw new BusinessRuleViolation('REQ-065', COMMISSION_MESSAGES.AGREEMENT_FIELD_REQUIRED, {
          field,
        });
      }
    }

    if (data.chain.kind === 'INTERMEDIARY' && data.chain.intermediaryId.trim() === '') {
      throw new BusinessRuleViolation('REQ-060', COMMISSION_MESSAGES.INTERMEDIARY_REQUIRED);
    }

    return new CommissionAgreement(data);
  }

  /** Rebuilds a persisted agreement without re-applying the rules (REQ-124). */
  static restore(data: CommissionAgreementData): CommissionAgreement {
    return new CommissionAgreement(data);
  }
}
