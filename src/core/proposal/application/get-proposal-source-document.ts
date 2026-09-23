import { PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import type { ProposalRepository } from './proposal-repository.ts';
import type { SourceDocument, SourceDocumentStorage } from './source-document-storage.ts';

export interface GetProposalSourceDocumentDependencies {
  readonly proposals: ProposalRepository;
  readonly documents: SourceDocumentStorage;
}

/**
 * REQ-219, CA-223: hands back the PDF the proposal was imported from, as it
 * was uploaded — bytes, name and media type, nothing transformed.
 *
 * A proposal typed by hand has none, which is an absence and not a broken
 * rule, so it answers not found.
 */
export class GetProposalSourceDocument {
  private readonly deps: GetProposalSourceDocumentDependencies;

  constructor(deps: GetProposalSourceDocumentDependencies) {
    this.deps = deps;
  }

  async execute(proposalId: string): Promise<SourceDocument> {
    const proposal = await this.deps.proposals.findById(proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: proposalId });
    }

    const document =
      proposal.sourceDocument === null
        ? null
        : await this.deps.documents.findById(proposal.sourceDocument.documentId);

    if (document === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.SOURCE_DOCUMENT_NOT_FOUND, { id: proposalId });
    }

    return document;
  }
}
