import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import type { SourceDocumentStorage } from '../../proposal/application/source-document-storage.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';
import { POLICY_DOCUMENT_CONTENT_TYPE, type PolicyDocumentInput } from './register-policy.ts';

export interface AttachPolicyDocumentInput {
  readonly policyId: string;
  /** REQ-216, REQ-247: who sends the PDF, typed in the act. */
  readonly userId: string;
  readonly document: PolicyDocumentInput;
}

export interface AttachPolicyDocumentDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly documents: SourceDocumentStorage;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * REQ-247: sends the PDF of a policy that already exists, signed by who sends
 * it at the moment it is recorded. The last one sent is the policy's
 * (CA-244); the earlier bytes stay in the store (REQ-124).
 *
 * Nothing reads the file: what it must hold is `DEC-213`.
 */
export class AttachPolicyDocument {
  private readonly deps: AttachPolicyDocumentDependencies;

  constructor(deps: AttachPolicyDocumentDependencies) {
    this.deps = deps;
  }

  async execute(input: AttachPolicyDocumentInput): Promise<PolicyView> {
    const policy = await this.deps.policies.findById(input.policyId);

    if (policy === null) {
      throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: input.policyId });
    }

    const proposal = await this.deps.proposals.findById(policy.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
    }

    // Signed before anything is written: an unsigned sending leaves nothing
    // behind (REQ-216).
    const attached = Authorship.of(input.userId, this.deps.now());
    const documentId = this.deps.newId();
    const updated = policy.attachDocument({
      documentId,
      fileName: input.document.fileName,
      attached,
    });

    await this.deps.documents.save({
      id: documentId,
      fileName: input.document.fileName,
      contentType: POLICY_DOCUMENT_CONTENT_TYPE,
      content: input.document.content,
    });
    await this.deps.policies.save(updated);

    return toPolicyView(updated, proposal);
  }
}
