import type {
  DocumentStorage,
  StoredDocument,
} from '../../../core/settlement/application/document-storage.ts';

export class InMemoryDocumentStorage implements DocumentStorage {
  private readonly documents = new Map<string, StoredDocument>();

  /**
   * The bytes are copied in, the way the SQLite driver copies them into a
   * BLOB. Without it the caller could still hold — and mutate — the array
   * this store answers with later, which no real driver would allow.
   */
  async save(document: StoredDocument): Promise<void> {
    this.documents.set(document.id, { ...document, content: Uint8Array.from(document.content) });
  }

  async findById(id: string): Promise<StoredDocument | null> {
    const found = this.documents.get(id);

    if (found === undefined) {
      return null;
    }

    return { ...found, content: Uint8Array.from(found.content) };
  }
}
