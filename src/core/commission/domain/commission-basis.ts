import { type ExpectedReceipt, commissionBase } from '../../proposal/domain/expected-receipt.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import type { BrokerCommissionRate } from './broker-commission-rate.ts';

/**
 * REQ-234: which amount the broker's rate is applied to — what the
 * intermediary received, or what the Usina received.
 */
export type BrokerBase = 'INTERMEDIARY' | 'USINA';

/**
 * Everything the calculation consumed, kept next to its result.
 *
 * The rates are **copied**, not looked up again when the commission is read:
 * the record says which numbers produced it, which keeps the agreed-versus-real
 * comparison auditable.
 */
export interface CommissionBasis {
  /** REQ-235: the amount the CT was applied to — the net premium. */
  readonly premium: Money;
  /** REQ-212: the CT of the proposal. */
  readonly insurerRate: Percentage;
  /** Premium x CT: what the insurer paid, to the intermediary or to the Usina. */
  readonly insurerAmount: Money;
  readonly intermediaryId: string | null;
  /** REQ-221: the CTU, when there is an intermediary. */
  readonly intermediaryRate: Percentage | null;
  readonly brokerBase: BrokerBase;
  /** REQ-234: the amount the broker's rate was applied to. */
  readonly brokerBaseAmount: Money;
  readonly brokerRate: Percentage;
}

export interface CalculatedCommission {
  readonly basis: CommissionBasis;
  /** What the Usina expects to receive. */
  readonly receivable: Money;
  /** What the Usina expects to pay the broker. */
  readonly payable: Money;
}

/**
 * REQ-234: the base of the broker payout, kept apart so another rule can
 * coexist without rewriting what the Usina receives (CA-211). Today it is what
 * the Usina received.
 */
function brokerBaseOf(expected: ExpectedReceipt): { base: BrokerBase; amount: Money } {
  return { base: 'USINA', amount: expected.usina };
}

/**
 * REQ-236: the agreed commission of a policy comes from its proposal — the CT,
 * or CT then CTU through the intermediary (REQ-230, REQ-231) — and never from
 * a registered commercial agreement (REJ-203). What the Usina receives is the
 * proposal's own expected receipt, so the rule lives in one place.
 *
 * The broker side is the broker table (IN-05) applied to the base of REQ-234.
 */
export function calculateCommission(
  proposal: Proposal,
  brokerRate: BrokerCommissionRate,
): CalculatedCommission {
  const expected = proposal.expectedReceipt();
  const receipt = proposal.receipt;
  const broker = brokerBaseOf(expected);

  return {
    basis: {
      premium: commissionBase(proposal.netPremium, proposal.workedCommissionMode),
      insurerRate: proposal.workedCommission,
      insurerAmount: expected.intermediary ?? expected.usina,
      intermediaryId: receipt.kind === 'INTERMEDIARY' ? receipt.intermediaryId : null,
      intermediaryRate: receipt.kind === 'INTERMEDIARY' ? receipt.ctu : null,
      brokerBase: broker.base,
      brokerBaseAmount: broker.amount,
      brokerRate: brokerRate.rate,
    },
    receivable: expected.usina,
    payable: broker.amount.applyRate(brokerRate.rate),
  };
}
