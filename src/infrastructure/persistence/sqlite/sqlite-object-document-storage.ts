import type { DatabaseSync } from 'node:sqlite';
import type {
  SourceDocument,
  SourceDocumentStorage,
} from '../../../core/proposal/application/source-document-storage.ts';

/** Where the bytes go: an object storage bucket (R2 in production). */
export interface ObjectStore {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

interface DocumentRow {
  id: string;
  file_name: string;
  content_type: string;
  content: Uint8Array;
  object_key: string | null;
}

const EMPTY = new Uint8Array(0);

/**
 * Documents whose bytes are objects in a bucket, and whose name and type stay
 * in SQLite: the proposal and the policy reference `document(id)` by a foreign
 * key, so the row keeps existing (see `document_object` in `schema.sql`).
 *
 * The object is written before the rows: a failed upload leaves nothing, and a
 * row never points to an object that is not there. A document stored before,
 * in the BLOB, is read from it as it always was.
 *
 * `save` goes over the network, so it must not run inside a `Transaction`: the
 * SQLite connection is shared, and a savepoint left open across that wait
 * would take in the writes of other requests (see `SQLITE-NOTES.md`).
 */
export class SqliteObjectDocumentStorage implements SourceDocumentStorage {
  private readonly db: DatabaseSync;
  private readonly objects: ObjectStore;

  constructor(db: DatabaseSync, objects: ObjectStore) {
    this.db = db;
    this.objects = objects;
  }

  async save(document: SourceDocument): Promise<void> {
    const key = `documents/${document.id}`;
    await this.objects.put(key, document.content, document.contentType);

    // Both rows or neither, with no await in between: nothing else runs on
    // the connection while the savepoint is open.
    this.db.exec('SAVEPOINT document_object_save');
    try {
      this.db
        .prepare(
          `INSERT INTO document (id, file_name, content_type, content)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             file_name    = excluded.file_name,
             content_type = excluded.content_type,
             content      = excluded.content`,
        )
        .run(document.id, document.fileName, document.contentType, EMPTY);
      this.db
        .prepare(
          `INSERT INTO document_object (document_id, object_key) VALUES (?, ?)
           ON CONFLICT(document_id) DO UPDATE SET object_key = excluded.object_key`,
        )
        .run(document.id, key);
      this.db.exec('RELEASE document_object_save');
    } catch (error) {
      this.db.exec('ROLLBACK TO document_object_save');
      this.db.exec('RELEASE document_object_save');
      throw error;
    }
  }

  async findById(id: string): Promise<SourceDocument | null> {
    const row = this.db
      .prepare(
        `SELECT d.*, o.object_key FROM document d
         LEFT JOIN document_object o ON o.document_id = d.id
         WHERE d.id = ?`,
      )
      .get(id) as DocumentRow | undefined;

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      content:
        row.object_key === null
          ? Uint8Array.from(row.content)
          : await this.objects.get(row.object_key),
    };
  }
}
