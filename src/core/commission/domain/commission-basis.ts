import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import type { BrokerCommissionRate } from './broker-commission-rate.ts';
import type { BrokerBase, CommissionAgreement } from './commission-agreement.ts';

/**
 * Everything the calculation consumed, kept next to its result.
 *
 * The rates are **copied**, not looked up again when the commission is read.
 * That is what makes editing an agreement or a broker table change future
 * calculations only (CA-012, REJ-011) and what makes the agreed-versus-real
 * comparison of REQ-076 auditable: the record says which numbers produced it.
 */
export interface CommissionBasis {
  /** REQ-051: the policy premium, the only admissible calculation base. */
  readonly premium: Money;
  readonly insurerRate: Percentage;
  /** REQ-069: what the insurer paid, to the intermediary or to the Usina. */
  readonly insurerAmount: Money;
  readonly intermediaryId: string | null;
  readonly intermediaryRate: Percentage | null;
  readonly brokerBase: BrokerBase;
  /** REQ-062, REQ-063, REQ-064: the amount the broker's rate was applied to. */
  readonly brokerBaseAmount: Money;
  readonly brokerRate: Percentage;
}

export interface CalculatedCommission {
  readonly basis: CommissionBasis;
  /** What the Usina expects to receive (REQ-075, receivable side). */
  readonly receivable: Money;
  /** What the Usina expects to pay the broker (REQ-075, payable side). */
  readonly payable: Money;
}

/**
 * Walks the commission chain of REQ-060 over the policy premium.
 *
 * Direct chain (REQ-062, REQ-068):
 * ```
 * premium x insurerRate                 -> the Usina receives
 * received by the Usina x brokerRate    -> the broker receives
 * ```
 *
 * Chain with an intermediary (REQ-063, REQ-064, REQ-069):
 * ```
 * premium x insurerRate                 -> the intermediary receives
 * that x intermediaryRate               -> the Usina receives
 * base (intermediary's by default, the Usina's when configured) x brokerRate
 *                                       -> the broker receives
 * ```
 *
 * The premium is the base because REQ-051 admits no other, and the function is
 * pure: it neither reads nor writes anything, so the rule is testable on its
 * own.
 */
export function calculateCommission(
  premium: Money,
  agreement: CommissionAgreement,
  brokerRate: BrokerCommissionRate,
): CalculatedCommission {
  const insurerAmount = premium.applyRate(agreement.insurerRate);
  const chain = agreement.chain;

  const receivable =
    chain.kind === 'DIRECT' ? insurerAmount : insurerAmount.applyRate(chain.intermediaryRate);

  // REQ-062: without an intermediary there is only one candidate, what the
  // Usina received. REQ-063/REQ-064: with one, the configuration decides.
  const brokerBase: BrokerBase = chain.kind === 'DIRECT' ? 'USINA' : chain.brokerBase;
  const brokerBaseAmount = brokerBase === 'USINA' ? receivable : insurerAmount;

  return {
    basis: {
      premium,
      insurerRate: agreement.insurerRate,
      insurerAmount,
      intermediaryId: chain.kind === 'INTERMEDIARY' ? chain.intermediaryId : null,
      intermediaryRate: chain.kind === 'INTERMEDIARY' ? chain.intermediaryRate : null,
      brokerBase,
      brokerBaseAmount,
      brokerRate: brokerRate.rate,
    },
    receivable,
    // REQ-093: the broker's table applied to the base defined by the chain.
    payable: brokerBaseAmount.applyRate(brokerRate.rate),
  };
}
