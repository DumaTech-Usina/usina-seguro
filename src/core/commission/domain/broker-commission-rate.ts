import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import { COMMISSION_MESSAGES } from './errors.ts';

export interface BrokerCommissionRateData {
  readonly brokerId: string;
  readonly rate: Percentage;
  readonly registeredAt: Date;
}

/**
 * The broker's commission table (IN-05).
 *
 * REQ-093 states the transfer is this percentage applied to the base of
 * REQ-062/REQ-063/REQ-064. The document says nothing about the table varying
 * by insurer, product or period, so it is one rate per broker: any further
 * dimension would be an invented rule. Non-retroactivity is already covered by
 * copying the rate onto the commission at calculation time (REJ-011).
 */
export class BrokerCommissionRate {
  readonly brokerId: string;
  readonly rate: Percentage;
  readonly registeredAt: Date;

  private constructor(data: BrokerCommissionRateData) {
    this.brokerId = data.brokerId;
    this.rate = data.rate;
    this.registeredAt = data.registeredAt;
  }

  static register(data: BrokerCommissionRateData): BrokerCommissionRate {
    if (data.brokerId.trim() === '') {
      throw new BusinessRuleViolation('REQ-093', COMMISSION_MESSAGES.BROKER_RATE_FIELD_REQUIRED, {
        field: 'brokerId',
      });
    }

    return new BrokerCommissionRate(data);
  }

  /** Rebuilds a persisted rate without re-applying the rules (REQ-124). */
  static restore(data: BrokerCommissionRateData): BrokerCommissionRate {
    return new BrokerCommissionRate(data);
  }
}
