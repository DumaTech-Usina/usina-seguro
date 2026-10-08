/**
 * What the policy hands over so the agreed commission can be calculated.
 *
 * The minimum the other side needs and nothing else: the policy entity is not
 * shipped across the boundary. `proposalId` is the whole of the input, because
 * REQ-236 takes the calculation from the proposal — its net premium, CT and
 * CTU.
 */
export interface AgreedCommissionRequest {
  readonly policyId: string;
  readonly proposalId: string;
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
 * The base is canonized on the policy (REQ-232, REQ-245): the agreed
 * commission is calculated when the policy exists, not before.
 */
export interface AgreedCommissionCalculator {
  calculateFor(request: AgreedCommissionRequest): Promise<void>;
}
