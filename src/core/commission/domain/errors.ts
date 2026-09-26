/**
 * Message keys emitted by the commission module.
 *
 * Same contract as the other business modules: the domain emits a stable key
 * plus parameters and `src/i18n` renders it. `BusinessRuleViolation` itself is
 * declared in the proposal module — see the comment there for why there is no
 * shared module.
 */
export const COMMISSION_MESSAGES = {
  NOT_FOUND: 'commission.not_found',
  OVERRIDE_JUSTIFICATION_REQUIRED: 'commission.override_justification_required',
  OVERRIDE_USER_REQUIRED: 'commission.override_user_required',
  OVERRIDE_MUST_BE_POSITIVE: 'commission.override_must_be_positive',
  ONLY_DIVERGENT_CAN_BE_RESOLVED: 'commission.only_divergent_can_be_resolved',
  RESOLUTION_JUSTIFICATION_REQUIRED: 'commission.resolution_justification_required',
  RESOLUTION_USER_REQUIRED: 'commission.resolution_user_required',
  COMPETENCE_REQUIRED: 'commission.competence_required',
  ALREADY_RECONCILED_FOR_COMPETENCE: 'commission.already_reconciled_for_competence',
  PAYOUT_RATE_TOO_PRECISE: 'commission.payout_rate_too_precise',
  PAYOUT_REQUIRES_INTEGRAL_CT: 'commission.payout_requires_integral_ct',
  PAYOUT_ALREADY_INFORMED: 'commission.payout_already_informed',
  PAYOUT_NOT_INFORMED: 'commission.payout_not_informed',
  PAYOUT_REVISION_REASON_REQUIRED: 'commission.payout_revision_reason_required',
  PAYOUT_ELIGIBLE_IS_FINAL: 'commission.payout_eligible_is_final',
} as const;

export type CommissionMessageKey = (typeof COMMISSION_MESSAGES)[keyof typeof COMMISSION_MESSAGES];
