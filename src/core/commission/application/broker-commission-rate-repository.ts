import type { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';

export interface BrokerCommissionRateRepository {
  save(rate: BrokerCommissionRate): Promise<void>;
  findByBrokerId(brokerId: string): Promise<BrokerCommissionRate | null>;
}
