import { Percentage } from '../../proposal/domain/percentage.ts';
import { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';
import type { BrokerCommissionRateRepository } from './broker-commission-rate-repository.ts';
import {
  type BrokerCommissionRateView,
  toBrokerCommissionRateView,
} from './broker-commission-rate-view.ts';

export interface RegisterBrokerCommissionRateInput {
  readonly brokerId: string;
  readonly rate: string;
}

export interface RegisterBrokerCommissionRateDependencies {
  readonly brokerRates: BrokerCommissionRateRepository;
  readonly now: () => Date;
}

/** IN-05: the Administrator maintains the broker's commission table. */
export class RegisterBrokerCommissionRate {
  private readonly deps: RegisterBrokerCommissionRateDependencies;

  constructor(deps: RegisterBrokerCommissionRateDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterBrokerCommissionRateInput): Promise<BrokerCommissionRateView> {
    const rate = BrokerCommissionRate.register({
      brokerId: input.brokerId,
      rate: Percentage.fromString(input.rate),
      registeredAt: this.deps.now(),
    });

    await this.deps.brokerRates.save(rate);

    return toBrokerCommissionRateView(rate);
  }
}
