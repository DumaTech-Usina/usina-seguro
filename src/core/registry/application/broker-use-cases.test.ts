import { describe, expect, it } from 'vitest';
import { InMemoryBrokerRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import { brokerNameOf } from './broker-name.ts';
import { ChangeBroker } from './change-broker.ts';
import { GetBroker } from './get-broker.ts';
import { ListBrokers } from './list-brokers.ts';
import { RegisterBroker } from './register-broker.ts';

function setUp() {
  const brokers = new InMemoryBrokerRepository();
  let sequence = 0;
  let clock = Date.parse('2026-10-15T12:00:00.000Z');
  const now = () => {
    clock += 1000;
    return new Date(clock);
  };

  return {
    brokers,
    register: new RegisterBroker({ brokers, newId: () => `broker-${++sequence}`, now }),
    change: new ChangeBroker({ brokers, now }),
    get: new GetBroker({ brokers }),
    list: new ListBrokers({ brokers }),
  };
}

async function refusal(promise: Promise<unknown>): Promise<BusinessRuleViolation> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BusinessRuleViolation);
  return error as BusinessRuleViolation;
}

describe('RegisterBroker (REQ-300–REQ-302, REQ-304)', () => {
  it('registers a broker signed by the user, with the CPF as digits (CA-300)', async () => {
    const { register, get } = setUp();

    const view = await register.execute({
      name: 'Ana Silva',
      cpf: '529.982.247-25',
      userId: 'user-1',
    });

    expect(view).toMatchObject({ id: 'broker-1', name: 'Ana Silva', cpf: '52998224725' });
    expect(view.history).toEqual([
      {
        name: 'Ana Silva',
        cpf: '52998224725',
        signedBy: 'user-1',
        signedAt: '2026-10-15T12:00:01.000Z',
      },
    ]);
    expect(await get.execute({ brokerId: 'broker-1' })).toEqual(view);
  });

  it('refuses a second broker with the same CPF (CA-301, REJ-302)', async () => {
    const { register } = setUp();
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });

    const violation = await refusal(
      register.execute({ name: 'Outra Ana', cpf: '529.982.247-25', userId: 'user-1' }),
    );

    expect(violation.rule).toBe('REQ-302');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.BROKER_CPF_TAKEN);
  });

  it('refuses a broker without a signature (REQ-216)', async () => {
    const { register } = setUp();

    await refusal(register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: ' ' }));
  });
});

describe('ChangeBroker (REQ-303, REQ-304)', () => {
  it('appends a signed record and keeps the earlier one (CA-302)', async () => {
    const { register, change } = setUp();
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });

    const view = await change.execute({
      brokerId: 'broker-1',
      name: 'Ana Silva Souza',
      cpf: '52998224725',
      userId: 'user-2',
    });

    expect(view.name).toBe('Ana Silva Souza');
    expect(view.history.map((record) => [record.name, record.signedBy])).toEqual([
      ['Ana Silva', 'user-1'],
      ['Ana Silva Souza', 'user-2'],
    ]);
  });

  it('refuses a CPF another broker holds, but not the broker keeping its own (CA-301)', async () => {
    const { register, change } = setUp();
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });
    await register.execute({ name: 'Bruno Lima', cpf: '11144477735', userId: 'user-1' });

    const violation = await refusal(
      change.execute({ brokerId: 'broker-2', name: 'Bruno', cpf: '52998224725', userId: 'u' }),
    );
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.BROKER_CPF_TAKEN);

    await expect(
      change.execute({ brokerId: 'broker-2', name: 'Bruno', cpf: '111.444.777-35', userId: 'u' }),
    ).resolves.toMatchObject({ name: 'Bruno' });
  });

  it('answers not found for an unknown broker', async () => {
    const { change } = setUp();

    await expect(
      change.execute({ brokerId: 'nope', name: 'Ana', cpf: '52998224725', userId: 'u' }),
    ).rejects.toBeInstanceOf(RecordNotFound);
  });
});

describe('ListBrokers (REQ-306)', () => {
  it('finds by part of the name ignoring case, or by CPF digits with or without punctuation (CA-303)', async () => {
    const { register, list } = setUp();
    await register.execute({ name: 'Bruno Lima', cpf: '11144477735', userId: 'user-1' });
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });

    const names = async (query?: string) =>
      (await list.execute({ query })).map((broker) => broker.name);

    expect(await names()).toEqual(['Ana Silva', 'Bruno Lima']);
    expect(await names('  ')).toEqual(['Ana Silva', 'Bruno Lima']);
    expect(await names('silva')).toEqual(['Ana Silva']);
    expect(await names('529.982')).toEqual(['Ana Silva']);
    expect(await names('529982')).toEqual(['Ana Silva']);
    expect(await names('777-35')).toEqual(['Bruno Lima']);
    expect(await names('Carlos')).toEqual([]);
  });
});

describe('brokerNameOf (REQ-308, REQ-309)', () => {
  it('answers the current name of a registered broker', async () => {
    const { brokers, register, change } = setUp();
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });
    await change.execute({ brokerId: 'broker-1', name: 'Ana S.', cpf: '52998224725', userId: 'u' });

    expect(await brokerNameOf(brokers, 'broker-1')).toBe('Ana S.');
  });

  it('answers the text itself for a proposal registered before the registry', async () => {
    const { brokers } = setUp();

    expect(await brokerNameOf(brokers, 'Corretora Antiga')).toBe('Corretora Antiga');
  });
});
