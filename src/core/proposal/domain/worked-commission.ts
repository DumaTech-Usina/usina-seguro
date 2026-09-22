import type { Authorship } from './authorship.ts';
import type { Percentage } from './percentage.ts';

/**
 * REQ-213: whether the commission is received as one total or per
 * installment. Declared explicitly on the proposal; its effect on the
 * calculation is `DEC-203` (see `commissionBase`).
 */
export type WorkedCommissionMode = 'INTEGRAL' | 'PARCELLED';

/**
 * One entry of the worked commission (CT): the rate, its mode and who informed
 * them when (REQ-212, REQ-213, REQ-215).
 *
 * The proposal keeps every entry, not only the last: the CT is sensitive and
 * error-prone (REQ-215), and a financial record is never erased (REQ-124).
 */
export interface WorkedCommission {
  readonly rate: Percentage;
  readonly mode: WorkedCommissionMode;
  readonly informed: Authorship;
}
