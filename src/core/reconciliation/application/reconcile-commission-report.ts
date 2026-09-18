import type { CommissionRepository } from '../../commission/application/commission-repository.ts';
import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import type { Transaction } from '../../policy/application/transaction.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { RECONCILIATION_MESSAGES } from '../domain/errors.ts';
import { ReconciliationPendency } from '../domain/reconciliation-pendency.ts';
import type { ReconciliationPendencyRepository } from './reconciliation-pendency-repository.ts';

/**
 * One line of the commission report, already structured.
 *
 * The **layout** of the file — spreadsheet, CSV or PDF, column names and
 * order, one or several intermediaries with different layouts — is `DEC-001`,
 * and the requirements state outright that REQ-080 to REQ-083 are not
 * implementable without a real sample. What is *not* undecided is the content:
 * REQ-081 lists the fields the report carries and REQ-082 names the key. So
 * the core takes structured lines and the parser that produces them stays
 * outside, waiting for the decision.
 *
 * Of the fields in REQ-081 only the three the confirmed rules consume are
 * taken: the two identifiers of REQ-082 and the producer commission, which is
 * the real value of REQ-075. Accepting the rest before a rule reads them would
 * store data nothing can check.
 */
export interface CommissionReportLine {
  /** REQ-082, CA-018: the conciliation key, when the report brings it. */
  readonly policyNumber?: string;
  /** REQ-081: always present; CA-019 resolves the policy through it. */
  readonly proposalNumber: string;
  /** "Comissao do produtor (valor)" (REQ-081) — the real value of REQ-075. */
  readonly producerCommission: string;
}

export interface ReconcileCommissionReportInput {
  /** REQ-086: the period the report refers to. */
  readonly competence: string;
  readonly lines: readonly CommissionReportLine[];
}

/**
 * What happened to each line.
 *
 * - `RECONCILED`: matched a policy and the real value equals the agreed one.
 * - `DIVERGENT`: matched, values disagree (REQ-076). Not an error (REQ-077).
 * - `DUPLICATE`: the policy was already reconciled for this competence, so
 *   nothing was written (REQ-086, CA-021, REJ-012).
 * - `PENDING`: no policy matched; the pendency of REQ-083 and EX-01 is open.
 *   A second import of the same line reports it again and opens no second
 *   pendency (CA-021, EX-05).
 * - `NO_COMMISSION`: the policy exists but has no commission to compare
 *   against, because no commercial agreement was in force when it was
 *   registered. It is not a pendency of REQ-083 — the policy was found.
 */
export type ReconciliationOutcome =
  | 'RECONCILED'
  | 'DIVERGENT'
  | 'DUPLICATE'
  | 'PENDING'
  | 'NO_COMMISSION';

export interface ReconciliationLineResult {
  readonly proposalNumber: string;
  readonly policyNumber: string | null;
  readonly outcome: ReconciliationOutcome;
  readonly policyId: string | null;
  readonly reportedCommission: string;
}

export interface ReconcileCommissionReportOutput {
  readonly competence: string;
  readonly lines: readonly ReconciliationLineResult[];
  readonly reconciled: number;
  readonly divergent: number;
  readonly duplicated: number;
  readonly pending: number;
}

export interface ReconcileCommissionReportDependencies {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly commissions: CommissionRepository;
  readonly pendencies: ReconciliationPendencyRepository;
  readonly transaction: Transaction;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-02: the Financeiro imports the commission report and the system matches
 * each line with a policy.
 *
 * The whole report is one unit of work. A partially applied import would leave
 * some policies reconciled for a competence and others not, and re-importing
 * would then be refused for the first group by REQ-086 — so the existing
 * `Transaction` contract is reused, unchanged, for exactly the reason it was
 * written.
 *
 * A divergent line is a normal outcome, not a failure: REQ-077 says the
 * divergence does not block the operation, so the import goes on.
 */
export class ReconcileCommissionReport {
  private readonly deps: ReconcileCommissionReportDependencies;

  constructor(deps: ReconcileCommissionReportDependencies) {
    this.deps = deps;
  }

  async execute(input: ReconcileCommissionReportInput): Promise<ReconcileCommissionReportOutput> {
    const competence = input.competence.trim();

    if (competence === '') {
      throw new BusinessRuleViolation('REQ-086', RECONCILIATION_MESSAGES.COMPETENCE_REQUIRED);
    }

    if (input.lines.length === 0) {
      throw new BusinessRuleViolation('REQ-080', RECONCILIATION_MESSAGES.REPORT_MUST_HAVE_LINES);
    }

    const lines = await this.deps.transaction.run(async () => {
      const results: ReconciliationLineResult[] = [];

      for (const line of input.lines) {
        results.push(await this.reconcileLine(competence, line));
      }

      return results;
    });

    return {
      competence,
      lines,
      reconciled: lines.filter((line) => line.outcome === 'RECONCILED').length,
      divergent: lines.filter((line) => line.outcome === 'DIVERGENT').length,
      duplicated: lines.filter((line) => line.outcome === 'DUPLICATE').length,
      pending: lines.filter((line) => line.outcome === 'PENDING').length,
    };
  }

  private async reconcileLine(
    competence: string,
    line: CommissionReportLine,
  ): Promise<ReconciliationLineResult> {
    const proposalNumber = line.proposalNumber.trim();

    if (proposalNumber === '') {
      throw new BusinessRuleViolation('REQ-081', RECONCILIATION_MESSAGES.PROPOSAL_NUMBER_REQUIRED);
    }

    const policyNumber = line.policyNumber?.trim() || null;
    const reported = Money.fromString(line.producerCommission);
    const policy = await this.findPolicy(policyNumber, proposalNumber);

    if (policy === null) {
      // REQ-083, REJ-013: no policy, no entry. The line becomes a pendency —
      // one, not one per import: CA-021 and EX-05 say re-importing the same
      // report does not duplicate what it produced, and OUT-06 is a list a
      // human works through.
      const opened = await this.deps.pendencies.findByCompetenceAndProposalNumber(
        competence,
        proposalNumber,
      );

      if (opened === null) {
        await this.deps.pendencies.save(
          ReconciliationPendency.open({
            id: this.deps.newId(),
            competence,
            proposalNumber,
            policyNumber,
            reportedCommission: reported,
            registeredAt: this.deps.now(),
          }),
        );
      }

      return {
        proposalNumber,
        policyNumber,
        outcome: 'PENDING',
        policyId: null,
        reportedCommission: reported.toString(),
      };
    }

    const commission = await this.deps.commissions.findByPolicyId(policy.id);

    const base = {
      proposalNumber,
      policyNumber: policyNumber ?? policy.policyNumber,
      policyId: policy.id,
      reportedCommission: reported.toString(),
    };

    if (commission === null) {
      return { ...base, outcome: 'NO_COMMISSION' };
    }

    if (commission.isReconciledFor(competence)) {
      return { ...base, outcome: 'DUPLICATE' };
    }

    const reconciled = commission.reconcile(competence, reported, this.deps.now());
    await this.deps.commissions.save(reconciled);

    return { ...base, outcome: reconciled.isDivergent ? 'DIVERGENT' : 'RECONCILED' };
  }

  /**
   * REQ-082: the key is the policy number; when the report brings only the
   * proposal number, the policy is reached through the link of REQ-050.
   */
  private async findPolicy(policyNumber: string | null, proposalNumber: string) {
    if (policyNumber !== null) {
      const byNumber = await this.deps.policies.findByPolicyNumber(policyNumber);

      if (byNumber !== null) {
        return byNumber;
      }
    }

    const proposal = await this.deps.proposals.findByProposalNumber(proposalNumber);

    return proposal === null ? null : this.deps.policies.findByProposalId(proposal.id);
  }
}
