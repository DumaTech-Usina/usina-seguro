import type { Notification } from '../domain/notification.ts';

/** A reference at the core boundary: what is stored and what IN-01 named it. */
export interface NotificationPartyView {
  readonly id: string;
  readonly name: string | null;
}

/**
 * Representation of a notification at the core boundary (OUT-10, REQ-105).
 *
 * The five fields of REQ-100 travel exactly as they were recorded: money and
 * percentage as decimal strings (REQ-120, REQ-121), each reference as the
 * identifier plus the name it had when the notification was produced. Whoever
 * renders it decides how an absent name reads; the core answers `null`.
 *
 * This is also the payload a channel receives (REQ-101): plain strings, which
 * is what an adapter can serialise into an e-mail body or onto a queue
 * (REQ-103, REQ-104) without reaching into the domain.
 */
export interface NotificationView {
  readonly id: string;
  readonly event: string;
  readonly recipientId: string;
  readonly policyId: string;
  readonly policyNumber: string;
  readonly client: NotificationPartyView;
  readonly broker: NotificationPartyView;
  readonly product: NotificationPartyView;
  readonly workedCommission: string | null;
  readonly netPremium: string;
  readonly occurredAt: string;
}

export function toNotificationView(notification: Notification): NotificationView {
  const { content } = notification;

  return {
    id: notification.id,
    event: notification.event,
    recipientId: notification.recipientId,
    policyId: notification.policyId,
    policyNumber: notification.policyNumber,
    client: { id: content.client.id, name: content.client.name },
    broker: { id: content.broker.id, name: content.broker.name },
    product: { id: content.product.id, name: content.product.name },
    workedCommission: content.workedCommission?.toString() ?? null,
    netPremium: content.netPremium.toString(),
    occurredAt: notification.occurredAt.toISOString(),
  };
}
