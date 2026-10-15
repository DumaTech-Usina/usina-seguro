import { Authorship } from '../../proposal/domain/authorship.ts';
import type { BrokerRepository } from './broker-repository.ts';
import { type BrokerView, toBrokerView } from './broker-view.ts';
import { findBroker } from './get-broker.ts';
import { assertCpfFree } from './register-broker.ts';

export interface ChangeBrokerInput {
  readonly brokerId: string;
  readonly name: string;
  readonly cpf: string;
  /** REQ-216, REQ-304: the session's user. */
  readonly userId: string;
}

export interface ChangeBrokerDependencies {
  readonly brokers: BrokerRepository;
  readonly now: () => Date;
}

/** REQ-303, REQ-304: name and CPF change, signed, and the history grows. */
export class ChangeBroker {
  private readonly deps: ChangeBrokerDependencies;

  constructor(deps: ChangeBrokerDependencies) {
    this.deps = deps;
  }

  async execute(input: ChangeBrokerInput): Promise<BrokerView> {
    const broker = (await findBroker(this.deps.brokers, input.brokerId)).change({
      name: input.name,
      cpf: input.cpf,
      signed: Authorship.of(input.userId, this.deps.now()),
    });

    await assertCpfFree(this.deps.brokers, broker);
    await this.deps.brokers.save(broker);

    return toBrokerView(broker);
  }
}
