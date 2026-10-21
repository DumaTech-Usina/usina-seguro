import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import type { SourceDocumentStorage } from '../../proposal/application/source-document-storage.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import type { AgreedCommissionCalculator } from './agreed-commission-calculator.ts';
import type { PolicyIssuedNotifier } from './policy-issued-notifier.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';
import type { Transaction } from './transaction.ts';

/**
 * REQ-247: the PDF of a policy, as uploaded. Nothing here reads or checks its
 * content: the number read from it (REQ-248) arrives as `policyNumber`, after
 * the user reviewed it, and what else it must hold is `DEC-213`.
 */
export interface PolicyDocumentInput {
  readonly fileName: string;
  readonly content: Uint8Array;
}

/** REQ-247: the file is kept and served as a PDF, whatever was uploaded. */
export const POLICY_DOCUMENT_CONTENT_TYPE = 'application/pdf';

/**
 * The recognition of issuance carries who recognised it, the policy number and
 * the policy PDF. The number is the one the insurer gave the policy, read from
 * the PDF and reviewed by the user (REQ-248); every other datum comes from the
 * proposal (REQ-241) and nothing else is typed again (REQ-242, REJ-204).
 */
export interface RegisterPolicyInput {
  readonly proposalId: string;
  /** REQ-209, REQ-216: who identified the issuance, typed in the act. */
  readonly userId: string;
  /** REQ-248: required; not checked for uniqueness (DEC-207). */
  readonly policyNumber: string;
  /** REQ-247: required; signed by the same user, at the same moment. */
  readonly document: PolicyDocumentInput | null;
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
 * signed by who identified it at the moment it is recorded (REQ-209). The
 * policy takes the informed number (REQ-248) and inherits every other datum of
 * the proposal (REQ-241): the premium is the net premium, the renewal is the
 * end of coverage (REQ-203) and the installments are the proposal's, due date
 * included or not (REQ-204).
 *
 * The number is not checked for uniqueness (DEC-207).
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

    // REJ-247, REJ-248: checked before anything changes.
    if (input.document === null) {
      throw new BusinessRuleViolation('REQ-247', POLICY_MESSAGES.DOCUMENT_REQUIRED);
    }
    if (input.policyNumber.trim() === '') {
      throw new BusinessRuleViolation('REQ-248', POLICY_MESSAGES.POLICY_NUMBER_REQUIRED);
    }

    const recognizedAt = this.deps.now();
    const recognition = Authorship.of(input.userId, recognizedAt);
    const issued = proposal.recognizeIssuance(recognition);
    const policyId = this.deps.newId();
    const source = input.document;
    const documentId = this.deps.newId();

    const policy = Policy.register({
      id: policyId,
      proposalId: issued.id,
      policyNumber: input.policyNumber,
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
      document: { documentId, fileName: source.fileName, attached: recognition },
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
      await this.deps.documents.save({
        id: documentId,
        fileName: source.fileName,
        contentType: POLICY_DOCUMENT_CONTENT_TYPE,
        content: source.content,
      });
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
