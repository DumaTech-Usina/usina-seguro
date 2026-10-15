import type { Broker } from '../domain/broker.ts';
import type { BrokerRepository } from './broker-repository.ts';
import { type BrokerView, toBrokerView } from './broker-view.ts';

export interface ListBrokersInput {
  /** REQ-306: part of the name, or digits of the CPF; absent or blank lists every broker. */
  readonly query?: string | undefined;
}

export interface ListBrokersDependencies {
  readonly brokers: BrokerRepository;
}

/**
 * REQ-306: the brokers, searched by name or CPF.
 *
 * The name matches by part, ignoring case; the CPF matches by its digits, by
 * part, with or without punctuation. The matching is done here and not in the
 * driver so both drivers answer the same thing.
 */
export class ListBrokers {
  private readonly deps: ListBrokersDependencies;

  constructor(deps: ListBrokersDependencies) {
    this.deps = deps;
  }

  async execute(input: ListBrokersInput = {}): Promise<readonly BrokerView[]> {
    const brokers = await this.deps.brokers.list();

    return brokers.filter((broker) => matches(broker, input.query)).map(toBrokerView);
  }
}

function matches(broker: Broker, query: string | undefined): boolean {
  const wanted = query?.trim() ?? '';

  if (wanted === '') {
    return true;
  }

  const digits = wanted.replace(/[.-]/g, '');

  return (
    broker.name.toLowerCase().includes(wanted.toLowerCase()) ||
    (/^\d+$/.test(digits) && broker.cpf.digits.includes(digits))
  );
}
