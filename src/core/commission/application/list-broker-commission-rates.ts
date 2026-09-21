import type { BrokerCommissionRateRepository } from './broker-commission-rate-repository.ts';
import {
  type BrokerCommissionRateView,
  toBrokerCommissionRateView,
} from './broker-commission-rate-view.ts';

export interface ListBrokerCommissionRatesDependencies {
  readonly brokerRates: BrokerCommissionRateRepository;
}

/**
 * IN-05: the broker commission table as it stands.
 *
 * REQ-093 applies this percentage to the base of REQ-062..REQ-064, so it is
 * the number that decides what the Usina owes every broker. Reading it back is
 * what lets an administrator see that a broker has no rate at all — which is
 * why the transfer of that broker's business is refused — instead of finding
 * out at the moment a policy is registered.
 */
export class ListBrokerCommissionRates {
  private readonly deps: ListBrokerCommissionRatesDependencies;

  constructor(deps: ListBrokerCommissionRatesDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly BrokerCommissionRateView[]> {
    const rates = await this.deps.brokerRates.list();

    return rates.map(toBrokerCommissionRateView);
  }
}
