/**
 * Message keys emitted by the commission module.
 *
 * Same contract as the other business modules: the domain emits a stable key
 * plus parameters and `src/i18n` renders it. `BusinessRuleViolation` itself is
 * declared in the proposal module — see the comment there for why there is no
 * shared module.
 */
export const COMMISSION_MESSAGES = {
  AGREEMENT_FIELD_REQUIRED: 'commission.agreement_field_required',
  INTERMEDIARY_REQUIRED: 'commission.intermediary_required',
  BROKER_RATE_FIELD_REQUIRED: 'commission.broker_rate_field_required',
  NOT_FOUND: 'commission.not_found',
  OVERRIDE_JUSTIFICATION_REQUIRED: 'commission.override_justification_required',
  OVERRIDE_USER_REQUIRED: 'commission.override_user_required',
  OVERRIDE_VALUE_REQUIRED: 'commission.override_value_required',
  OVERRIDE_MUST_BE_POSITIVE: 'commission.override_must_be_positive',
  ONLY_DIVERGENT_CAN_BE_RESOLVED: 'commission.only_divergent_can_be_resolved',
  RESOLUTION_JUSTIFICATION_REQUIRED: 'commission.resolution_justification_required',
  RESOLUTION_USER_REQUIRED: 'commission.resolution_user_required',
  COMPETENCE_REQUIRED: 'commission.competence_required',
  ALREADY_RECONCILED_FOR_COMPETENCE: 'commission.already_reconciled_for_competence',
} as const;

export type CommissionMessageKey = (typeof COMMISSION_MESSAGES)[keyof typeof COMMISSION_MESSAGES];
