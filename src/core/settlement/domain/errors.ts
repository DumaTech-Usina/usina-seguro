/**
 * Message keys emitted by the settlement module.
 */
export const SETTLEMENT_MESSAGES = {
  RELEASE_RULE_NOT_CONFIGURED: 'settlement.release_rule_not_configured',
  PAYMENT_METHOD_REQUIRED: 'settlement.payment_method_required',
  COMMISSION_NOT_RECONCILED: 'settlement.commission_not_reconciled',
  ALREADY_OPEN: 'settlement.already_open',
  NOT_FOUND: 'settlement.not_found',
  AWAITING_RECEIPT_CONFIRMATION: 'settlement.awaiting_receipt_confirmation',
  ONLY_AWAITING_CAN_BE_RELEASED: 'settlement.only_awaiting_can_be_released',
  ONLY_RELEASED_CAN_BE_PAID: 'settlement.only_released_can_be_paid',
  PAYMENT_AMOUNT_MUST_BE_POSITIVE: 'settlement.payment_amount_must_be_positive',
  PAYMENT_PROOF_REQUIRED: 'settlement.payment_proof_required',
  PAYMENT_PROOF_NOT_FOUND: 'settlement.payment_proof_not_found',
  PAYMENT_USER_REQUIRED: 'settlement.payment_user_required',
} as const;

export type SettlementMessageKey = (typeof SETTLEMENT_MESSAGES)[keyof typeof SETTLEMENT_MESSAGES];
