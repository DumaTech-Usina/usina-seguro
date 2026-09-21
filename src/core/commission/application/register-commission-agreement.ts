import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import {
  type BrokerBase,
  CommissionAgreement,
  type CommissionChain,
} from '../domain/commission-agreement.ts';
import type { CommissionAgreementRepository } from './commission-agreement-repository.ts';
import {
  type CommissionAgreementView,
  toCommissionAgreementView,
} from './commission-agreement-view.ts';

export interface RegisterCommissionAgreementInput {
  readonly insurerId: string;
  readonly productId: string;
  readonly effectiveFrom: string;
  readonly insurerRate: string;
  /** Absent means a direct chain (REQ-060, REQ-062). */
  readonly intermediary?: {
    readonly intermediaryId: string;
    readonly intermediaryRate: string;
    /** REQ-063 default when omitted, REQ-064 when informed. */
    readonly brokerBase?: BrokerBase;
  };
}

export interface RegisterCommissionAgreementDependencies {
  readonly agreements: CommissionAgreementRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * IN-02, IN-03, IN-04: the Administrator maintains the commercial agreement,
 * the chain and the base of the intermediary.
 *
 * It is a registry operation, not a calculation: REQ-061 and REQ-125 require
 * these parameters to change without a code change, and REQ-124 keeps each
 * version as its own record, distinguished by the date its validity starts.
 */
export class RegisterCommissionAgreement {
  private readonly deps: RegisterCommissionAgreementDependencies;

  constructor(deps: RegisterCommissionAgreementDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterCommissionAgreementInput): Promise<CommissionAgreementView> {
    const chain: CommissionChain =
      input.intermediary === undefined
        ? { kind: 'DIRECT' }
        : {
            kind: 'INTERMEDIARY',
            intermediaryId: input.intermediary.intermediaryId,
            intermediaryRate: Percentage.fromString(input.intermediary.intermediaryRate),
            // REQ-063: with an intermediary the base defaults to what the
            // intermediary received; REQ-064 lets the configuration say otherwise.
            brokerBase: input.intermediary.brokerBase ?? 'INTERMEDIARY',
          };

    const agreement = CommissionAgreement.register({
      id: this.deps.newId(),
      insurerId: input.insurerId,
      productId: input.productId,
      effectiveFrom: CalendarDate.fromString(input.effectiveFrom),
      insurerRate: Percentage.fromString(input.insurerRate),
      chain,
      registeredAt: this.deps.now(),
    });

    await this.deps.agreements.save(agreement);

    // The same shape the listing answers, so a record just registered and a
    // record read back are the same document to whoever displays them.
    return toCommissionAgreementView(agreement);
  }
}
