import type { DatabaseSync } from 'node:sqlite';
import type {
  ReferenceListFilter,
  ReferenceRepository,
} from '../../../core/registry/application/reference-repository.ts';
import { Reference, type ReferenceKind } from '../../../core/registry/domain/reference.ts';

interface ReferenceRow {
  kind: string;
  id: string;
  name: string;
  registered_at: string;
}

export class SqliteReferenceRepository implements ReferenceRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(reference: Reference): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO reference (kind, id, name, registered_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET
           name          = excluded.name,
           registered_at = excluded.registered_at`,
      )
      .run(reference.kind, reference.id, reference.name, reference.registeredAt.toISOString());
  }

  /**
   * IN-01: by kind, then by name.
   *
   * The name leads because the registry is read to be looked through by a
   * human, and the identifier is what a machine matches on. `id` breaks the
   * tie so two records with the same name keep a stable position between reads.
   */
  async list(filter: ReferenceListFilter): Promise<readonly Reference[]> {
    const rows = (filter.kind === undefined
      ? this.db.prepare('SELECT * FROM reference ORDER BY kind, name, id').all()
      : this.db
          .prepare('SELECT * FROM reference WHERE kind = ? ORDER BY kind, name, id')
          .all(filter.kind)) as unknown as ReferenceRow[];

    return rows.map(restore);
  }
}

function restore(row: ReferenceRow): Reference {
  return Reference.restore({
    kind: row.kind as ReferenceKind,
    id: row.id,
    name: row.name,
    registeredAt: new Date(row.registered_at),
  });
}
