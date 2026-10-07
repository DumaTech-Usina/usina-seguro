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
 * REQ-235: the amount the integral CT is applied to — the net premium.
 *
 * Kept apart from `expectedReceipt` on purpose: the choice of the base is
 * decoupled from the calculation. A parcelled CT has its own base, the value of
 * each installment (`expectedInstallmentReceipts`, REQ-293).
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

/** REQ-293: what the Usina expects from one installment of a parcelled CT. */
export interface ExpectedInstallmentReceipt {
  /** Position in the list, starting at 1 (REQ-291). */
  readonly number: number;
  /** The installment value as informed: the base (REQ-293). */
  readonly amount: Money;
  /** The CT applied to it: the first's on installment 1, the other on the rest. */
  readonly workedCommission: Percentage;
  readonly usina: Money;
}

/**
 * REQ-291, REQ-293, REQ-294: with a parcelled CT, each CT is applied to the
 * value of the installment — never to the net premium (REJ-231) — and the
 * result is the expected value of that installment. Nothing is accumulated
 * (REJ-232). There is no intermediary to chain (REQ-296). Rounding is
 * `Money.applyRate`'s (REQ-298).
 */
export function expectedInstallmentReceipts(
  installments: readonly { readonly amount: Money }[],
  firstInstallment: Percentage,
  subsequentInstallments: Percentage,
): ExpectedInstallmentReceipt[] {
  return installments.map((installment, index) => {
    const workedCommission = index === 0 ? firstInstallment : subsequentInstallments;

    return {
      number: index + 1,
      amount: installment.amount,
      workedCommission,
      usina: installment.amount.applyRate(workedCommission),
    };
  });
}
