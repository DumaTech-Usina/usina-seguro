import type { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Cpf } from './cpf.ts';
import { REGISTRY_MESSAGES } from './errors.ts';

/** One signed record of the client's history (REQ-314): who, when, name and CPF. */
export interface ClientRecord {
  readonly name: string;
  readonly cpf: Cpf;
  readonly signed: Authorship;
}

export interface ClientRegistration {
  readonly id: string;
  readonly name: string;
  /** As informed: with or without punctuation (REQ-312). */
  readonly cpf: string;
  readonly signed: Authorship;
}

export interface ClientChange {
  readonly name: string;
  readonly cpf: string;
  readonly signed: Authorship;
}

export interface ClientData {
  readonly id: string;
  /** Oldest first; never empty. */
  readonly records: readonly ClientRecord[];
}

/**
 * A client of the Usina (V2 section 9E). Only referenced: proposals point at
 * it, and nothing belongs to it.
 *
 * The same shape as `Broker` because V2 gives it the same rules: the history
 * is the client, the registration is its first record and every change appends
 * one (REQ-313, REQ-314). There is no removal (REQ-315). Whether a CPF is
 * already taken by another client (REQ-312) is a question about the whole
 * registry, answered by the use cases.
 */
export class Client {
  readonly id: string;
  readonly records: readonly ClientRecord[];

  private constructor(data: ClientData) {
    this.id = data.id;
    this.records = data.records;
  }

  static register(registration: ClientRegistration): Client {
    return new Client({
      id: registration.id,
      records: [recordOf(registration)],
    });
  }

  /** Rebuilds a persisted client without re-applying the rules (REQ-124). */
  static restore(data: ClientData): Client {
    return new Client(data);
  }

  get current(): ClientRecord {
    return this.records[this.records.length - 1] as ClientRecord;
  }

  get name(): string {
    return this.current.name;
  }

  get cpf(): Cpf {
    return this.current.cpf;
  }

  /** REQ-313: name and CPF change under the registration rules, signed (REQ-314). */
  change(change: ClientChange): Client {
    return new Client({ id: this.id, records: [...this.records, recordOf(change)] });
  }
}

function recordOf(input: ClientChange): ClientRecord {
  const name = input.name.trim();

  if (name === '') {
    throw new BusinessRuleViolation('REQ-311', REGISTRY_MESSAGES.CLIENT_NAME_REQUIRED);
  }

  return { name, cpf: Cpf.parse(input.cpf, 'CLIENT'), signed: input.signed };
}
