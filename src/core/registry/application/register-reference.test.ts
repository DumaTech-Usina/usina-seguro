import { describe, expect, it } from 'vitest';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { ListReferences } from './list-references.ts';
import { RegisterReference } from './register-reference.ts';

const AT = new Date('2026-09-21T12:00:00.000Z');

function useCase(references = new InMemoryReferenceRepository()) {
  return { references, register: new RegisterReference({ references, now: () => AT }) };
}

describe('RegisterReference', () => {
  it('registers a reference and answers it (IN-01)', async () => {
    const { register } = useCase();

    const registered = await register.execute({
      kind: 'CLIENT',
      id: 'client-1',
      name: 'Ana Lima',
    });

    expect(registered).toEqual({
      kind: 'CLIENT',
      id: 'client-1',
      name: 'Ana Lima',
      registeredAt: '2026-09-21T12:00:00.000Z',
    });
  });

  it('answers a registration in the same shape the listing answers', async () => {
    const { references, register } = useCase();

    const registered = await register.execute({
      kind: 'PRODUCT',
      id: 'auto',
      name: 'Automovel',
    });
    const [listed] = await new ListReferences({ references }).execute();

    expect(listed).toEqual(registered);
  });

  it('refuses a reference with no name (IN-01, REQ-096)', async () => {
    const { references, register } = useCase();

    await expect(
      register.execute({ kind: 'CLIENT', id: 'client-1', name: '   ' }),
    ).rejects.toBeInstanceOf(BusinessRuleViolation);

    // Nothing was written: a refusal leaves the registry as it was.
    await expect(new ListReferences({ references }).execute()).resolves.toEqual([]);
  });
});
