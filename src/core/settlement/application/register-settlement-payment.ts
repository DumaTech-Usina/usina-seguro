import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { SETTLEMENT_MESSAGES } from '../domain/errors.ts';
import type { SettlementRepository } from './settlement-repository.ts';
import { type SettlementView, toSettlementView } from './settlement-view.ts';

export interface RegisterSettlementPaymentInput {
  readonly policyId: string;
  readonly amount: string;
  /** REQ-095: reference of the attached proof. */
  readonly proofReference: string;
  readonly userId: string;
}

export interface RegisterSettlementPaymentDependencies {
  readonly settlements: SettlementRepository;
  readonly now: () => Date;
}

/**
 * FP-03 step 5, REQ-095, IN-15, CA-028: records the payment sent to the
 * broker.
 *
 * The system does not execute the transfer (REQ-013); it registers that it
 * happened, which is what REQ-002 makes it responsible for.
 */
export class RegisterSettlementPayment {
  private readonly deps: RegisterSettlementPaymentDependencies;

  constructor(deps: RegisterSettlementPaymentDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterSettlementPaymentInput): Promise<SettlementView> {
    const settlement = await this.deps.settlements.findByPolicyId(input.policyId);

    if (settlement === null) {
      throw new RecordNotFound(SETTLEMENT_MESSAGES.NOT_FOUND, { policyId: input.policyId });
    }

    const paid = settlement.registerPayment({
      paidAt: this.deps.now(),
      amount: Money.fromString(input.amount),
      proofReference: input.proofReference,
      userId: input.userId,
    });

    await this.deps.settlements.save(paid);

    return toSettlementView(paid);
  }
}
