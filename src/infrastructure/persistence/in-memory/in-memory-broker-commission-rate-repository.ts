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
}
