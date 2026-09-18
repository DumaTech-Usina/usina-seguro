/**
 * Message keys emitted by the policy module.
 *
 * Same contract as the proposal module: the domain emits a stable key plus
 * parameters and `src/i18n` renders it. `BusinessRuleViolation` itself is
 * declared in the proposal module — see the comment there for why there is no
 * shared module.
 */
export const POLICY_MESSAGES = {
  POLICY_NUMBER_REQUIRED: 'policy.policy_number_required',
  POLICY_NUMBER_ALREADY_REGISTERED: 'policy.policy_number_already_registered',
  PREMIUM_MUST_BE_POSITIVE: 'policy.premium_must_be_positive',
  COVERAGE_END_MUST_FOLLOW_START: 'policy.coverage_end_must_follow_start',
  INSTALLMENTS_REQUIRED: 'policy.installments_required',
  INSTALLMENTS_MUST_BE_SEQUENTIAL: 'policy.installments_must_be_sequential',
  INSTALLMENT_AMOUNT_MUST_BE_POSITIVE: 'policy.installment_amount_must_be_positive',
  INSTALLMENT_BELONGS_TO_ANOTHER_POLICY: 'policy.installment_belongs_to_another_policy',
  NOT_FOUND: 'policy.not_found',
  NOT_FOUND_FOR_PROPOSAL: 'policy.not_found_for_proposal',
  INSTALLMENT_NOT_FOUND: 'policy.installment_not_found',
  ONLY_PENDING_CAN_BE_PAID: 'policy.only_pending_can_be_paid',
  PAYMENT_CONFIRMATION_USER_REQUIRED: 'policy.payment_confirmation_user_required',
  INVALID_DATE_FORMAT: 'policy.invalid_date_format',
} as const;

export type PolicyMessageKey = (typeof POLICY_MESSAGES)[keyof typeof POLICY_MESSAGES];
