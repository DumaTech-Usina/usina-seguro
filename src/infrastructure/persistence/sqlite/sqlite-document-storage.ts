import type { DatabaseSync } from 'node:sqlite';
import type {
  DocumentStorage,
  StoredDocument,
} from '../../../core/settlement/application/document-storage.ts';

interface DocumentRow {
  id: string;
  file_name: string;
  content_type: string;
  content: Uint8Array;
}

/**
 * Documents in a BLOB column, in the same file as everything else.
 *
 * The alternative — the filesystem, with the path in the row — buys nothing
 * at this size and costs the one property the single file gives: a backup is
 * a copy, and there is no way for the row and the file to disagree. See
 * `SQLITE-NOTES.md` for where PostgreSQL differs (`bytea`).
 */
export class SqliteDocumentStorage implements DocumentStorage {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(document: StoredDocument): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO document (id, file_name, content_type, content)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           file_name    = excluded.file_name,
           content_type = excluded.content_type,
           content      = excluded.content`,
      )
      .run(document.id, document.fileName, document.contentType, document.content);
  }

  async findById(id: string): Promise<StoredDocument | null> {
    const row = this.db.prepare('SELECT * FROM document WHERE id = ?').get(id) as
      | DocumentRow
      | undefined;

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      // `node:sqlite` answers a BLOB as a Uint8Array already; the copy is what
      // keeps a caller from writing through into the driver's buffer.
      content: Uint8Array.from(row.content),
    };
  }
}
