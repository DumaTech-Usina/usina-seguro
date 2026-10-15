import type { ClientRepository } from '../../../core/registry/application/client-repository.ts';
import type { Client } from '../../../core/registry/domain/client.ts';

export class InMemoryClientRepository implements ClientRepository {
  private readonly records = new Map<string, Client>();

  async save(client: Client): Promise<void> {
    this.records.set(client.id, client);
  }

  async findById(id: string): Promise<Client | null> {
    return this.records.get(id) ?? null;
  }

  async findByCpf(digits: string): Promise<Client | null> {
    return [...this.records.values()].find((client) => client.cpf.digits === digits) ?? null;
  }

  /** By current name, then by id. Code-unit order, as SQLite orders `TEXT`. */
  async list(): Promise<readonly Client[]> {
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
