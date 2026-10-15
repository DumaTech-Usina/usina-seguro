import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ListReferences } from '../../src/core/registry/application/list-references.ts';
import type { ReferenceRepository } from '../../src/core/registry/application/reference-repository.ts';
import { Reference, type ReferenceKind } from '../../src/core/registry/domain/reference.ts';
import { InMemoryReferenceRepository } from '../../src/infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteReferenceRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-reference-repository.ts';

/**
 * The reference registry of IN-01 read back from the real driver.
 *
 * Two things are checked against SQLite on disk that a
 * fake cannot answer: the order the listing promises, and that re-registering
 * a key replaces the record instead of adding one — the `UNIQUE` constraints
 * of `schema.sql` are what enforce the second, and the in-memory driver has to
 * agree with them or the same reading answers differently per driver.
 */
let directory: string;
let db: DatabaseSync;
let references: SqliteReferenceRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-registries-'));
  db = openSqliteConnection(path.join(directory, 'usina.sqlite'));
  references = new SqliteReferenceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function reference(kind: ReferenceKind, id: string, name: string): Reference {
  return Reference.register({ kind, id, name, registeredAt: new Date('2026-09-21T12:00:00.000Z') });
}

async function seedReferences(repository: ReferenceRepository): Promise<void> {
  await repository.save(reference('INSURER', 'insurer-2', 'Seguradora Sul'));
  await repository.save(reference('INSURER', 'insurer-1', 'Seguradora Norte'));
  await repository.save(reference('PRODUCT', 'auto', 'Automovel'));
  await repository.save(reference('INTERMEDIARY', 'mega', 'Mega Intermediacao'));
}

describe('the reference registry on SQLite (IN-01)', () => {
  it('lists by kind and then by name', async () => {
    await seedReferences(references);

    const listed = await new ListReferences({ references }).execute();

    expect(listed.map((line) => `${line.kind}:${line.id}`)).toEqual([
      'INSURER:insurer-1',
      'INSURER:insurer-2',
      'INTERMEDIARY:mega',
      'PRODUCT:auto',
    ]);
  });

  it('answers one kind at a time when asked', async () => {
    await seedReferences(references);

    const insurers = await new ListReferences({ references }).execute({ kind: 'INSURER' });

    expect(insurers.map((line) => line.name)).toEqual(['Seguradora Norte', 'Seguradora Sul']);
  });

  it('replaces the name of a record registered again', async () => {
    await seedReferences(references);
    await references.save(reference('INSURER', 'insurer-1', 'Seguradora Norte Ltda'));

    const insurers = await new ListReferences({ references }).execute({ kind: 'INSURER' });

    // PRIMARY KEY (kind, id): a correction of the name, not a second record.
    expect(insurers).toHaveLength(2);
    expect(insurers.find((line) => line.id === 'insurer-1')?.name).toBe('Seguradora Norte Ltda');
  });

  it('keeps the same identifier of two different kinds apart', async () => {
    await references.save(reference('INTERMEDIARY', 'alfa', 'Alfa Intermediacao'));
    await references.save(reference('INSURER', 'alfa', 'Seguradora Alfa'));

    const listed = await new ListReferences({ references }).execute();

    expect(listed).toHaveLength(2);
  });

  it('answers the same listing as the in-memory driver', async () => {
    const inMemory = new InMemoryReferenceRepository();
    await seedReferences(references);
    await seedReferences(inMemory);

    await expect(new ListReferences({ references: inMemory }).execute()).resolves.toEqual(
      await new ListReferences({ references }).execute(),
    );
  });
});
