import type { Commission } from '../domain/commission.ts';

/**
 * Representation of a commission at the core boundary.
 *
 * CA-016 and REQ-076 ask for the agreed and the real value **side by side**
 * with the divergence signalled, so the view carries both and the flag, rather
 * than leaving the comparison to whoever renders it.
 */
export interface CommissionBasisView {
  readonly premium: string;
  readonly insurerRate: string;
  readonly insurerAmount: string;
  readonly intermediaryId: string | null;
  readonly intermediaryRate: string | null;
  readonly brokerBase: string;
  readonly brokerBaseAmount: string;
  readonly brokerRate: string;
}

export interface CommissionView {
  readonly id: string;
  readonly policyId: string;
  readonly status: string;
  readonly calculatedAt: string;
  /** Calculated from the agreement, before any override (REQ-075). */
  readonly agreedReceivable: string;
  readonly agreedPayable: string;
  /** Agreed values actually in use, override included (REQ-066). */
  readonly effectiveReceivable: string;
  readonly effectivePayable: string;
  /** Apurada na conciliacao (REQ-075); null until a report matches. */
  readonly realReceivable: string | null;
  readonly divergent: boolean;
  readonly reconciledCompetence: string | null;
  readonly override: {
    readonly receivable: string | null;
    readonly payable: string | null;
    readonly justification: string;
    readonly userId: string;
    readonly at: string;
  } | null;
  readonly resolution: {
    readonly justification: string;
    readonly userId: string;
    readonly at: string;
  } | null;
  readonly basis: CommissionBasisView;
}

export function toCommissionView(commission: Commission): CommissionView {
  const { basis, override, resolution } = commission;

  return {
    id: commission.id,
    policyId: commission.policyId,
    status: commission.status,
    calculatedAt: commission.calculatedAt.toISOString(),
    agreedReceivable: commission.agreedReceivable.toString(),
    agreedPayable: commission.agreedPayable.toString(),
    effectiveReceivable: commission.effectiveReceivable.toString(),
    effectivePayable: commission.effectivePayable.toString(),
    realReceivable: commission.realReceivable?.toString() ?? null,
    divergent: commission.isDivergent,
    reconciledCompetence: commission.reconciledCompetence,
    override:
      override === null
        ? null
        : {
            receivable: override.receivable?.toString() ?? null,
            payable: override.payable?.toString() ?? null,
            justification: override.justification,
            userId: override.userId,
            at: override.at.toISOString(),
          },
    resolution:
      resolution === null
        ? null
        : {
            justification: resolution.justification,
            userId: resolution.userId,
            at: resolution.at.toISOString(),
          },
    basis: {
      premium: basis.premium.toString(),
      insurerRate: basis.insurerRate.toString(),
      insurerAmount: basis.insurerAmount.toString(),
      intermediaryId: basis.intermediaryId,
      intermediaryRate: basis.intermediaryRate?.toString() ?? null,
      brokerBase: basis.brokerBase,
      brokerBaseAmount: basis.brokerBaseAmount.toString(),
      brokerRate: basis.brokerRate.toString(),
    },
  };
}
