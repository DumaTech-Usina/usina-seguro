import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';
import type { Money } from './money.ts';

/**
 * Documented proposal states (section 10.2 of the requirements).
 *
 * Only `DRAFT` is reachable at this stage: transmission and outcome
 * (REQ-041..REQ-049) belong to the next vertical slice.
 *
 * The identifiers are English; the Portuguese names used by the business
 * (RASCUNHO, TRANSMITIDA, ...) are a presentation concern and live in the i18n
 * dictionary.
 */
export type ProposalStatus = 'DRAFT' | 'TRANSMITTED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

/**
 * Data required to register a proposal.
 *
 * Client, broker, insurer, product and payment method are registries owned by
 * the Administrator (IN-01, IN-06) and are not modelled yet. The proposal only
 * keeps the reference; validating that those records exist will make sense once
 * the corresponding modules exist.
 *
 * `proposalNumber` and `workedCommission` are absent on purpose: the number is
 * issued by the insurer and the worked commission is informed at transmission
 * time (REQ-041), which happens after registration (FP-01, steps 3 and 4).
 */
export interface ProposalRegistrationData {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  /** Reference to the payment method registry (REQ-040). */
  readonly paymentMethodId: string;
  /** REQ-040: the customer's acceptance precedes registering the proposal. */
  readonly customerAccepted: boolean;
  readonly netPremium: Money;
  readonly registeredAt: Date;
}

export class Proposal {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly customerAccepted: boolean;
  readonly netPremium: Money;
  readonly registeredAt: Date;
  readonly status: ProposalStatus;

  private constructor(data: ProposalRegistrationData, status: ProposalStatus) {
    this.id = data.id;
    this.clientId = data.clientId;
    this.brokerId = data.brokerId;
    this.insurerId = data.insurerId;
    this.productId = data.productId;
    this.paymentMethodId = data.paymentMethodId;
    this.customerAccepted = data.customerAccepted;
    this.netPremium = data.netPremium;
    this.registeredAt = data.registeredAt;
    this.status = status;
  }

  /**
   * REQ-040 / REJ-004: a proposal only exists with the customer's acceptance
   * and a defined payment method. Without those there is no proposal — the
   * registration is rejected.
   */
  static register(data: ProposalRegistrationData): Proposal {
    if (!data.customerAccepted) {
      throw new BusinessRuleViolation('REQ-040', PROPOSAL_MESSAGES.CUSTOMER_ACCEPTANCE_REQUIRED);
    }

    if (data.paymentMethodId.trim() === '') {
      throw new BusinessRuleViolation('REQ-040', PROPOSAL_MESSAGES.PAYMENT_METHOD_REQUIRED);
    }

    for (const [field, value] of [
      ['clientId', data.clientId],
      ['brokerId', data.brokerId],
      ['insurerId', data.insurerId],
      ['productId', data.productId],
    ] as const) {
      if (value.trim() === '') {
        throw new BusinessRuleViolation('REQ-022', PROPOSAL_MESSAGES.FIELD_REQUIRED, { field });
      }
    }

    if (!data.netPremium.isPositive()) {
      throw new BusinessRuleViolation('REQ-022', PROPOSAL_MESSAGES.NET_PREMIUM_MUST_BE_POSITIVE);
    }

    return new Proposal(data, 'DRAFT');
  }

  /**
   * Rebuilds a proposal from persisted data without re-applying the creation
   * rules: a record stored in the past cannot be invalidated by a rule created
   * afterwards (REQ-124).
   */
  static restore(data: ProposalRegistrationData, status: ProposalStatus): Proposal {
    return new Proposal(data, status);
  }
}
