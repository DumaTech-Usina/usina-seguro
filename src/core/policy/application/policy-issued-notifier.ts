/**
 * What the policy hands over so the broker can be notified (REQ-100).
 *
 * The minimum the other side needs and nothing else: the policy entity is not
 * shipped across the boundary. `proposalId` travels because the five fields
 * REQ-100 requires — client, broker, worked percentage, net value and ramo —
 * live on the proposal (REQ-022, REQ-041), and the policy number travels
 * because it is what identifies the emission that was effectuated.
 */
export interface PolicyIssuedEvent {
  readonly policyId: string;
  readonly proposalId: string;
  readonly policyNumber: string;
  /** REQ-105: when the emission was registered, which is when it happened. */
  readonly issuedAt: Date;
}

/**
 * FP-01 step 7: once the policy is registered, the broker is notified.
 *
 * The port is declared here, by the side that needs it, exactly like
 * `AgreedCommissionCalculator`: the notification module implements this
 * interface and the composition root connects the two, so the arrow points
 * `notification -> policy` and `RegisterPolicy` never learns that
 * notifications, let alone channels, exist.
 *
 * That is what satisfies REJ-017 and CA-030 at this end of the flow: the rule
 * that triggers the notification names no channel, so adding one changes
 * nothing here.
 */
export interface PolicyIssuedNotifier {
  notify(event: PolicyIssuedEvent): Promise<void>;
}
