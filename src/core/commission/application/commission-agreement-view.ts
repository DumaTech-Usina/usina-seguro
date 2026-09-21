import type { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { CommissionAgreement } from '../domain/commission-agreement.ts';

/**
 * Representation of a commercial agreement at the core boundary (IN-02, IN-03,
 * IN-04, REQ-065).
 *
 * The chain is flattened into the three fields that describe it, rather than
 * travelling as the discriminated union the domain uses: outside the core there
 * is no pattern matching, and a caller reading a direct chain would otherwise
 * have to know that `intermediaryId` is absent. A direct chain answers
 * `brokerBase: 'USINA'` because that is what REQ-062 says the base is when
 * nobody sits between the insurer and the Usina.
 *
 * `registeredAt` travels because REQ-124 keeps every version as its own record:
 * two agreements for the same insurer and product differ by the day their
 * validity starts, and the moment each was written is what tells an
 * administrator which of them is the correction they just made.
 */
export interface CommissionAgreementView {
  readonly id: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly effectiveFrom: string;
  readonly insurerRate: string;
  readonly chain: string;
  readonly intermediaryId: string | null;
  /** IN-01: the name registered for the intermediary, null while there is none. */
  readonly intermediaryName: string | null;
  readonly intermediaryRate: string | null;
  readonly brokerBase: string;
  readonly registeredAt: string;
}

export function toCommissionAgreementView(
  agreement: CommissionAgreement,
  names: ReferenceNames,
): CommissionAgreementView {
  const chain = agreement.chain;

  return {
    id: agreement.id,
    insurerId: agreement.insurerId,
    productId: agreement.productId,
    effectiveFrom: agreement.effectiveFrom.toString(),
    insurerRate: agreement.insurerRate.toString(),
    chain: chain.kind,
    intermediaryId: chain.kind === 'INTERMEDIARY' ? chain.intermediaryId : null,
    intermediaryName:
      chain.kind === 'INTERMEDIARY' ? names.of('INTERMEDIARY', chain.intermediaryId) : null,
    intermediaryRate: chain.kind === 'INTERMEDIARY' ? chain.intermediaryRate.toString() : null,
    // REQ-062: without an intermediary there is only one amount to calculate on.
    brokerBase: chain.kind === 'INTERMEDIARY' ? chain.brokerBase : 'USINA',
    registeredAt: agreement.registeredAt.toISOString(),
  };
}
