/**
 * A document the system stores on behalf of a business record.
 *
 * `content` is raw bytes and not text: a proof of payment is a PDF or an
 * image, and turning it into a string would be a conversion nobody asked for.
 * `Uint8Array` is a JavaScript value, not a Node type, so the core stays free
 * of builtins — the adapter is what knows about files, blobs or buckets.
 */
export interface StoredDocument {
  readonly id: string;
  /** What a human recognises the document by (REQ-095). */
  readonly fileName: string;
  /** Media type as informed by whoever attached it. */
  readonly contentType: string;
  readonly content: Uint8Array;
}

/**
 * Where an attached document is kept (REQ-095, CA-028, IN-15).
 *
 * Declared by the settlement module because it is the only thing that needs
 * one: `REQ-095` is the single requirement in the whole specification that
 * asks for an attachment. The day another record needs documents, this port
 * is what they share — or it moves, if the two needs turn out to differ.
 *
 * There is no `delete`. REQ-124 forbids erasing a financial record, and the
 * proof is part of one: a payment registered by mistake is corrected by a new
 * entry, never by removing the document that evidenced it.
 */
export interface DocumentStorage {
  save(document: StoredDocument): Promise<void>;
  findById(id: string): Promise<StoredDocument | null>;
}
