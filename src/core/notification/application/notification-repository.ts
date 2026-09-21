import type { Notification } from '../domain/notification.ts';

/** What narrows a listing. Absent means every notification. */
export interface NotificationListFilter {
  /**
   * OUT-10: the notifications addressed to one recipient. REQ-100 addresses
   * the broker (ATR-004), and `ITP-001` is what makes him a reader of this
   * system — whether he only sees his own is `DEC-010`, so the filter is a
   * reading and not an authorisation.
   */
  readonly recipientId?: string;
}

export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  /**
   * REQ-105, OUT-10: what was notified, most recent first.
   *
   * The order is part of the contract and not an accident of the driver: a
   * notification list is read from the top, and what just happened is what the
   * reader came for. Both implementations are tested against it.
   */
  list(filter: NotificationListFilter): Promise<readonly Notification[]>;
}
