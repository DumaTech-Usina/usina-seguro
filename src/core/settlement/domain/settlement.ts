import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import { SETTLEMENT_MESSAGES } from './errors.ts';
import type { ReleaseRule } from './payment-method-release-rule.ts';

/**
 * Documented states of the broker transfer (section 10.6).
 *
 * ```
 * AWAITING_CONFIRMATION ──► RELEASED ──► PAID
 * RELEASED (immediate)  ──► PAID
 * any                   ──► DIVERGENT ──► RESOLVED  (manual, with reason)
 * ```
 *
 * `DIVERGENT` is reachable only through REQ-054 — a policy cancelled after the
 * transfer was paid. That rule is the interpretation `ITP-005` and its
 * financial effect is `DEC-003`, and policy cancellation itself is not
 * modelled, so no transition reaches it here. It stays in the union because it
 * is part of the documented machine.
 */
export type SettlementStatus =
  | 'AWAITING_CONFIRMATION'
  | 'RELEASED'
  | 'PAID'
  | 'DIVERGENT'
  | 'RESOLVED';

/**
 * REQ-095, CA-028: the proof attached to the payment.
 *
 * The requirement says *comprovante anexo* — a document, not a note about one.
 * What the aggregate keeps is the document's identity and what a human needs
 * to recognise it; the bytes live behind `DocumentStorage`, because a payment
 * record is read constantly and the file is read once, when someone asks for
 * it.
 *
 * `fileName` is what identifies the proof on screen — the role the textual
 * reference used to play before the document existed. `byteSize` is here and
 * not derived from the stored bytes because it is what lets this aggregate
 * refuse an empty proof without reaching into storage.
 */
export interface PaymentProof {
  readonly documentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
}

/** REQ-095, CA-028: what the Usina sent the broker. */
export interface SettlementPayment {
  readonly paidAt: Date;
  /**
   * Informed, not copied from `amount`: REQ-002 makes the system reflect what
   * happened, and REQ-075 wants the real paid side next to the agreed one.
   */
  readonly amount: Money;
  /** REQ-095, CA-028: the attached proof. */
  readonly proof: PaymentProof;
  /** REQ-123: who registered the payment. */
  readonly userId: string;
}

export interface SettlementData {
  readonly id: string;
  readonly policyId: string;
  readonly brokerId: string;
  /** REQ-093: the broker table over the base, override of REQ-066 included. */
  readonly amount: Money;
  /** REQ-090: copied at opening, so a later edit does not rewrite history. */
  readonly releaseRule: ReleaseRule;
  readonly openedAt: Date;
}

export interface SettlementState {
  readonly status: SettlementStatus;
  readonly releasedAt: Date | null;
  readonly payment: SettlementPayment | null;
}

/**
 * The transfer of the commission of one policy to the broker (glossary 5.1,
 * REQ-090 to REQ-095).
 *
 * One per policy. REQ-094 speaks of a transfer report "do periodo", but the
 * window is `DEC-008` and undecided, so nothing here groups or splits
 * transfers by period: the record follows the policy, which is the only unit
 * the confirmed requirements name.
 */
export class Settlement {
  readonly id: string;
  readonly policyId: string;
  readonly brokerId: string;
  readonly amount: Money;
  readonly releaseRule: ReleaseRule;
  readonly openedAt: Date;
  readonly status: SettlementStatus;
  readonly releasedAt: Date | null;
  readonly payment: SettlementPayment | null;

  private constructor(data: SettlementData, state: SettlementState) {
    this.id = data.id;
    this.policyId = data.policyId;
    this.brokerId = data.brokerId;
    this.amount = data.amount;
    this.releaseRule = data.releaseRule;
    this.openedAt = data.openedAt;
    this.status = state.status;
    this.releasedAt = state.releasedAt;
    this.payment = state.payment;
  }

  /**
   * FP-03 steps 1 to 3: the release rule of the payment method decides where
   * the transfer starts.
   *
   * REQ-090 and CA-022: an immediate method releases it at once. REQ-091,
   * CA-023 and EX-07: a method that requires confirmation holds it until the
   * client's first installment is confirmed paid — and if that confirmation
   * already exists when the transfer is opened, there is nothing left to wait
   * for.
   */
  static open(data: SettlementData, firstInstallmentPaid: boolean): Settlement {
    const released = data.releaseRule === 'IMMEDIATE' || firstInstallmentPaid;

    return new Settlement(data, {
      status: released ? 'RELEASED' : 'AWAITING_CONFIRMATION',
      releasedAt: released ? data.openedAt : null,
      payment: null,
    });
  }

  /** Rebuilds a persisted transfer without re-applying the rules (REQ-124). */
  static restore(data: SettlementData, state: SettlementState): Settlement {
    return new Settlement(data, state);
  }

  /**
   * FP-03 step 3: the Financeiro releases a transfer that was waiting.
   *
   * REJ-009: releasing a method that requires confirmation without the
   * confirmation registered is refused. The check is here and not in the
   * caller because it is the rule itself.
   */
  release(firstInstallmentPaid: boolean, at: Date): Settlement {
    if (this.status !== 'AWAITING_CONFIRMATION') {
      throw new BusinessRuleViolation(
        'REQ-091',
        SETTLEMENT_MESSAGES.ONLY_AWAITING_CAN_BE_RELEASED,
        { status: this.status },
      );
    }

    if (this.releaseRule === 'REQUIRES_RECEIPT_CONFIRMATION' && !firstInstallmentPaid) {
      throw new BusinessRuleViolation('REQ-091', SETTLEMENT_MESSAGES.AWAITING_RECEIPT_CONFIRMATION);
    }

    return new Settlement(this, { status: 'RELEASED', releasedAt: at, payment: null });
  }

  /**
   * FP-03 step 5, REQ-095, CA-028: the payment sent to the broker is recorded
   * with date, amount and proof, plus the user REQ-123 requires.
   *
   * Only a released transfer is paid (section 10.6): paying one still waiting
   * would be the very thing REJ-009 forbids, reached by another door.
   */
  registerPayment(payment: SettlementPayment): Settlement {
    if (this.status !== 'RELEASED') {
      throw new BusinessRuleViolation('REQ-095', SETTLEMENT_MESSAGES.ONLY_RELEASED_CAN_BE_PAID, {
        status: this.status,
      });
    }

    if (!payment.amount.isPositive()) {
      throw new BusinessRuleViolation(
        'REQ-095',
        SETTLEMENT_MESSAGES.PAYMENT_AMOUNT_MUST_BE_POSITIVE,
      );
    }

    // REQ-095, CA-028: a payment with no document attached, or with one that
    // carries no bytes, is a payment with no proof. The name is what makes it
    // recognisable; the size is what makes it a document at all.
    if (payment.proof.fileName.trim() === '' || payment.proof.byteSize <= 0) {
      throw new BusinessRuleViolation('REQ-095', SETTLEMENT_MESSAGES.PAYMENT_PROOF_REQUIRED);
    }

    if (payment.userId.trim() === '') {
      throw new BusinessRuleViolation('REQ-123', SETTLEMENT_MESSAGES.PAYMENT_USER_REQUIRED);
    }

    return new Settlement(this, {
      status: 'PAID',
      releasedAt: this.releasedAt,
      payment: {
        paidAt: payment.paidAt,
        amount: payment.amount,
        proof: { ...payment.proof, fileName: payment.proof.fileName.trim() },
        userId: payment.userId.trim(),
      },
    });
  }
}
