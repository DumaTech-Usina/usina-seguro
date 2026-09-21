import type {
  ReferenceListFilter,
  ReferenceRepository,
} from '../../../core/registry/application/reference-repository.ts';
import type { Reference } from '../../../core/registry/domain/reference.ts';

/** The key `reference` is PRIMARY KEY on: the kind and the identifier. */
function keyOf(reference: Reference): string {
  return `${reference.kind}\u0000${reference.id}`;
}

export class InMemoryReferenceRepository implements ReferenceRepository {
  private readonly records = new Map<string, Reference>();

  /** Registering the same kind and identifier again replaces the name. */
  async save(reference: Reference): Promise<void> {
    this.records.set(keyOf(reference), reference);
  }

  /** IN-01: by kind, then by name. Code-unit order, as SQLite orders `TEXT`. */
  async list(filter: ReferenceListFilter): Promise<readonly Reference[]> {
    return [...this.records.values()]
      .filter((reference) => filter.kind === undefined || reference.kind === filter.kind)
      .sort((a, b) => compare(a.kind, b.kind) || compare(a.name, b.name) || compare(a.id, b.id));
  }
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
