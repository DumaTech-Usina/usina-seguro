import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import type { Money } from '../../proposal/domain/money.ts';
import type { Percentage } from '../../proposal/domain/percentage.ts';
import { NOTIFICATION_MESSAGES } from './errors.ts';

/**
 * What happened, as the notification records it (REQ-105).
 *
 * One member, because the requirements define one notification: REQ-100, the
 * effectuated emission. Renewal, endorsement and cancellation would each be
 * another member, and each depends on an operation that does not exist yet.
 * The union is what keeps that addition cheap and keeps the reader from
 * assuming this record is generic.
 */
export type NotificationEvent = 'POLICY_ISSUED';

/**
 * A reference as the notification froze it.
 *
 * The identifier is what the business stores (REQ-022) and the name is what
 * IN-01 registered for it (REQ-096). The name is `null` when nobody registered
 * one: REQ-002 does not let the system refuse a business over a missing
 * registry entry, so an unnamed reference is a notification with an identifier
 * to show, not a notification that cannot be produced.
 */
export interface NotificationParty {
  readonly id: string;
  readonly name: string | null;
}

/**
 * The five fields REQ-100 and REQ-096 require, copied at the moment of the
 * notification.
 *
 * They are **copied, not joined**: REQ-105 asks for a record of *what was
 * notified*, and a reading that resolved the names again later would show what
 * the registry says today instead of what the broker was told. It is the same
 * reason `CommissionBasis` copies the rates it calculated with (REJ-011).
 *
 * `workedCommission` is nullable only because the type allows it. The CT is
 * mandatory at the registration of the proposal (REQ-202), so in practice it
 * is always present; refusing the notification over it would invent a rule
 * REQ-100 does not state, and would do so inside the registration of a policy
 * that did happen.
 */
export interface NotificationContent {
  readonly client: NotificationParty;
  readonly broker: NotificationParty;
  /** REQ-022 names the field "produto/ramo": the product's name is the ramo. */
  readonly product: NotificationParty;
  /**
   * The CT of the proposal (REQ-212). With a parcelled CT, the CT of the
   * first installment (REQ-228).
   */
  readonly workedCommission: Percentage | null;
  /** REQ-228: with a parcelled CT, the CT of the subsequent installments too. */
  readonly subsequentWorkedCommission?: Percentage | null;
  /** REQ-022: the net premium of the proposal, the "valor liquido". */
  readonly netPremium: Money;
}

export interface NotificationData {
  readonly id: string;
  readonly event: NotificationEvent;
  /**
   * REQ-105: to whom. REQ-100 names the broker and no other recipient, so the
   * field holds the broker identifier the proposal carries. It is kept apart
   * from `content.broker` because they answer different questions: this is the
   * address the notification was sent to, and the content is what it said.
   */
  readonly recipientId: string;
  /**
   * What the notification is about. REQ-100 does not list it among the five
   * fields, but a notification nobody can act on is a dead end: this is what
   * takes the reader to the policy the emission produced (FP-01 step 8).
   */
  readonly policyId: string;
  readonly policyNumber: string;
  readonly content: NotificationContent;
  /** REQ-105: when. */
  readonly occurredAt: Date;
}

/**
 * A notification that was produced, recorded and published (REQ-100, REQ-105).
 *
 * The aggregate holds no channel and no delivery state. REQ-101 puts every
 * channel behind one contract and REJ-017 forbids a business rule from knowing
 * which one delivered it, so what a channel did with this record is the
 * adapter's business, not the domain's. There is also no read/unread flag: no
 * requirement asks for one, and the record REQ-105 defines is what was
 * notified, to whom and when.
 */
export class Notification {
  readonly id: string;
  readonly event: NotificationEvent;
  readonly recipientId: string;
  readonly policyId: string;
  readonly policyNumber: string;
  readonly content: NotificationContent;
  readonly occurredAt: Date;

  private constructor(data: NotificationData) {
    this.id = data.id;
    this.event = data.event;
    this.recipientId = data.recipientId;
    this.policyId = data.policyId;
    this.policyNumber = data.policyNumber;
    this.content = data.content;
    this.occurredAt = data.occurredAt;
  }

  /** REQ-100, CA-029: the insurer effectuated the emission. */
  static issue(data: Omit<NotificationData, 'event'>): Notification {
    if (data.recipientId.trim() === '') {
      // REQ-105 asks the record to say *for whom* it was produced, and a
      // notification with no recipient is one no channel could ever address.
      throw new BusinessRuleViolation('REQ-105', NOTIFICATION_MESSAGES.RECIPIENT_REQUIRED);
    }

    return new Notification({
      ...data,
      event: 'POLICY_ISSUED',
      recipientId: data.recipientId.trim(),
    });
  }

  /** Rebuilds a persisted record without re-applying the rules (REQ-124). */
  static restore(data: NotificationData): Notification {
    return new Notification(data);
  }
}
