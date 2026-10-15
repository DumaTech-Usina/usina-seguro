import { Authorship } from '../../proposal/domain/authorship.ts';
import type { ClientRepository } from './client-repository.ts';
import { type ClientView, toClientView } from './client-view.ts';
import { findClient } from './get-client.ts';
import { assertClientCpfFree } from './register-client.ts';

export interface ChangeClientInput {
  readonly clientId: string;
  readonly name: string;
  readonly cpf: string;
  /** REQ-216, REQ-314: the session's user. */
  readonly userId: string;
}

export interface ChangeClientDependencies {
  readonly clients: ClientRepository;
  readonly now: () => Date;
}

/** REQ-313, REQ-314: name and CPF change, signed, and the history grows. */
export class ChangeClient {
  private readonly deps: ChangeClientDependencies;

  constructor(deps: ChangeClientDependencies) {
    this.deps = deps;
  }

  async execute(input: ChangeClientInput): Promise<ClientView> {
    const client = (await findClient(this.deps.clients, input.clientId)).change({
      name: input.name,
      cpf: input.cpf,
      signed: Authorship.of(input.userId, this.deps.now()),
    });

    await assertClientCpfFree(this.deps.clients, client);
    await this.deps.clients.save(client);

    return toClientView(client);
  }
}
