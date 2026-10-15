import { describe, expect, it } from 'vitest';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { Reference, type ReferenceKind } from '../domain/reference.ts';
import { ListReferences } from './list-references.ts';
import { RegisterReference } from './register-reference.ts';

const AT = new Date('2026-09-21T12:00:00.000Z');

function reference(kind: ReferenceKind, id: string, name: string, at = AT): Reference {
  return Reference.register({ kind, id, name, registeredAt: at });
}

async function scenario() {
  const references = new InMemoryReferenceRepository();

  await references.save(reference('INSURER', 'insurer-2', 'Seguradora Sul'));
  await references.save(reference('INSURER', 'insurer-1', 'Seguradora Norte'));
  await references.save(reference('PRODUCT', 'auto', 'Automovel'));
  await references.save(reference('INTERMEDIARY', 'mega', 'Mega Intermediacao'));

  return { references, useCase: new ListReferences({ references }) };
}

describe('ListReferences', () => {
  it('answers every record registered, by kind and then by name (IN-01)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute();

    expect(listed.map((line) => `${line.kind}:${line.id}`)).toEqual([
      'INSURER:insurer-1',
      'INSURER:insurer-2',
      'INTERMEDIARY:mega',
      'PRODUCT:auto',
    ]);
    // Within a kind the order is the name, which is what a human scans for.
    expect(listed.filter((line) => line.kind === 'INSURER').map((line) => line.name)).toEqual([
      'Seguradora Norte',
      'Seguradora Sul',
    ]);
  });

  it('answers one kind at a time when asked', async () => {
    const { useCase } = await scenario();

    const insurers = await useCase.execute({ kind: 'INSURER' });

    expect(insurers).toHaveLength(2);
    expect(insurers.every((line) => line.kind === 'INSURER')).toBe(true);
  });

  it('answers an empty registry rather than failing', async () => {
    const useCase = new ListReferences({ references: new InMemoryReferenceRepository() });

    await expect(useCase.execute()).resolves.toEqual([]);
    await expect(useCase.execute({ kind: 'PRODUCT' })).resolves.toEqual([]);
  });

  it('shows the current name of a record registered twice, only once', async () => {
    const references = new InMemoryReferenceRepository();
    const register = new RegisterReference({ references, now: () => AT });

    await register.execute({ kind: 'INSURER', id: 'insurer-1', name: 'Seguradora Nrte' });
    await register.execute({ kind: 'INSURER', id: 'insurer-1', name: 'Seguradora Norte' });

    const listed = await new ListReferences({ references }).execute();

    // A reference is the current name of an entity, not a financial entry:
    // correcting a typo replaces it, and REQ-124 is not what governs it.
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Seguradora Norte');
  });

  it('keeps the same identifier of two different kinds apart', async () => {
    const references = new InMemoryReferenceRepository();
    await references.save(reference('INTERMEDIARY', 'alfa', 'Alfa Intermediacao'));
    await references.save(reference('INSURER', 'alfa', 'Seguradora Alfa'));

    const listed = await new ListReferences({ references }).execute();

    // The key is the pair: nothing says an intermediary and an insurer cannot share an
    // identifier, and the registry must not collapse them into one record.
    expect(listed).toHaveLength(2);
    expect(listed.map((line) => line.name)).toEqual(['Seguradora Alfa', 'Alfa Intermediacao']);
  });
});
