import type { Authorship } from './authorship.ts';
import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';
import type { Percentage } from './percentage.ts';

/**
 * How the Usina receives the commission of this operation (REQ-220).
 *
 * Either directly from the insurer, or through **exactly one** intermediary —
 * there is no chain, so the type has room for one and only one (REJ-209). The
 * intermediary is a registry reference, like the insurer (REQ-220); the CTU
 * travels with it because it only exists when there is an intermediary
 * (REQ-221).
 */
export type Receipt =
  | { readonly kind: 'DIRECT' }
  | {
      readonly kind: 'INTERMEDIARY';
      readonly intermediaryId: string;
      /** REQ-221: what the Usina receives out of what the intermediary received. */
      readonly ctu: Percentage;
    };

/** REQ-223: a declaration of the receipt, audited with who made it and when. */
export interface ReceiptDeclaration {
  readonly receipt: Receipt;
  readonly declared: Authorship;
}

/** What the user declares: no intermediary, or one with a CTU that may be missing. */
export interface IntermediaryInput {
  readonly intermediaryId: string;
  readonly ctu: Percentage | null;
}

/**
 * REQ-220, REQ-221: turns what the user declared into a receipt.
 *
 * An intermediary without a CTU is refused (REJ-202, EX-202): the CTU is the
 * additional field the intermediary makes mandatory.
 */
export function declareReceipt(intermediary: IntermediaryInput | null): Receipt {
  if (intermediary === null) {
    return { kind: 'DIRECT' };
  }

  const intermediaryId = intermediary.intermediaryId.trim();

  if (intermediaryId === '') {
    throw new BusinessRuleViolation('REQ-220', PROPOSAL_MESSAGES.FIELD_REQUIRED, {
      field: 'intermediaryId',
    });
  }

  if (intermediary.ctu === null) {
    throw new BusinessRuleViolation('REQ-221', PROPOSAL_MESSAGES.INTERMEDIARY_REQUIRES_CTU);
  }

  return { kind: 'INTERMEDIARY', intermediaryId, ctu: intermediary.ctu };
}
