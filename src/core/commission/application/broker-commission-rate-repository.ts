import type { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';

export interface BrokerCommissionRateRepository {
  save(rate: BrokerCommissionRate): Promise<void>;
  findByBrokerId(brokerId: string): Promise<BrokerCommissionRate | null>;
  /** The whole table (IN-05), by broker, so a reading is repeatable. */
  list(): Promise<readonly BrokerCommissionRate[]>;
}
