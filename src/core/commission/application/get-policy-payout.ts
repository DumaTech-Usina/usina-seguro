import type { PolicyPayoutView } from './payout-commission-view.ts';
import {
  type PayoutDependencies,
  loadPolicyPayout,
  toPolicyPayoutView,
} from './policy-payout-context.ts';

/**
 * REQ-273, REQ-278, REQ-285: a policy seen from FP-02 — its situation, the
 * Usina value and its payout commission, if any. From the policy one reaches
 * its commission (REQ-284).
 */
export class GetPolicyPayout {
  private readonly deps: Pick<PayoutDependencies, 'policies' | 'proposals' | 'payouts'>;

  constructor(deps: Pick<PayoutDependencies, 'policies' | 'proposals' | 'payouts'>) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<PolicyPayoutView> {
    return toPolicyPayoutView(await loadPolicyPayout(this.deps, policyId));
  }
}
