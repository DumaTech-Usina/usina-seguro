import type {
  NotificationListFilter,
  NotificationRepository,
} from '../../../core/notification/application/notification-repository.ts';
import type { Notification } from '../../../core/notification/domain/notification.ts';

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly records = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> {
    this.records.set(notification.id, notification);
  }

  /**
   * REQ-105, OUT-10: most recent first.
   *
   * `id` breaks the tie so two notifications produced in the same instant —
   * which the SQLite driver stores with millisecond precision — keep a stable
   * position between reads, exactly as the SQL ordering does.
   */
  async list(filter: NotificationListFilter): Promise<readonly Notification[]> {
    return [...this.records.values()]
      .filter(
        (notification) =>
          filter.recipientId === undefined || notification.recipientId === filter.recipientId,
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || compare(a.id, b.id));
  }
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
