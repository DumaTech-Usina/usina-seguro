import {
  PaymentMethodReleaseRule,
  type ReleaseRule,
} from '../domain/payment-method-release-rule.ts';
import type { PaymentMethodReleaseRuleRepository } from './payment-method-release-rule-repository.ts';
import {
  type PaymentMethodReleaseRuleView,
  toPaymentMethodReleaseRuleView,
} from './payment-method-release-rule-view.ts';

export interface RegisterPaymentMethodReleaseRuleInput {
  readonly paymentMethodId: string;
  readonly release: ReleaseRule;
}

export interface RegisterPaymentMethodReleaseRuleDependencies {
  readonly releaseRules: PaymentMethodReleaseRuleRepository;
  readonly now: () => Date;
}

/**
 * IN-06, REQ-090, CA-024: the Administrator configures how a payment method
 * releases the broker transfer, without a code change (REQ-125).
 */
export class RegisterPaymentMethodReleaseRule {
  private readonly deps: RegisterPaymentMethodReleaseRuleDependencies;

  constructor(deps: RegisterPaymentMethodReleaseRuleDependencies) {
    this.deps = deps;
  }

  async execute(
    input: RegisterPaymentMethodReleaseRuleInput,
  ): Promise<PaymentMethodReleaseRuleView> {
    const rule = PaymentMethodReleaseRule.register({
      paymentMethodId: input.paymentMethodId,
      release: input.release,
      registeredAt: this.deps.now(),
    });

    await this.deps.releaseRules.save(rule);

    return toPaymentMethodReleaseRuleView(rule);
  }
}
