import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Broker } from '../domain/broker.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import type { BrokerRepository } from './broker-repository.ts';
import { type BrokerView, toBrokerView } from './broker-view.ts';

export interface RegisterBrokerInput {
  readonly name: string;
  readonly cpf: string;
  /** REQ-216, REQ-304: the session's user. */
  readonly userId: string;
}

export interface RegisterBrokerDependencies {
  readonly brokers: BrokerRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/** REQ-300–REQ-302, REQ-304: a user registers a broker, signed. */
export class RegisterBroker {
  private readonly deps: RegisterBrokerDependencies;

  constructor(deps: RegisterBrokerDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterBrokerInput): Promise<BrokerView> {
    const broker = Broker.register({
      id: this.deps.newId(),
      name: input.name,
      cpf: input.cpf,
      signed: Authorship.of(input.userId, this.deps.now()),
    });

    await assertCpfFree(this.deps.brokers, broker);
    await this.deps.brokers.save(broker);

    return toBrokerView(broker);
  }
}

/** REQ-302, REJ-302: no other broker holds the CPF this one now has. */
export async function assertCpfFree(brokers: BrokerRepository, broker: Broker): Promise<void> {
  const holder = await brokers.findByCpf(broker.cpf.digits);

  if (holder !== null && holder.id !== broker.id) {
    throw new BusinessRuleViolation('REQ-302', REGISTRY_MESSAGES.BROKER_CPF_TAKEN);
  }
}
