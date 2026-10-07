import {
  type ParcelledPayoutDependencies,
  loadParcelledPayout,
} from './parcelled-payout-context.ts';
import {
  type ParcelledPolicyPayoutView,
  toParcelledPolicyPayoutView,
} from './parcelled-payout-view.ts';

/**
 * REQ-268, REQ-293: a policy with parcelled CT seen from its payout — its
 * situation, each installment with its value, CT, Usina value and, once there
 * are CRs, its payout and eligibility.
 */
export class GetParcelledPayout {
  private readonly deps: Pick<
    ParcelledPayoutDependencies,
    'policies' | 'proposals' | 'parcelledPayouts'
  >;

  constructor(
    deps: Pick<ParcelledPayoutDependencies, 'policies' | 'proposals' | 'parcelledPayouts'>,
  ) {
    this.deps = deps;
  }

  async execute(policyId: string): Promise<ParcelledPolicyPayoutView> {
    const { policy, proposal, commission } = await loadParcelledPayout(this.deps, policyId);
    return toParcelledPolicyPayoutView(policy, proposal, commission);
  }
}
