import type { Policy } from '../../policy/domain/policy.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
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

/**
 * One line of the consolidated panel of OUT-05.
 *
 * It answers the question the panel exists for — which policies agree with
 * what was reported and which do not (REQ-076, CA-016, CA-017) — so it carries
 * the pair and the flag, like `CommissionView`, and drops the basis, which is
 * detail of a single policy.
 *
 * The commission knows the policy by id and nothing else, so what identifies
 * the business to a human comes from the records that hold it: the number the
 * insurer issued for the policy (REQ-020) and for the proposal (REQ-050), and
 * the client, insurer and product references the proposal carries (REQ-022).
 * Those references travel as they are stored: the registries of IN-01 are not
 * modelled yet, so there is no name to resolve.
 */
export interface CommissionListItemView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly proposalNumber: string | null;
  readonly clientId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly status: string;
  readonly calculatedAt: string;
  /** Calculated from the agreement, before any override (REQ-075). */
  readonly agreedReceivable: string;
  /** Agreed values actually in use, override included (REQ-066). */
  readonly effectiveReceivable: string;
  readonly effectivePayable: string;
  /** Apurada na conciliacao (REQ-075); null until a report matches. */
  readonly realReceivable: string | null;
  readonly divergent: boolean;
  readonly reconciledCompetence: string | null;
}

export function toCommissionListItemView(
  commission: Commission,
  policy: Policy,
  proposal: Proposal,
): CommissionListItemView {
  return {
    policyId: commission.policyId,
    policyNumber: policy.policyNumber,
    proposalNumber: proposal.proposalNumber,
    clientId: proposal.clientId,
    insurerId: proposal.insurerId,
    productId: proposal.productId,
    status: commission.status,
    calculatedAt: commission.calculatedAt.toISOString(),
    agreedReceivable: commission.agreedReceivable.toString(),
    effectiveReceivable: commission.effectiveReceivable.toString(),
    effectivePayable: commission.effectivePayable.toString(),
    realReceivable: commission.realReceivable?.toString() ?? null,
    divergent: commission.isDivergent,
    reconciledCompetence: commission.reconciledCompetence,
  };
}
