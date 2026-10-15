import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Client } from '../domain/client.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import type { ClientRepository } from './client-repository.ts';
import { type ClientView, toClientView } from './client-view.ts';

export interface RegisterClientInput {
  readonly name: string;
  readonly cpf: string;
  /** REQ-216, REQ-314: the session's user. */
  readonly userId: string;
}

export interface RegisterClientDependencies {
  readonly clients: ClientRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/** REQ-311, REQ-312, REQ-314: a user registers a client, signed. */
export class RegisterClient {
  private readonly deps: RegisterClientDependencies;

  constructor(deps: RegisterClientDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterClientInput): Promise<ClientView> {
    const client = Client.register({
      id: this.deps.newId(),
      name: input.name,
      cpf: input.cpf,
      signed: Authorship.of(input.userId, this.deps.now()),
    });

    await assertClientCpfFree(this.deps.clients, client);
    await this.deps.clients.save(client);

    return toClientView(client);
  }
}

/** REQ-312, REJ-312: no other client holds the CPF this one now has. */
export async function assertClientCpfFree(
  clients: ClientRepository,
  client: Client,
): Promise<void> {
  const holder = await clients.findByCpf(client.cpf.digits);

  if (holder !== null && holder.id !== client.id) {
    throw new BusinessRuleViolation('REQ-312', REGISTRY_MESSAGES.CLIENT_CPF_TAKEN);
  }
}
