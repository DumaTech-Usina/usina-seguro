import type { Authorship } from './authorship.ts';
import type { Percentage } from './percentage.ts';

/**
 * REQ-213: whether the commission is received as one total or per
 * installment. Declared explicitly on the proposal. The two modes are parallel
 * flows (REQ-290): integral on the net premium, parcelled on each installment.
 */
export type WorkedCommissionMode = 'INTEGRAL' | 'PARCELLED';

/**
 * One entry of the worked commission (CT): the rate, its mode and who informed
 * them when (REQ-212, REQ-213, REQ-215).
 *
 * With a parcelled CT there are two rates, signed together (REQ-291, REQ-297):
 * `rate` is the CT of the first installment and `subsequentRate` the CT of
 * every other one. With an integral CT `rate` is the one CT and there is no
 * `subsequentRate`.
 *
 * The proposal keeps every entry, not only the last: the CT is sensitive and
 * error-prone (REQ-215), and a financial record is never erased (REQ-124).
 */
export interface WorkedCommission {
  readonly rate: Percentage;
  readonly mode: WorkedCommissionMode;
  /** REQ-291: the CT of the subsequent installments; only with a parcelled CT. */
  readonly subsequentRate?: Percentage | null;
  readonly informed: Authorship;
}
