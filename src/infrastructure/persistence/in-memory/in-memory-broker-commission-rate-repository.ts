import type { BrokerCommissionRateRepository } from '../../../core/commission/application/broker-commission-rate-repository.ts';
import type { BrokerCommissionRate } from '../../../core/commission/domain/broker-commission-rate.ts';

export class InMemoryBrokerCommissionRateRepository implements BrokerCommissionRateRepository {
  private readonly records = new Map<string, BrokerCommissionRate>();

  async save(rate: BrokerCommissionRate): Promise<void> {
    this.records.set(rate.brokerId, rate);
  }

  async findByBrokerId(brokerId: string): Promise<BrokerCommissionRate | null> {
    return this.records.get(brokerId) ?? null;
  }

  /** IN-05, by broker. Code-unit order, as SQLite orders `TEXT` by bytes. */
  async list(): Promise<readonly BrokerCommissionRate[]> {
    return [...this.records.values()].sort((a, b) => (a.brokerId < b.brokerId ? -1 : 1));
  }
}
