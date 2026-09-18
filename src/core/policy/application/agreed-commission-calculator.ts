import type { Money } from '../../proposal/domain/money.ts';

/**
 * What the policy hands over so the agreed commission can be calculated.
 *
 * The minimum the other side needs and nothing else: the policy entity is not
 * shipped across the boundary. `premium` travels because REQ-051 makes it the
 * only admissible calculation base, and `proposalId` because the insurer, the
 * product and the broker — which select the commercial agreement (REQ-065) and
 * the broker table (IN-05) — live on the proposal.
 */
export interface AgreedCommissionRequest {
  readonly policyId: string;
  readonly proposalId: string;
  readonly premium: Money;
  /** REQ-065: which agreement was in force when the calculation was made. */
  readonly calculatedAt: Date;
}

/**
 * FP-01 step 7: once the policy is created, the system calculates the agreed
 * commission.
 *
 * The port is declared here, by the side that needs it, so the policy module
 * stays unaware of the commission module: the commission module implements
 * this interface and the composition root connects the two. The direction is
 * `commission -> policy`, never the reverse.
 *
 * REQ-070 and CA-009 are satisfied by where the call sits: nothing is
 * calculated before the policy exists.
 */
export interface AgreedCommissionCalculator {
  calculateFor(request: AgreedCommissionRequest): Promise<void>;
}
