import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionView, toCommissionView } from './commission-view.ts';

export interface OverrideCommissionInput {
  readonly policyId: string;
  /** REQ-066: what the Usina receives on this policy. */
  readonly receivable?: string;
  /** REQ-066: what the Usina pays the broker on this policy. */
  readonly payable?: string;
  readonly justification: string;
  readonly userId: string;
}

export interface OverrideCommissionDependencies {
  readonly commissions: CommissionRepository;
  readonly now: () => Date;
}

/**
 * IN-14, FA-07, REQ-066: an extraordinary agreement on a single policy.
 *
 * The use case loads, delegates and writes. Whether the override is admissible
 * — a value present, positive, with a justification and a user (REQ-067,
 * REQ-123, REJ-010) — and what it does to a commission already apurada
 * (REQ-076) are rules of `Commission`.
 */
export class OverrideCommission {
  private readonly deps: OverrideCommissionDependencies;

  constructor(deps: OverrideCommissionDependencies) {
    this.deps = deps;
  }

  async execute(input: OverrideCommissionInput): Promise<CommissionView> {
    const commission = await this.deps.commissions.findByPolicyId(input.policyId);

    if (commission === null) {
      throw new RecordNotFound(COMMISSION_MESSAGES.NOT_FOUND, { policyId: input.policyId });
    }

    const overridden = commission.applyOverride({
      receivable: input.receivable === undefined ? null : Money.fromString(input.receivable),
      payable: input.payable === undefined ? null : Money.fromString(input.payable),
      justification: input.justification,
      userId: input.userId,
      at: this.deps.now(),
    });

    await this.deps.commissions.save(overridden);

    return toCommissionView(overridden);
  }
}
