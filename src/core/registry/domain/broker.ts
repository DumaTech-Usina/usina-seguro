import type { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Cpf } from './cpf.ts';
import { REGISTRY_MESSAGES } from './errors.ts';

/** One signed record of the broker's history (REQ-304): who, when, name and CPF. */
export interface BrokerRecord {
  readonly name: string;
  readonly cpf: Cpf;
  readonly signed: Authorship;
}

export interface BrokerRegistration {
  readonly id: string;
  readonly name: string;
  /** As informed: with or without punctuation (REQ-301). */
  readonly cpf: string;
  readonly signed: Authorship;
}

export interface BrokerChange {
  readonly name: string;
  readonly cpf: string;
  readonly signed: Authorship;
}

export interface BrokerData {
  readonly id: string;
  /** Oldest first; never empty. */
  readonly records: readonly BrokerRecord[];
}

/**
 * A broker registered by a user of the Usina (V2 section 9D).
 *
 * The history is the broker: the registration is its first record and every
 * change appends one (REQ-303, REQ-304), so the current name and CPF are those
 * of the last record and nothing earlier is ever rewritten. There is no
 * removal (REQ-305). Whether a CPF is already taken by another broker
 * (REQ-302) is a question about the whole registry, answered by the use cases.
 */
export class Broker {
  readonly id: string;
  readonly records: readonly BrokerRecord[];

  private constructor(data: BrokerData) {
    this.id = data.id;
    this.records = data.records;
  }

  static register(registration: BrokerRegistration): Broker {
    return new Broker({
      id: registration.id,
      records: [recordOf(registration)],
    });
  }

  /** Rebuilds a persisted broker without re-applying the rules (REQ-124). */
  static restore(data: BrokerData): Broker {
    return new Broker(data);
  }

  get current(): BrokerRecord {
    return this.records[this.records.length - 1] as BrokerRecord;
  }

  get name(): string {
    return this.current.name;
  }

  get cpf(): Cpf {
    return this.current.cpf;
  }

  /** REQ-303: name and CPF change under the registration rules, signed (REQ-304). */
  change(change: BrokerChange): Broker {
    return new Broker({ id: this.id, records: [...this.records, recordOf(change)] });
  }
}

function recordOf(input: BrokerChange): BrokerRecord {
  const name = input.name.trim();

  if (name === '') {
    throw new BusinessRuleViolation('REQ-300', REGISTRY_MESSAGES.BROKER_NAME_REQUIRED);
  }

  return { name, cpf: Cpf.parse(input.cpf), signed: input.signed };
}
