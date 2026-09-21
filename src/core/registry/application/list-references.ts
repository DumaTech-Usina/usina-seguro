import type { ReferenceKind } from '../domain/reference.ts';
import type { ReferenceRepository } from './reference-repository.ts';
import { type ReferenceView, toReferenceView } from './reference-view.ts';

export interface ListReferencesInput {
  /** IN-01: one kind at a time, or every one of them when absent. */
  readonly kind?: ReferenceKind;
}

export interface ListReferencesDependencies {
  readonly references: ReferenceRepository;
}

/**
 * IN-01: the reference records as they stand.
 *
 * Two readers: the Administrator, who maintains them, and the screens that
 * offer the registered identifiers where one has to be informed. Neither is a
 * rule — nothing in the system refuses an identifier for being absent here
 * (REQ-002) — so this is a reading, and the absence of a record shows up as
 * the identifier itself, never as a refusal.
 */
export class ListReferences {
  private readonly deps: ListReferencesDependencies;

  constructor(deps: ListReferencesDependencies) {
    this.deps = deps;
  }

  async execute(input: ListReferencesInput = {}): Promise<readonly ReferenceView[]> {
    const references = await this.deps.references.list(input);

    return references.map(toReferenceView);
  }
}
