/**
 * The file a proposal was imported from (REQ-219), as it was uploaded.
 *
 * `content` is raw bytes: the point is to keep the original, not a text
 * extracted from it.
 */
export interface SourceDocument {
  readonly id: string;
  readonly fileName: string;
  /** Media type as informed by whoever uploaded it. */
  readonly contentType: string;
  readonly content: Uint8Array;
}

/**
 * Where the source document of a proposal is kept (REQ-219).
 *
 * Declared here, by its consumer, and not imported from the settlement module:
 * the proposal module depends on no other. It has the same shape as the
 * settlement's `DocumentStorage`, so the same adapter serves both.
 *
 * No `delete`: the document is the origin of the proposal's data, and nothing
 * of a proposal is erased (REQ-124).
 */
export interface SourceDocumentStorage {
  save(document: SourceDocument): Promise<void>;
  findById(id: string): Promise<SourceDocument | null>;
}
