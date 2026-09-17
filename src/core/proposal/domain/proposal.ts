import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';
import type { Money } from './money.ts';
import type { Percentage } from './percentage.ts';

/**
 * Documented proposal states (section 10.2 of the requirements).
 *
 * ```
 * DRAFT ──► TRANSMITTED ──► ACCEPTED   (a policy was registered, REQ-111)
 *                       └─► REJECTED   (reason required, final)
 * DRAFT / TRANSMITTED ──► CANCELLED    (final)
 * ```
 *
 * `CANCELLED` has no transition implemented: the requirements list the state
 * but define no operation that reaches it (who cancels, when, with which
 * record). It stays in the union because it is part of the documented machine.
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

/**
 * What the transmission to the insurer records (REQ-041).
 *
 * The proposal number is issued by the insurer (glossary 5.1) and the worked
 * commission is informed in the act of transmitting, so both only exist from
 * this point on.
 */
export interface ProposalTransmissionData {
  readonly proposalNumber: string;
  readonly workedCommission: Percentage;
  readonly transmittedAt: Date;
}

/**
 * Everything the proposal accumulated after registration. Used to rebuild a
 * persisted record; `null` means "did not happen".
 */
export interface ProposalState {
  readonly status: ProposalStatus;
  readonly proposalNumber?: string | null;
  readonly workedCommission?: Percentage | null;
  readonly transmittedAt?: Date | null;
  readonly rejectionReason?: string | null;
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
  /** REQ-022, REQ-050: issued by the insurer, known from transmission on. */
  readonly proposalNumber: string | null;
  /** REQ-041: percentage informed in the act of transmission. */
  readonly workedCommission: Percentage | null;
  /** REQ-041: the moment the proposal was sent to the insurer. */
  readonly transmittedAt: Date | null;
  /** REQ-045: mandatory when the outcome is a refusal. */
  readonly rejectionReason: string | null;

  private constructor(data: ProposalRegistrationData, state: ProposalState) {
    this.id = data.id;
    this.clientId = data.clientId;
    this.brokerId = data.brokerId;
    this.insurerId = data.insurerId;
    this.productId = data.productId;
    this.paymentMethodId = data.paymentMethodId;
    this.customerAccepted = data.customerAccepted;
    this.netPremium = data.netPremium;
    this.registeredAt = data.registeredAt;
    this.status = state.status;
    this.proposalNumber = state.proposalNumber ?? null;
    this.workedCommission = state.workedCommission ?? null;
    this.transmittedAt = state.transmittedAt ?? null;
    this.rejectionReason = state.rejectionReason ?? null;
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

    return new Proposal(data, { status: 'DRAFT' });
  }

  /**
   * Rebuilds a proposal from persisted data without re-applying the creation
   * rules: a record stored in the past cannot be invalidated by a rule created
   * afterwards (REQ-124).
   */
  static restore(data: ProposalRegistrationData, state: ProposalState): Proposal {
    return new Proposal(data, state);
  }

  /**
   * REQ-041 / REQ-042 / FP-01 step 4: sends the proposal to the insurer,
   * recording the moment, the number the insurer issued and the worked
   * commission informed in that act.
   *
   * Only a `DRAFT` can be transmitted (section 10.2). Transmitting twice would
   * overwrite the first commission informed, which REQ-124 forbids.
   */
  transmit(data: ProposalTransmissionData): Proposal {
    if (this.status !== 'DRAFT') {
      throw new BusinessRuleViolation('REQ-041', PROPOSAL_MESSAGES.ONLY_DRAFT_CAN_BE_TRANSMITTED, {
        status: this.status,
      });
    }

    if (data.proposalNumber.trim() === '') {
      throw new BusinessRuleViolation('REQ-022', PROPOSAL_MESSAGES.PROPOSAL_NUMBER_REQUIRED);
    }

    return new Proposal(this, {
      status: 'TRANSMITTED',
      proposalNumber: data.proposalNumber.trim(),
      workedCommission: data.workedCommission,
      transmittedAt: data.transmittedAt,
    });
  }

  /**
   * REQ-044 / REQ-045 / REJ-003: records the insurer's refusal. The reason is
   * mandatory and the record stays in the system (REQ-046, ITP-004).
   *
   * Only a transmitted proposal can be refused: a refusal is the insurer's
   * answer to something that was sent (section 10.2). `REJECTED` is final
   * (REQ-112, REJ-015), which the same guard enforces.
   */
  reject(reason: string): Proposal {
    if (this.status !== 'TRANSMITTED') {
      throw new BusinessRuleViolation(
        'REQ-112',
        PROPOSAL_MESSAGES.ONLY_TRANSMITTED_CAN_BE_REJECTED,
        { status: this.status },
      );
    }

    if (reason.trim() === '') {
      throw new BusinessRuleViolation('REQ-045', PROPOSAL_MESSAGES.REJECTION_REASON_REQUIRED);
    }

    return new Proposal(this, {
      status: 'REJECTED',
      proposalNumber: this.proposalNumber,
      workedCommission: this.workedCommission,
      transmittedAt: this.transmittedAt,
      rejectionReason: reason.trim(),
    });
  }

  /**
   * REQ-048 / REQ-111: the insurer effectuated the proposal. `ACCEPTED` is only
   * reachable together with the registration of the policy, so this transition
   * is driven by the policy module and never on its own.
   *
   * The guard is what enforces, in the domain, that a refused proposal produces
   * no policy (REQ-047, CA-006) and that a proposal originates at most one
   * policy (REQ-049, CA-007, REJ-005): once accepted it cannot be accepted
   * again.
   */
  accept(): Proposal {
    if (this.status === 'REJECTED') {
      throw new BusinessRuleViolation(
        'REQ-047',
        PROPOSAL_MESSAGES.REJECTED_CANNOT_ORIGINATE_POLICY,
      );
    }

    if (this.status === 'ACCEPTED') {
      throw new BusinessRuleViolation('REQ-049', PROPOSAL_MESSAGES.ALREADY_HAS_POLICY);
    }

    if (this.status !== 'TRANSMITTED') {
      throw new BusinessRuleViolation(
        'REQ-111',
        PROPOSAL_MESSAGES.ONLY_TRANSMITTED_CAN_BE_ACCEPTED,
        { status: this.status },
      );
    }

    return new Proposal(this, {
      status: 'ACCEPTED',
      proposalNumber: this.proposalNumber,
      workedCommission: this.workedCommission,
      transmittedAt: this.transmittedAt,
    });
  }
}
