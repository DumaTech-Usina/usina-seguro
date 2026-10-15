import { describe, expect, it } from 'vitest';
import { InMemoryClientRepository } from '../../../infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Client } from '../domain/client.ts';
import { REGISTRY_MESSAGES } from '../domain/errors.ts';
import { ChangeClient } from './change-client.ts';
import { clientNameOf } from './client-name.ts';
import type { ClientRepository } from './client-repository.ts';
import { GetClient } from './get-client.ts';
import { ListClients } from './list-clients.ts';
import { RegisterClient } from './register-client.ts';
import { ResolveClient } from './resolve-client.ts';

function setUp() {
  const clients = new InMemoryClientRepository();
  let sequence = 0;
  let clock = Date.parse('2026-10-15T12:00:00.000Z');
  const newId = () => `client-${++sequence}`;
  const now = () => {
    clock += 1000;
    return new Date(clock);
  };

  return {
    clients,
    register: new RegisterClient({ clients, newId, now }),
    change: new ChangeClient({ clients, now }),
    get: new GetClient({ clients }),
    list: new ListClients({ clients }),
    resolve: new ResolveClient({ clients, newId, now }),
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

describe('RegisterClient (REQ-311, REQ-312, REQ-314)', () => {
  it('registers a client signed by the user, with the CPF as digits (CA-310)', async () => {
    const { register, get } = setUp();

    const view = await register.execute({
      name: 'Maria Souza',
      cpf: '529.982.247-25',
      userId: 'user-1',
    });

    expect(view).toMatchObject({ id: 'client-1', name: 'Maria Souza', cpf: '52998224725' });
    expect(view.history).toEqual([
      {
        name: 'Maria Souza',
        cpf: '52998224725',
        signedBy: 'user-1',
        signedAt: '2026-10-15T12:00:01.000Z',
      },
    ]);
    expect(await get.execute({ clientId: 'client-1' })).toEqual(view);
  });

  it('refuses a second client with the same CPF (CA-311, REJ-312)', async () => {
    const { register } = setUp();
    await register.execute({ name: 'Maria Souza', cpf: '52998224725', userId: 'user-1' });

    const violation = await refusal(
      register.execute({ name: 'Outra Maria', cpf: '529.982.247-25', userId: 'user-1' }),
    );

    expect(violation.rule).toBe('REQ-312');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_CPF_TAKEN);
  });

  it('refuses a client without a signature (REQ-216)', async () => {
    const { register } = setUp();

    await refusal(register.execute({ name: 'Maria', cpf: '52998224725', userId: ' ' }));
  });
});

describe('ChangeClient (REQ-313, REQ-314)', () => {
  it('appends a signed record and keeps the earlier one (CA-312)', async () => {
    const { register, change } = setUp();
    await register.execute({ name: 'Maria Souza', cpf: '52998224725', userId: 'user-1' });

    const view = await change.execute({
      clientId: 'client-1',
      name: 'Maria Souza Lima',
      cpf: '52998224725',
      userId: 'user-2',
    });

    expect(view.name).toBe('Maria Souza Lima');
    expect(view.history.map((record) => [record.name, record.signedBy])).toEqual([
      ['Maria Souza', 'user-1'],
      ['Maria Souza Lima', 'user-2'],
    ]);
  });

  it('refuses a CPF another client holds, but not the client keeping its own (CA-311)', async () => {
    const { register, change } = setUp();
    await register.execute({ name: 'Maria Souza', cpf: '52998224725', userId: 'user-1' });
    await register.execute({ name: 'Bruno Lima', cpf: '11144477735', userId: 'user-1' });

    const violation = await refusal(
      change.execute({ clientId: 'client-2', name: 'Bruno', cpf: '52998224725', userId: 'u' }),
    );
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_CPF_TAKEN);

    await expect(
      change.execute({ clientId: 'client-2', name: 'Bruno', cpf: '111.444.777-35', userId: 'u' }),
    ).resolves.toMatchObject({ name: 'Bruno' });
  });

  it('answers not found for an unknown client', async () => {
    const { change } = setUp();

    await expect(
      change.execute({ clientId: 'nope', name: 'Maria', cpf: '52998224725', userId: 'u' }),
    ).rejects.toBeInstanceOf(RecordNotFound);
  });
});

describe('ListClients (REQ-316)', () => {
  it('finds by part of the name ignoring case, or by CPF digits with or without punctuation', async () => {
    const { register, list } = setUp();
    await register.execute({ name: 'Bruno Lima', cpf: '11144477735', userId: 'user-1' });
    await register.execute({ name: 'Ana Silva', cpf: '52998224725', userId: 'user-1' });

    const names = async (query?: string) =>
      (await list.execute({ query })).map((client) => client.name);

    expect(await names()).toEqual(['Ana Silva', 'Bruno Lima']);
    expect(await names('  ')).toEqual(['Ana Silva', 'Bruno Lima']);
    expect(await names('silva')).toEqual(['Ana Silva']);
    expect(await names('529.982')).toEqual(['Ana Silva']);
    expect(await names('529982')).toEqual(['Ana Silva']);
    expect(await names('777-35')).toEqual(['Bruno Lima']);
    expect(await names('Carlos')).toEqual([]);
  });
});

describe('ResolveClient (REQ-317)', () => {
  it('registers a new client, signed by whoever registers the proposal (CA-313)', async () => {
    const { resolve, get } = setUp();

    const id = await resolve.execute({ name: 'Maria Souza', cpf: '529.982.247-25', userId: 'u-1' });

    expect(await get.execute({ clientId: id })).toMatchObject({
      name: 'Maria Souza',
      cpf: '52998224725',
      history: [{ signedBy: 'u-1' }],
    });
  });

  it('answers the client already holding the CPF, without changing it (CA-313, REJ-314)', async () => {
    const { register, resolve, get, list } = setUp();
    const existing = await register.execute({
      name: 'Maria Souza',
      cpf: '52998224725',
      userId: 'u-1',
    });

    const id = await resolve.execute({ name: 'M. Souza', cpf: '529.982.247-25', userId: 'u-2' });

    expect(id).toBe(existing.id);
    expect(await get.execute({ clientId: id })).toEqual(existing);
    expect(await list.execute()).toHaveLength(1);
  });

  it('refuses a missing name even when the CPF is known (REJ-310)', async () => {
    const { register, resolve } = setUp();
    await register.execute({ name: 'Maria Souza', cpf: '52998224725', userId: 'u-1' });

    const violation = await refusal(
      resolve.execute({ name: ' ', cpf: '52998224725', userId: 'u' }),
    );

    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_NAME_REQUIRED);
  });

  it('refuses an invalid or missing CPF and registers nothing (REJ-310, REJ-311)', async () => {
    const { resolve, list } = setUp();

    expect(
      (await refusal(resolve.execute({ name: 'Maria', cpf: '52998224724', userId: 'u' })))
        .messageKey,
    ).toBe(REGISTRY_MESSAGES.CLIENT_CPF_INVALID);
    expect(
      (await refusal(resolve.execute({ name: 'Maria', cpf: '', userId: 'u' }))).messageKey,
    ).toBe(REGISTRY_MESSAGES.CLIENT_CPF_REQUIRED);
    expect(await list.execute()).toEqual([]);
  });
});

describe('ResolveClient racing another registration (REQ-317, CA-314)', () => {
  it('answers the client that took the CPF between the lookup and the save', async () => {
    const clients = new InMemoryClientRepository();
    const winner = Client.register({
      id: 'client-winner',
      name: 'Maria Souza',
      cpf: '52998224725',
      signed: Authorship.of('u-1', new Date('2026-10-15T12:00:00.000Z')),
    });
    let lookups = 0;
    // The store as a concurrent registration leaves it: empty at the lookup,
    // then holding the CPF, which its constraint refuses to repeat.
    const racing: ClientRepository = {
      save: async () => {
        await clients.save(winner);
        throw new Error('UNIQUE constraint failed: client.cpf');
      },
      findById: (id) => clients.findById(id),
      findByCpf: async (digits) => (lookups++ === 0 ? null : clients.findByCpf(digits)),
      list: () => clients.list(),
    };
    const resolve = new ResolveClient({
      clients: racing,
      newId: () => 'client-loser',
      now: () => new Date('2026-10-15T12:00:01.000Z'),
    });

    expect(await resolve.execute({ name: 'M. Souza', cpf: '52998224725', userId: 'u-2' })).toBe(
      'client-winner',
    );
    expect(await clients.list()).toEqual([winner]);
  });

  it('lets any other failure of the store through', async () => {
    const clients = new InMemoryClientRepository();
    const failing: ClientRepository = {
      save: async () => {
        throw new Error('disk full');
      },
      findById: (id) => clients.findById(id),
      findByCpf: (digits) => clients.findByCpf(digits),
      list: () => clients.list(),
    };
    const resolve = new ResolveClient({
      clients: failing,
      newId: () => 'client-1',
      now: () => new Date('2026-10-15T12:00:01.000Z'),
    });

    await expect(
      resolve.execute({ name: 'Maria', cpf: '52998224725', userId: 'u' }),
    ).rejects.toThrow('disk full');
  });
});

describe('clientNameOf (REQ-318, REQ-320)', () => {
  it('answers the current name of a registered client', async () => {
    const { clients, register, change } = setUp();
    await register.execute({ name: 'Maria Souza', cpf: '52998224725', userId: 'user-1' });
    await change.execute({
      clientId: 'client-1',
      name: 'Maria S.',
      cpf: '52998224725',
      userId: 'u',
    });

    expect(await clientNameOf(clients, 'client-1')).toBe('Maria S.');
  });

  it('answers the text itself for a proposal registered before the registry', async () => {
    const { clients } = setUp();

    expect(await clientNameOf(clients, 'Cliente Antigo')).toBe('Cliente Antigo');
  });
});
