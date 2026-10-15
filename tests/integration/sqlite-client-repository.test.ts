import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Authorship } from '../../src/core/proposal/domain/authorship.ts';
import { Client } from '../../src/core/registry/domain/client.ts';
import { SqliteClientRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-client-repository.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';

/**
 * The clients of V2 section 9E read back from SQLite on disk: the signed
 * history survives a round trip in order (REQ-314), the current CPF is what
 * `findByCpf` answers (REQ-312), and the listing is ordered by name.
 */
let directory: string;
let db: DatabaseSync;
let clients: SqliteClientRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-clients-'));
  db = openSqliteConnection(path.join(directory, 'usina.sqlite'));
  clients = new SqliteClientRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

const FIRST = Authorship.of('user-1', new Date('2026-10-15T12:00:00.000Z'));
const SECOND = Authorship.of('user-2', new Date('2026-10-16T12:00:00.000Z'));

describe('SqliteClientRepository', () => {
  it('keeps every signed record, in order, and answers the current CPF (REQ-312, REQ-314)', async () => {
    const registered = Client.register({
      id: 'client-1',
      name: 'Ana Silva',
      cpf: '52998224725',
      signed: FIRST,
    });
    await clients.save(registered);
    await clients.save(registered.change({ name: 'Ana S.', cpf: '11144477735', signed: SECOND }));

    const stored = await clients.findById('client-1');

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
    expect((await clients.findByCpf('11144477735'))?.id).toBe('client-1');
    expect(await clients.findByCpf('52998224725')).toBeNull();
    expect(await clients.findById('nope')).toBeNull();
  });

  it('refuses two clients with one CPF at the database too (REQ-312)', async () => {
    await clients.save(
      Client.register({ id: 'client-1', name: 'Ana', cpf: '52998224725', signed: FIRST }),
    );

    await expect(
      clients.save(
        Client.register({ id: 'client-2', name: 'Bia', cpf: '52998224725', signed: FIRST }),
      ),
    ).rejects.toThrow();
    expect(await clients.findById('client-2')).toBeNull();
  });

  it('lists by current name', async () => {
    await clients.save(
      Client.register({ id: 'client-1', name: 'Bruno', cpf: '52998224725', signed: FIRST }),
    );
    await clients.save(
      Client.register({ id: 'client-2', name: 'Ana', cpf: '11144477735', signed: FIRST }),
    );

    expect((await clients.list()).map((client) => client.name)).toEqual(['Ana', 'Bruno']);
  });
});
