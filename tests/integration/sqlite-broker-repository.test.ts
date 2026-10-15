import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Authorship } from '../../src/core/proposal/domain/authorship.ts';
import { Broker } from '../../src/core/registry/domain/broker.ts';
import { SqliteBrokerRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-broker-repository.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';

/**
 * The brokers of V2 section 9D read back from SQLite on disk: the signed
 * history survives a round trip in order (REQ-304), the current CPF is what
 * `findByCpf` answers (REQ-302), and the listing is ordered by name.
 */
let directory: string;
let db: DatabaseSync;
let brokers: SqliteBrokerRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-brokers-'));
  db = openSqliteConnection(path.join(directory, 'usina.sqlite'));
  brokers = new SqliteBrokerRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

const FIRST = Authorship.of('user-1', new Date('2026-10-15T12:00:00.000Z'));
const SECOND = Authorship.of('user-2', new Date('2026-10-16T12:00:00.000Z'));

describe('SqliteBrokerRepository', () => {
  it('keeps every signed record, in order, and answers the current CPF (REQ-302, REQ-304)', async () => {
    const registered = Broker.register({
      id: 'broker-1',
      name: 'Ana Silva',
      cpf: '52998224725',
      signed: FIRST,
    });
    await brokers.save(registered);
    await brokers.save(registered.change({ name: 'Ana S.', cpf: '11144477735', signed: SECOND }));

    const stored = await brokers.findById('broker-1');

    expect(stored?.name).toBe('Ana S.');
    expect(
      stored?.records.map((record) => [
        record.name,
        record.cpf.digits,
        record.signed.author,
        record.signed.at.toISOString(),
      ]),
    ).toEqual([
      ['Ana Silva', '52998224725', 'user-1', '2026-10-15T12:00:00.000Z'],
      ['Ana S.', '11144477735', 'user-2', '2026-10-16T12:00:00.000Z'],
    ]);
    expect((await brokers.findByCpf('11144477735'))?.id).toBe('broker-1');
    expect(await brokers.findByCpf('52998224725')).toBeNull();
    expect(await brokers.findById('nope')).toBeNull();
  });

  it('refuses two brokers with one CPF at the database too (REQ-302)', async () => {
    await brokers.save(
      Broker.register({ id: 'broker-1', name: 'Ana', cpf: '52998224725', signed: FIRST }),
    );

    await expect(
      brokers.save(
        Broker.register({ id: 'broker-2', name: 'Bia', cpf: '52998224725', signed: FIRST }),
      ),
    ).rejects.toThrow();
    expect(await brokers.findById('broker-2')).toBeNull();
  });

  it('lists by current name', async () => {
    await brokers.save(
      Broker.register({ id: 'broker-1', name: 'Bruno', cpf: '52998224725', signed: FIRST }),
    );
    await brokers.save(
      Broker.register({ id: 'broker-2', name: 'Ana', cpf: '11144477735', signed: FIRST }),
    );

    expect((await brokers.list()).map((broker) => broker.name)).toEqual(['Ana', 'Bruno']);
  });
});
