import { RecordNotFound } from '../../proposal/domain/errors.ts';
import type { Broker } from '../domain/broker.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import type { BrokerRepository } from './broker-repository.ts';
import { type BrokerView, toBrokerView } from './broker-view.ts';

export interface GetBrokerDependencies {
  readonly brokers: BrokerRepository;
}

/** A broker with its whole signed history (REQ-304). */
export class GetBroker {
  private readonly deps: GetBrokerDependencies;

  constructor(deps: GetBrokerDependencies) {
    this.deps = deps;
  }

  async execute(input: { readonly brokerId: string }): Promise<BrokerView> {
    return toBrokerView(await findBroker(this.deps.brokers, input.brokerId));
  }
}

export async function findBroker(brokers: BrokerRepository, id: string): Promise<Broker> {
  const broker = await brokers.findById(id);

  if (broker === null) {
    throw new RecordNotFound(REGISTRY_MESSAGES.BROKER_NOT_FOUND, { id });
  }

  return broker;
}
