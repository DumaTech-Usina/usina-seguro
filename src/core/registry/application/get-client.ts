import { RecordNotFound } from '../../proposal/domain/errors.ts';
import type { Client } from '../domain/client.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import type { ClientRepository } from './client-repository.ts';
import { type ClientView, toClientView } from './client-view.ts';

export interface GetClientDependencies {
  readonly clients: ClientRepository;
}

/** A client with its whole signed history (REQ-314). */
export class GetClient {
  private readonly deps: GetClientDependencies;

  constructor(deps: GetClientDependencies) {
    this.deps = deps;
  }

  async execute(input: { readonly clientId: string }): Promise<ClientView> {
    return toClientView(await findClient(this.deps.clients, input.clientId));
  }
}

export async function findClient(clients: ClientRepository, id: string): Promise<Client> {
  const client = await clients.findById(id);

  if (client === null) {
    throw new RecordNotFound(REGISTRY_MESSAGES.CLIENT_NOT_FOUND, { id });
  }

  return client;
}
