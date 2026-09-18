/**
 * Message keys emitted by the reconciliation module.
 */
export const RECONCILIATION_MESSAGES = {
  COMPETENCE_REQUIRED: 'reconciliation.competence_required',
  REPORT_MUST_HAVE_LINES: 'reconciliation.report_must_have_lines',
  PROPOSAL_NUMBER_REQUIRED: 'reconciliation.proposal_number_required',
} as const;

export type ReconciliationMessageKey =
  (typeof RECONCILIATION_MESSAGES)[keyof typeof RECONCILIATION_MESSAGES];
