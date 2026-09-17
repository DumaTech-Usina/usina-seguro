import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import type { PolicyRepository } from './policy-repository.ts';
import { type PolicyView, toPolicyView } from './policy-view.ts';
import type { Transaction } from './transaction.ts';

/**
 * Use case input: raw data at the core boundary.
 *
 * The installment schedule is informed, not computed (REQ-002, REQ-011): the
 * caller states each installment, and the domain checks the numbering is a
 * sequence starting at 1 so the first installment of REQ-091 is unambiguous.
 */
export interface RegisterPolicyInstallmentInput {
  readonly number: number;
  readonly amount: string;
  readonly dueDate: string;
}

export interface RegisterPolicyInput {
  readonly proposalId: string;
  readonly policyNumber: string;
  readonly premium: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly renewalDate: string;
  readonly installments: readonly RegisterPolicyInstallmentInput[];
}

export interface RegisterPolicyDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly transaction: Transaction;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-01, step 6 (acceptance branch): the insurer effectuated the proposal, so
 * the policy is registered and the proposal becomes `ACCEPTED` (REQ-048,
 * REQ-111).
 *
 * The rules stay in the domain: whether the proposal may originate a policy is
 * `Proposal.accept` (REQ-047, REQ-049), and what a valid policy looks like is
 * `Policy.register` (REQ-020). The use case loads, delegates, and writes both
 * records in one unit of work.
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

    const accepted = proposal.accept();
    const policyId = this.deps.newId();

    const policy = Policy.register({
      id: policyId,
      proposalId: accepted.id,
      policyNumber: input.policyNumber,
      premium: Money.fromString(input.premium),
      coverageStart: CalendarDate.fromString(input.coverageStart),
      coverageEnd: CalendarDate.fromString(input.coverageEnd),
      renewalDate: CalendarDate.fromString(input.renewalDate),
      registeredAt: this.deps.now(),
      installments: input.installments.map((installment) =>
        Installment.create({
          id: this.deps.newId(),
          policyId,
          number: installment.number,
          amount: Money.fromString(installment.amount),
          dueDate: CalendarDate.fromString(installment.dueDate),
        }),
      ),
    });

    // One business fact, two aggregates: see `Transaction`.
    await this.deps.transaction.run(async () => {
      await this.deps.policies.save(policy);
      await this.deps.proposals.save(accepted);
    });

    return toPolicyView(policy, accepted);
  }
}
