import type { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';

/**
 * Representation of the broker's commission table at the core boundary (IN-05,
 * REQ-093).
 *
 * One rate per broker, as the aggregate holds it: no requirement makes the
 * table vary by insurer, product or period, so there is no dimension to expose
 * here either. `registeredAt` is the moment the current value was written —
 * re-registering a broker replaces the rate, and this is what says when.
 */
export interface BrokerCommissionRateView {
  readonly brokerId: string;
  readonly rate: string;
  readonly registeredAt: string;
}

export function toBrokerCommissionRateView(rate: BrokerCommissionRate): BrokerCommissionRateView {
  return {
    brokerId: rate.brokerId,
    rate: rate.rate.toString(),
    registeredAt: rate.registeredAt.toISOString(),
  };
}
