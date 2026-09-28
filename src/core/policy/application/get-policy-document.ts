import type {
  SourceDocument,
  SourceDocumentStorage,
} from '../../proposal/application/source-document-storage.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyRepository } from './policy-repository.ts';

export interface GetPolicyDocumentDependencies {
  readonly policies: PolicyRepository;
  readonly documents: SourceDocumentStorage;
}

/**
 * REQ-247, CA-243: hands back the PDF of the policy in force — the last one
 * sent — as it was uploaded.
 *
 * A policy nobody sent a PDF for has none, which is an absence and not a
 * broken rule, so it answers not found.
 */
export class GetPolicyDocument {
  private readonly deps: GetPolicyDocumentDependencies;

  constructor(deps: GetPolicyDocumentDependencies) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<SourceDocument> {
    const policy = await this.deps.policies.findById(policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: policyId });
    }

    const document =
      policy.document === null
        ? null
        : await this.deps.documents.findById(policy.document.documentId);

    if (document === null) {
      throw new RecordNotFound(POLICY_MESSAGES.DOCUMENT_NOT_FOUND, { id: policyId });
    }

    return document;
  }
}
