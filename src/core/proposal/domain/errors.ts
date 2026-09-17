/**
 * Message keys emitted by this module.
 *
 * The domain never produces human-readable text: it emits a stable key plus
 * parameters, and the outer layers render it through the i18n dictionary
 * (`src/i18n`). That keeps the core free of presentation concerns and makes a
 * missing translation a compile error, since the dictionary is typed as
 * `Record<MessageKey, string>` over the union of every module's keys.
 */
export const PROPOSAL_MESSAGES = {
  CUSTOMER_ACCEPTANCE_REQUIRED: 'proposal.customer_acceptance_required',
  PAYMENT_METHOD_REQUIRED: 'proposal.payment_method_required',
  FIELD_REQUIRED: 'proposal.field_required',
  NET_PREMIUM_MUST_BE_POSITIVE: 'proposal.net_premium_must_be_positive',
  PROPOSAL_NUMBER_REQUIRED: 'proposal.proposal_number_required',
  ONLY_DRAFT_CAN_BE_TRANSMITTED: 'proposal.only_draft_can_be_transmitted',
  ONLY_TRANSMITTED_CAN_BE_REJECTED: 'proposal.only_transmitted_can_be_rejected',
  REJECTION_REASON_REQUIRED: 'proposal.rejection_reason_required',
  ONLY_TRANSMITTED_CAN_BE_ACCEPTED: 'proposal.only_transmitted_can_be_accepted',
  REJECTED_CANNOT_ORIGINATE_POLICY: 'proposal.rejected_cannot_originate_policy',
  ALREADY_HAS_POLICY: 'proposal.already_has_policy',
  NOT_FOUND: 'proposal.not_found',
  INVALID_MONEY_FORMAT: 'money.invalid_format',
  INVALID_PERCENTAGE_FORMAT: 'percentage.invalid_format',
  PERCENTAGE_OUT_OF_RANGE: 'percentage.out_of_range',
} as const;

export type ProposalMessageKey = (typeof PROPOSAL_MESSAGES)[keyof typeof PROPOSAL_MESSAGES];

export type MessageParams = Readonly<Record<string, string>>;

/**
 * Signals that a business rule was violated.
 *
 * The domain knows nothing about HTTP or databases: it only reports which rule
 * was broken. Mapping that to a status code belongs to `interfaces/`, and
 * mapping `messageKey` to readable text belongs to `i18n/`.
 *
 * `messageKey` is typed as `string` rather than a union because every business
 * module declares its own keys and a union here would make the modules import
 * each other in a circle. Two guarantees replace the narrow type:
 *
 * - the i18n dictionary is `Record<MessageKey, string>` over the union of all
 *   module key types, so adding a key without translating it fails typecheck;
 * - an architecture test asserts that every `BusinessRuleViolation` in the core
 *   is built from a `*_MESSAGES` constant, never from a literal.
 *
 * This type and `RecordNotFound` live in the proposal module because it is the
 * module every other business module already depends on (a policy only exists
 * as the outcome of a proposal, REQ-048). No requirement justifies a shared
 * module yet.
 */
export class BusinessRuleViolation extends Error {
  /** Requirement id from `requisitos_refinados.md`, e.g. `REQ-040`. */
  readonly rule: string;
  readonly messageKey: string;
  readonly params: MessageParams;

  constructor(rule: string, messageKey: string, params: MessageParams = {}) {
    // `Error.message` holds the key so stack traces and logs stay useful
    // without pulling a locale into the core.
    super(messageKey);
    this.name = 'BusinessRuleViolation';
    this.rule = rule;
    this.messageKey = messageKey;
    this.params = params;
  }
}

/**
 * Signals that an operation referenced a record that does not exist.
 *
 * It is not a business rule violation: no rule was broken, the subject of the
 * operation is simply absent. Keeping it separate lets `interfaces/` answer 404
 * instead of 422 without inspecting the message key.
 */
export class RecordNotFound extends Error {
  readonly messageKey: string;
  readonly params: MessageParams;

  constructor(messageKey: string, params: MessageParams = {}) {
    super(messageKey);
    this.name = 'RecordNotFound';
    this.messageKey = messageKey;
    this.params = params;
  }
}
