import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import {
  BusinessRuleViolation,
  PROPOSAL_MESSAGES,
  RecordNotFound,
} from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { CalendarDate } from '../domain/calendar-date.ts';
import { POLICY_MESSAGES } from '../domain/errors.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import type { AgreedCommissionCalculator } from './agreed-commission-calculator.ts';
import type { PolicyIssuedNotifier } from './policy-issued-notifier.ts';
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
  /** FP-01 step 7: the agreed commission follows the policy being created. */
  readonly agreedCommission: AgreedCommissionCalculator;
  /** FP-01 step 7: so does the notification to the broker (REQ-100). */
  readonly notifier: PolicyIssuedNotifier;
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

    // REQ-082, CA-018: the conciliation key is the policy number, so it has to
    // identify one policy. Without this, a report line naming a number two
    // policies share is credited to whichever one the repository answers with.
    // The check is here and not in `Policy.register` because it needs the
    // other policies, which the aggregate cannot see.
    const policyNumber = input.policyNumber.trim();
    const registered = await this.deps.policies.findByPolicyNumber(policyNumber);

    if (registered !== null) {
      throw new BusinessRuleViolation('REQ-082', POLICY_MESSAGES.POLICY_NUMBER_ALREADY_REGISTERED, {
        policyNumber,
      });
    }

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

    // One business fact, four writes: see `Transaction`. The agreed commission
    // and the notification join the same unit of work because FP-01 step 7
    // ties both to the policy being created — a policy stored without the
    // first would show an empty agreed side on the panel REQ-076 requires, and
    // one stored without the second would leave CA-029 silently unmet, with no
    // operation able to produce the notification afterwards.
    //
    // A channel of REQ-103 does not run in here: REQ-104 has the contract
    // admit asynchronous delivery precisely so an outbound adapter hands the
    // payload to a queue and returns.
    await this.deps.transaction.run(async () => {
      await this.deps.policies.save(policy);
      await this.deps.proposals.save(accepted);
      await this.deps.agreedCommission.calculateFor({
        policyId: policy.id,
        proposalId: accepted.id,
        premium: policy.premium,
        calculatedAt: policy.registeredAt,
      });
      await this.deps.notifier.notify({
        policyId: policy.id,
        proposalId: accepted.id,
        policyNumber: policy.policyNumber,
        issuedAt: policy.registeredAt,
      });
    });

    return toPolicyView(policy, accepted);
  }
}
