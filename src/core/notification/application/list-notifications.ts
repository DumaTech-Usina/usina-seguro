import type { NotificationRepository } from './notification-repository.ts';
import { type NotificationView, toNotificationView } from './notification-view.ts';

export interface ListNotificationsInput {
  /** OUT-10: one recipient at a time, or every one of them when absent. */
  readonly recipientId?: string;
}

export interface ListNotificationsDependencies {
  readonly notifications: NotificationRepository;
}

/**
 * OUT-10 / REQ-102 / REQ-105: the notifications that were produced.
 *
 * This is the in-app notification of REQ-102 — the record is what the broker
 * reads inside the system — and, at the same time, the register REQ-105 asks
 * for: what was notified, to whom and when, kept as it was at the moment it
 * was sent.
 *
 * It is a reading and nothing else. Nobody marks a notification as read, and
 * nothing is deleted: no requirement defines either operation, and REQ-105
 * asks for a record, not for an inbox with state.
 */
export class ListNotifications {
  private readonly deps: ListNotificationsDependencies;

  constructor(deps: ListNotificationsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListNotificationsInput = {}): Promise<readonly NotificationView[]> {
    const recipientId = input.recipientId?.trim();
    const notifications = await this.deps.notifications.list(
      recipientId === undefined || recipientId === '' ? {} : { recipientId },
    );

    return notifications.map(toNotificationView);
  }
}
