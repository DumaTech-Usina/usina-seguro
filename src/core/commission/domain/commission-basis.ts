import { commissionBase } from '../../proposal/domain/expected-receipt.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';

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
}

export interface CalculatedCommission {
  readonly basis: CommissionBasis;
  /** What the Usina expects to receive. */
  readonly receivable: Money;
}

/**
 * REQ-236: the agreed commission of a policy comes from its proposal — the CT,
 * or CT then CTU through the intermediary (REQ-230, REQ-231) — and never from
 * a registered commercial agreement (REJ-203). What the Usina receives is the
 * proposal's own expected receipt, so the rule lives in one place.
 *
 * There is no broker side here: the broker's part is the CR informed on the
 * policy (REQ-270), never a table.
 */
export function calculateCommission(proposal: Proposal): CalculatedCommission {
  const expected = proposal.expectedReceipt();
  const receipt = proposal.receipt;

  return {
    basis: {
      premium: commissionBase(proposal.netPremium, proposal.workedCommissionMode),
      insurerRate: proposal.workedCommission,
      insurerAmount: expected.intermediary ?? expected.usina,
      intermediaryId: receipt.kind === 'INTERMEDIARY' ? receipt.intermediaryId : null,
      intermediaryRate: receipt.kind === 'INTERMEDIARY' ? receipt.ctu : null,
    },
    receivable: expected.usina,
  };
}
