import type {
  SourceDocument,
  SourceDocumentStorage,
} from '../../../core/proposal/application/source-document-storage.ts';

export class InMemoryDocumentStorage implements SourceDocumentStorage {
  private readonly documents = new Map<string, SourceDocument>();

  /**
   * The bytes are copied in, the way the SQLite driver copies them into a
   * BLOB. Without it the caller could still hold — and mutate — the array
   * this store answers with later, which no real driver would allow.
   */
  async save(document: SourceDocument): Promise<void> {
    this.documents.set(document.id, { ...document, content: Uint8Array.from(document.content) });
  }

  async findById(id: string): Promise<SourceDocument | null> {
    const found = this.documents.get(id);

    if (found === undefined) {
      return null;
    }

    return { ...found, content: Uint8Array.from(found.content) };
  }
}
