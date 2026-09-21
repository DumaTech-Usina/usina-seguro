import { Reference, type ReferenceKind } from '../domain/reference.ts';
import type { ReferenceRepository } from './reference-repository.ts';
import { type ReferenceView, toReferenceView } from './reference-view.ts';

export interface RegisterReferenceInput {
  readonly kind: ReferenceKind;
  readonly id: string;
  readonly name: string;
}

export interface RegisterReferenceDependencies {
  readonly references: ReferenceRepository;
  readonly now: () => Date;
}

/**
 * IN-01: the Administrator maintains the reference records.
 *
 * Registering the same kind and identifier again replaces the name, the way
 * the broker table and the release rule already behave: the record is the
 * current name of that entity, not a financial entry, so REQ-124 — which
 * forbids erasing a *lancamento financeiro* — is not what governs it. Whether
 * a reference may be removed altogether is not decided by any requirement, so
 * there is no operation for it.
 */
export class RegisterReference {
  private readonly deps: RegisterReferenceDependencies;

  constructor(deps: RegisterReferenceDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterReferenceInput): Promise<ReferenceView> {
    const reference = Reference.register({
      kind: input.kind,
      id: input.id,
      name: input.name,
      registeredAt: this.deps.now(),
    });

    await this.deps.references.save(reference);

    return toReferenceView(reference);
  }
}
