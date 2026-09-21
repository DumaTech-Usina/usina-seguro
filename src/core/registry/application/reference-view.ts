import type { Reference } from '../domain/reference.ts';

/**
 * Representation of a reference record at the core boundary (IN-01).
 *
 * `registeredAt` travels for the same reason it does on the other registries:
 * re-registering a kind and an identifier replaces the name, and this is what
 * says when the value on screen was written.
 */
export interface ReferenceView {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly registeredAt: string;
}

export function toReferenceView(reference: Reference): ReferenceView {
  return {
    kind: reference.kind,
    id: reference.id,
    name: reference.name,
    registeredAt: reference.registeredAt.toISOString(),
  };
}
