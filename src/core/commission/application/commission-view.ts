import type { Policy } from '../../policy/domain/policy.ts';
import type { Proposal } from '../../proposal/domain/proposal.ts';
import type { ReferenceNames } from '../../registry/application/reference-names.ts';
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
}

export interface CommissionView {
  readonly id: string;
  readonly policyId: string;
  readonly status: string;
  readonly calculatedAt: string;
  /** Calculated from the agreement, before any override (REQ-075). */
  readonly agreedReceivable: string;
  /** Agreed value actually in use, override included (REQ-066). */
  readonly effectiveReceivable: string;
  /** Apurada na conciliacao (REQ-075); null until a report matches. */
  readonly realReceivable: string | null;
  readonly divergent: boolean;
  readonly reconciledCompetence: string | null;
  readonly override: {
    readonly receivable: string;
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
    effectiveReceivable: commission.effectiveReceivable.toString(),
    realReceivable: commission.realReceivable?.toString() ?? null,
    divergent: commission.isDivergent,
    reconciledCompetence: commission.reconciledCompetence,
    override:
      override === null
        ? null
        : {
            receivable: override.receivable.toString(),
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
 * Each reference travels as the identifier that is stored and as the name
 * IN-01 registered for it, which is `null` while nobody registered one.
 */
export interface CommissionListItemView {
  readonly policyId: string;
  readonly policyNumber: string;
  readonly proposalNumber: string | null;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly insurerId: string;
  readonly insurerName: string | null;
  readonly productId: string;
  /** REQ-022 names the field "produto/ramo": the product's name is the ramo. */
  readonly productName: string | null;
  readonly status: string;
  readonly calculatedAt: string;
  /** Calculated from the agreement, before any override (REQ-075). */
  readonly agreedReceivable: string;
  /** Agreed value actually in use, override included (REQ-066). */
  readonly effectiveReceivable: string;
  /** Apurada na conciliacao (REQ-075); null until a report matches. */
  readonly realReceivable: string | null;
  readonly divergent: boolean;
  readonly reconciledCompetence: string | null;
}

export function toCommissionListItemView(
  commission: Commission,
  policy: Policy,
  proposal: Proposal,
  names: ReferenceNames,
): CommissionListItemView {
  return {
    policyId: commission.policyId,
    policyNumber: policy.policyNumber,
    proposalNumber: proposal.proposalNumber,
    clientId: proposal.clientId,
    clientName: names.of('CLIENT', proposal.clientId),
    insurerId: proposal.insurerId,
    insurerName: names.of('INSURER', proposal.insurerId),
    productId: proposal.productId,
    productName: names.of('PRODUCT', proposal.productId),
    status: commission.status,
    calculatedAt: commission.calculatedAt.toISOString(),
    agreedReceivable: commission.agreedReceivable.toString(),
    effectiveReceivable: commission.effectiveReceivable.toString(),
    realReceivable: commission.realReceivable?.toString() ?? null,
    divergent: commission.isDivergent,
    reconciledCompetence: commission.reconciledCompetence,
  };
}
