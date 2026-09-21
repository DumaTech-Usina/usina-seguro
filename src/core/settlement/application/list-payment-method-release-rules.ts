import type { PaymentMethodReleaseRuleRepository } from './payment-method-release-rule-repository.ts';
import {
  type PaymentMethodReleaseRuleView,
  toPaymentMethodReleaseRuleView,
} from './payment-method-release-rule-view.ts';

export interface ListPaymentMethodReleaseRulesDependencies {
  readonly releaseRules: PaymentMethodReleaseRuleRepository;
}

/**
 * IN-06, REQ-090: how each payment method releases the broker transfer.
 *
 * CA-024 requires changing this configuration to change the behaviour without
 * a deploy, and REQ-125 makes it data. Reading it back is what turns that into
 * something an administrator can act on: it shows which payment methods have a
 * rule and, by their absence, which ones do not — Pix among them, whose rule
 * DEC-002 has not decided and which this listing therefore does not invent.
 */
export class ListPaymentMethodReleaseRules {
  private readonly deps: ListPaymentMethodReleaseRulesDependencies;

  constructor(deps: ListPaymentMethodReleaseRulesDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly PaymentMethodReleaseRuleView[]> {
    const rules = await this.deps.releaseRules.list();

    return rules.map(toPaymentMethodReleaseRuleView);
  }
}
