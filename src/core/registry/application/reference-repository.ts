import type { Reference, ReferenceKind } from '../domain/reference.ts';

/** What narrows a listing. Absent means every kind (IN-01). */
export interface ReferenceListFilter {
  readonly kind?: ReferenceKind;
}

export interface ReferenceRepository {
  save(reference: Reference): Promise<void>;
  /**
   * The references registered, by kind and then by name (IN-01).
   *
   * The order is part of the contract and not an accident of the driver: the
   * registry is read to be looked through by a human, and a name is what a
   * human scans for. Both implementations are tested against it.
   */
  list(filter: ReferenceListFilter): Promise<readonly Reference[]>;
}
