import type { ReferenceKind } from '../domain/reference.ts';
import type { ReferenceRepository } from './reference-repository.ts';

/**
 * The names of IN-01, ready to be asked for one reference at a time.
 *
 * A listing shows one line per business and each line carries three or four
 * references. Asking the repository for each of them would be a read per cell;
 * the registry is small — one row per client, broker, insurer, intermediary and
 * product the Usina works with — so a listing loads it once and looks names up
 * in memory.
 *
 * `of` answers `null`, never a placeholder: whether an unregistered reference
 * reads as the raw identifier, as a dash or as nothing is a presentation
 * decision, and the core does not take it.
 */
export class ReferenceNames {
  private readonly names: ReadonlyMap<string, string>;

  private constructor(names: ReadonlyMap<string, string>) {
    this.names = names;
  }

  /**
   * Reads the whole registry once.
   *
   * IN-01 has no requirement that bounds it, but the set it describes is the
   * counterparties of a brokerage, not a transactional table: it grows with
   * the business, not with the volume of business. If that ever stops being
   * true, this is the one place that has to change — the callers ask for a
   * name, not for a query.
   */
  static async load(references: ReferenceRepository): Promise<ReferenceNames> {
    const all = await references.list({});

    return new ReferenceNames(
      new Map(all.map((reference) => [keyOf(reference.kind, reference.id), reference.name])),
    );
  }

  /** The registered name of a reference, or null when nobody registered it. */
  of(kind: ReferenceKind, id: string): string | null {
    return this.names.get(keyOf(kind, id)) ?? null;
  }
}

function keyOf(kind: ReferenceKind, id: string): string {
  return `${kind}\u0000${id}`;
}
