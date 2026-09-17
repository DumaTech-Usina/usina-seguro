/**
 * Message keys emitted by this module.
 *
 * The domain never produces human-readable text: it emits a stable key plus
 * parameters, and the outer layers render it through the i18n dictionary
 * (`src/i18n`). That keeps the core free of presentation concerns and makes a
 * missing translation a compile error, since the dictionary is typed as
 * `Record<MessageKey, string>`.
 */
export const PROPOSAL_MESSAGES = {
  CUSTOMER_ACCEPTANCE_REQUIRED: 'proposal.customer_acceptance_required',
  PAYMENT_METHOD_REQUIRED: 'proposal.payment_method_required',
  FIELD_REQUIRED: 'proposal.field_required',
  NET_PREMIUM_MUST_BE_POSITIVE: 'proposal.net_premium_must_be_positive',
  INVALID_MONEY_FORMAT: 'money.invalid_format',
} as const;

export type ProposalMessageKey = (typeof PROPOSAL_MESSAGES)[keyof typeof PROPOSAL_MESSAGES];

export type MessageParams = Readonly<Record<string, string>>;

/**
 * Signals that a business rule was violated.
 *
 * The domain knows nothing about HTTP or databases: it only reports which rule
 * was broken. Mapping that to a status code belongs to `interfaces/`, and
 * mapping `messageKey` to readable text belongs to `i18n/`.
 */
export class BusinessRuleViolation extends Error {
  /** Requirement id from `requisitos_refinados.md`, e.g. `REQ-040`. */
  readonly rule: string;
  readonly messageKey: ProposalMessageKey;
  readonly params: MessageParams;

  constructor(rule: string, messageKey: ProposalMessageKey, params: MessageParams = {}) {
    // `Error.message` holds the key so stack traces and logs stay useful
    // without pulling a locale into the core.
    super(messageKey);
    this.name = 'BusinessRuleViolation';
    this.rule = rule;
    this.messageKey = messageKey;
    this.params = params;
  }
}
