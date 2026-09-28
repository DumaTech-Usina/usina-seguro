import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import type { SourceDocumentStorage } from '../../proposal/application/source-document-storage.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import type { AgreedCommissionCalculator } from './agreed-commission-calculator.ts';
import type { PolicyIssuedNotifier } from './policy-issued-notifier.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';
import type { Transaction } from './transaction.ts';

/**
 * REQ-247: the PDF of a policy, as uploaded. Nothing reads or checks its
 * content: what it must hold is `DEC-213`.
 */
export interface PolicyDocumentInput {
  readonly fileName: string;
  readonly content: Uint8Array;
}

/** REQ-247: the file is kept and served as a PDF, whatever was uploaded. */
export const POLICY_DOCUMENT_CONTENT_TYPE = 'application/pdf';

/**
 * The recognition of issuance carries nothing but who recognised it: every
 * datum of the policy comes from the proposal (REQ-241) and nothing is typed
 * again (REQ-242, REJ-204). The PDF of the policy may travel with it
 * (REQ-247): a document, not a datum.
 */
export interface RegisterPolicyInput {
  readonly proposalId: string;
  /** REQ-209, REQ-216: who identified the issuance, typed in the act. */
  readonly userId: string;
  /** REQ-247: optional; signed by the same user, at the same moment. */
  readonly document?: PolicyDocumentInput | null;
}

export interface RegisterPolicyDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  /** REQ-247: where the PDF of the policy is kept. */
  readonly documents: SourceDocumentStorage;
  readonly transaction: Transaction;
  /** FP-01 step 7: the agreed commission follows the policy being created. */
  readonly agreedCommission: AgreedCommissionCalculator;
  /** FP-01 step 7: so does the notification to the broker (REQ-100). */
  readonly notifier: PolicyIssuedNotifier;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-01 steps 8 and 9: a user recognises that the insurer issued the proposal,
 * and that same act creates the policy (REQ-240). The proposal becomes ISSUED,
 * signed by who identified it at the moment it is recorded (REQ-209), and the
 * policy inherits every datum of the proposal (REQ-241): the number is the
 * proposal number, the premium is the net premium, the renewal is the end of
 * coverage (REQ-203) and the installments are the proposal's, due date
 * included or not (REQ-204).
 *
 * The number is not checked for uniqueness: proposal numbers may repeat
 * (DEC-207), and so may the policy numbers that inherit them.
 */
export class RegisterPolicy {
  private readonly deps: RegisterPolicyDependencies;

  constructor(deps: RegisterPolicyDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterPolicyInput): Promise<PolicyView> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    const recognizedAt = this.deps.now();
    const recognition = Authorship.of(input.userId, recognizedAt);
    const issued = proposal.recognizeIssuance(recognition);
    const policyId = this.deps.newId();
    const source = input.document ?? null;
    const documentId = source === null ? null : this.deps.newId();

    const policy = Policy.register({
      id: policyId,
      proposalId: issued.id,
      policyNumber: issued.proposalNumber,
      premium: issued.netPremium,
      coverageStart: issued.coverageStart,
      coverageEnd: issued.coverageEnd,
      renewalDate: issued.renewalDate,
      registeredAt: recognizedAt,
      installments: issued.installments.map((installment, index) =>
        Installment.create({
          id: this.deps.newId(),
          policyId,
          number: index + 1,
          amount: installment.amount,
          dueDate: installment.dueDate,
        }),
      ),
      document:
        source === null || documentId === null
          ? null
          : { documentId, fileName: source.fileName, attached: recognition },
    });

    // One business fact, four writes: see `Transaction`. The agreed commission
    // and the notification join the same unit of work because they are tied
    // to the policy being created — a policy stored without the first would
    // show an empty agreed side on the panel REQ-076 requires, and one stored
    // without the second would leave CA-029 silently unmet, with no operation
    // able to produce the notification afterwards.
    //
    // A channel of REQ-103 does not run in here: REQ-104 has the contract
    // admit asynchronous delivery precisely so an outbound adapter hands the
    // payload to a queue and returns.
    await this.deps.transaction.run(async () => {
      if (source !== null && documentId !== null) {
        await this.deps.documents.save({
          id: documentId,
          fileName: source.fileName,
          contentType: POLICY_DOCUMENT_CONTENT_TYPE,
          content: source.content,
        });
      }
      await this.deps.policies.save(policy);
      await this.deps.proposals.save(issued);
      await this.deps.agreedCommission.calculateFor({
        policyId: policy.id,
        proposalId: issued.id,
        calculatedAt: policy.registeredAt,
      });
      await this.deps.notifier.notify({
        policyId: policy.id,
        proposalId: issued.id,
        policyNumber: policy.policyNumber,
        issuedAt: policy.registeredAt,
      });
    });

    return toPolicyView(policy, issued);
  }
}
