import { Authorship } from '../../proposal/domain/authorship.ts';
import { Client } from '../domain/client.ts';
import type { ClientRepository } from './client-repository.ts';

export interface ResolveClientInput {
  readonly name: string;
  readonly cpf: string;
  /** REQ-216, REQ-314: who registers the proposal signs a client it creates. */
  readonly userId: string;
}

export interface ResolveClientDependencies {
  readonly clients: ClientRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-317: the client of a proposal being registered, from the name and CPF
 * the user typed. Answers the client's id.
 *
 * The name and the CPF are checked first, as a new client's would be, so a
 * proposal without either is refused whether or not the CPF is known
 * (REJ-310). Then the client holding the CPF is the answer, as it is stored —
 * the typed name never overwrites it (REJ-314). Only when nobody holds the CPF
 * is a client registered, signed by whoever registers the proposal.
 *
 * Atomicity with the proposal is the caller's: `RegisterProposal` runs this
 * inside its transaction (CA-314).
 */
export class ResolveClient {
  private readonly deps: ResolveClientDependencies;

  constructor(deps: ResolveClientDependencies) {
    this.deps = deps;
  }

  async execute(input: ResolveClientInput): Promise<string> {
    const candidate = Client.register({
      id: this.deps.newId(),
      name: input.name,
      cpf: input.cpf,
      signed: Authorship.of(input.userId, this.deps.now()),
    });

    const holder = await this.deps.clients.findByCpf(candidate.cpf.digits);

    if (holder !== null) {
      return holder.id;
    }

    try {
      await this.deps.clients.save(candidate);
    } catch (error) {
      // REQ-312 is also a constraint of the store: another registration may
      // have taken the CPF between the lookup and the save. That client is
      // the answer, as it is (CA-314); any other failure is not ours to hide.
      const winner = await this.deps.clients.findByCpf(candidate.cpf.digits);

      if (winner === null) {
        throw error;
      }

      return winner.id;
    }

    return candidate.id;
  }
}
