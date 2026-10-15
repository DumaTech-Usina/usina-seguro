import type { BrokerRepository } from '../../../core/registry/application/broker-repository.ts';
import type { Broker } from '../../../core/registry/domain/broker.ts';

export class InMemoryBrokerRepository implements BrokerRepository {
  private readonly records = new Map<string, Broker>();

  async save(broker: Broker): Promise<void> {
    this.records.set(broker.id, broker);
  }

  async findById(id: string): Promise<Broker | null> {
    return this.records.get(id) ?? null;
  }

  async findByCpf(digits: string): Promise<Broker | null> {
    return [...this.records.values()].find((broker) => broker.cpf.digits === digits) ?? null;
  }

  /** By current name, then by id. Code-unit order, as SQLite orders `TEXT`. */
  async list(): Promise<readonly Broker[]> {
    return [...this.records.values()].sort(
      (a, b) => compare(a.name, b.name) || compare(a.id, b.id),
    );
  }
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
