import type { Money } from './money.ts';
import type { Percentage } from './percentage.ts';
import type { Receipt } from './receipt.ts';
import type { WorkedCommissionMode } from './worked-commission.ts';

/**
 * What the Usina expects to receive, known from the proposal on (REQ-232).
 *
 * `intermediary` is what the intermediary receives when there is one, and
 * `null` when the receipt is direct. The broker payout is not part of this
 * (REQ-233, REJ-207).
 */
export interface ExpectedReceipt {
  readonly intermediary: Money | null;
  readonly usina: Money;
}

/**
 * REQ-235: the amount the CT is applied to.
 *
 * Kept apart from `expectedReceipt` on purpose. Whether a parcelled CT takes
 * the installments as its base is `DEC-203`, still open; until it is decided,
 * the base is the net premium whatever the mode. The day it is decided, this is
 * the only function that changes.
 */
export function commissionBase(netPremium: Money, _mode: WorkedCommissionMode): Money {
  return netPremium;
}

/**
 * REQ-230, REQ-231: applies the CT to the base and, through an intermediary,
 * the CTU to what the intermediary received.
 *
 * The CT is the one informed on the proposal, never the rate of a registered
 * commercial agreement (REQ-212, REJ-203). Rounding is `Money.applyRate`'s.
 */
export function expectedReceipt(base: Money, ct: Percentage, receipt: Receipt): ExpectedReceipt {
  const worked = base.applyRate(ct);

  if (receipt.kind === 'DIRECT') {
    return { intermediary: null, usina: worked };
  }

  return { intermediary: worked, usina: worked.applyRate(receipt.ctu) };
}
