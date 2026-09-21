import type { CommissionRepository } from '../../commission/application/commission-repository.ts';
import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

/**
 * One business on the broker's statement: what the Usina owes him for that
 * policy, and where its transfer is.
 *
 * OUT-07 asks for "comissoes previstas, liberadas, pagas e divergentes", which
 * is two records read together: the payable side of the commission (section
 * 10.5, REQ-093) and the transfer that pays it (section 10.6, REQ-090 to
 * REQ-095). A line with no transfer open yet is the *prevista* case — there is
 * nothing to hide and nothing to invent: the transfer is opened by an explicit
 * act of the Financeiro, because `DEC-008` has not decided the window.
 *
 * The client, the broker and the product travel as the identifier that is
 * stored and as the name IN-01 registered for it — the three REQ-096 asks a
 * repasse document to identify a business by, alongside the percentage and the
 * net value. The name is `null` while nobody registered one.
 *
 * This is still **not** the report and receipt of REQ-094/REQ-096 (OUT-08,
 * OUT-09): those also need the apuration window, and `DEC-008` has not defined
 * one. What IN-01 removed is the other half of that blockage.
 */
export interface BrokerStatementLineView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly proposalNumber: string | null;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly productId: string;
  /** REQ-022 names the field "produto/ramo": the product's name is the ramo. */
  readonly productName: string | null;
  readonly brokerId: string;
  readonly brokerName: string | null;
  /** REQ-093: what the Usina expects to pay, override of REQ-066 included. */
  readonly payable: string;
  /** Section 10.5: the state of the commission this transfer comes from. */
  readonly commissionStatus: string;
  /** REQ-076: the receivable side disagrees with what was reported. */
  readonly divergent: boolean;
  /** FP-03 step 1: null until the Financeiro opens the transfer. */
  readonly settlement: SettlementView | null;
}

/**
 * What the statement adds up, on exact cents (REQ-120).
 *
 * `payable` is the whole statement — every line, whatever its state — because
 * it answers "quanto esta comissao vale para este corretor" (REQ-093). The
 * other three are disjoint and follow section 10.6: what is held waiting for
 * the receipt confirmation (EX-07), what is released and still unpaid, and
 * what was actually sent (REQ-095, which is the informed amount, not the
 * expected one).
 */
export interface BrokerStatementTotalsView {
  readonly payable: string;
  readonly awaitingConfirmation: string;
  readonly released: string;
  readonly paid: string;
}

export interface BrokerStatementView {
  /** The broker asked for, or null when the statement covers every one. */
  readonly brokerId: string | null;
  readonly lines: readonly BrokerStatementLineView[];
  readonly totals: BrokerStatementTotalsView;
}

export interface ListBrokerStatementInput {
  /** IN-05, OUT-07: the statement is "por corretor". Absent lists every one. */
  readonly brokerId?: string;
}

export interface ListBrokerStatementDependencies {
  readonly commissions: CommissionRepository;
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  readonly settlements: SettlementRepository;
  /** IN-01: the names REQ-096 identifies a business by. */
  readonly references: ReferenceRepository;
}

/**
 * OUT-07: the commission statement of a broker — what is forecast, what is
 * held, what is released and what was paid.
 *
 * The commission is the spine of the reading, not the transfer: REQ-070 makes
 * every transfer come from a commission (`OpenSettlement` refuses without one),
 * so nothing is lost by starting there, and it is the only way a policy with
 * no transfer yet can appear at all — which OUT-07 requires when it names the
 * *previstas*.
 *
 * The broker lives on the proposal (REQ-022), so the filter is applied after
 * the proposal is read. Each line is completed one record at a time through
 * the ports that already exist, the same way the panel of OUT-05 does: the
 * statement is one line per policy of the Usina, and a query spanning four
 * modules would push into persistence a composition that belongs here.
 */
export class ListBrokerStatement {
  private readonly deps: ListBrokerStatementDependencies;

  constructor(deps: ListBrokerStatementDependencies) {
    this.deps = deps;
  }

  async execute(input: ListBrokerStatementInput = {}): Promise<BrokerStatementView> {
    const wanted = input.brokerId?.trim() ?? '';
    const commissions = await this.deps.commissions.list({});
    const names = await ReferenceNames.load(this.deps.references);

    const lines = await Promise.all(
      commissions.map(async (commission): Promise<BrokerStatementLineView | null> => {
        const policy = await this.deps.policies.findById(commission.policyId);

        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: commission.policyId });
        }

        const proposal = await this.deps.proposals.findById(policy.proposalId);

        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        if (wanted !== '' && proposal.brokerId !== wanted) {
          return null;
        }

        const settlement = await this.deps.settlements.findByPolicyId(policy.id);

        return {
          policyId: policy.id,
          policyNumber: policy.policyNumber,
          proposalNumber: proposal.proposalNumber,
          clientId: proposal.clientId,
          clientName: names.of('CLIENT', proposal.clientId),
          productId: proposal.productId,
          productName: names.of('PRODUCT', proposal.productId),
          brokerId: proposal.brokerId,
          brokerName: names.of('BROKER', proposal.brokerId),
          payable: commission.effectivePayable.toString(),
          commissionStatus: commission.status,
          divergent: commission.isDivergent,
          settlement: settlement === null ? null : toSettlementView(settlement),
        };
      }),
    );

    const statement = lines.filter((line): line is BrokerStatementLineView => line !== null);

    return {
      brokerId: wanted === '' ? null : wanted,
      lines: statement,
      totals: totalsOf(statement),
    };
  }
}

function totalsOf(lines: readonly BrokerStatementLineView[]): BrokerStatementTotalsView {
  let payable = Money.zero();
  let awaitingConfirmation = Money.zero();
  let released = Money.zero();
  let paid = Money.zero();

  for (const line of lines) {
    payable = payable.plus(Money.fromString(line.payable));

    const { settlement } = line;

    if (settlement === null) {
      continue;
    }

    // The transfer carries the amount it was opened with (REQ-124): an
    // override applied afterwards changes what is expected, not what is
    // already being transferred, so the buckets add the transfer's own value.
    if (settlement.status === 'AWAITING_CONFIRMATION') {
      awaitingConfirmation = awaitingConfirmation.plus(Money.fromString(settlement.amount));
    }

    if (settlement.status === 'RELEASED') {
      released = released.plus(Money.fromString(settlement.amount));
    }

    // REQ-095: what was actually sent, which may differ from what was expected.
    if (settlement.payment !== null) {
      paid = paid.plus(Money.fromString(settlement.payment.amount));
    }
  }

  return {
    payable: payable.toString(),
    awaitingConfirmation: awaitingConfirmation.toString(),
    released: released.toString(),
    paid: paid.toString(),
  };
}
