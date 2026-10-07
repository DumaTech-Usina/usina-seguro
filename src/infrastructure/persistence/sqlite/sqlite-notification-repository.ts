import type { DatabaseSync } from 'node:sqlite';
import type {
  NotificationListFilter,
  NotificationRepository,
} from '../../../core/notification/application/notification-repository.ts';
import {
  Notification,
  type NotificationEvent,
} from '../../../core/notification/domain/notification.ts';
import { Money } from '../../../core/proposal/domain/money.ts';
import { Percentage } from '../../../core/proposal/domain/percentage.ts';

interface NotificationRow {
  id: string;
  event: string;
  recipient_id: string;
  policy_id: string;
  policy_number: string;
  client_id: string;
  client_name: string | null;
  broker_id: string;
  broker_name: string | null;
  product_id: string;
  product_name: string | null;
  worked_commission: string | null;
  subsequent_worked_commission: string | null;
  net_premium: string;
  occurred_at: string;
}

export class SqliteNotificationRepository implements NotificationRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async save(notification: Notification): Promise<void> {
    const { content } = notification;

    this.db
      .prepare(
        `INSERT INTO notification (
           id, event, recipient_id, policy_id, policy_number,
           client_id, client_name, broker_id, broker_name,
           product_id, product_name, worked_commission, subsequent_worked_commission,
           net_premium, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        notification.id,
        notification.event,
        notification.recipientId,
        notification.policyId,
        notification.policyNumber,
        content.client.id,
        content.client.name,
        content.broker.id,
        content.broker.name,
        content.product.id,
        content.product.name,
        content.workedCommission?.toString() ?? null,
        content.subsequentWorkedCommission?.toString() ?? null,
        content.netPremium.toString(),
        notification.occurredAt.toISOString(),
      );
  }

  /**
   * REQ-105, OUT-10: most recent first.
   *
   * `occurred_at` is ISO-8601 UTC text, so ordering it as text orders it as an
   * instant. `id` breaks the tie, which is what keeps two notifications
   * produced in the same millisecond in a stable position between reads.
   */
  async list(filter: NotificationListFilter): Promise<readonly Notification[]> {
    const rows = (filter.recipientId === undefined
      ? this.db.prepare('SELECT * FROM notification ORDER BY occurred_at DESC, id').all()
      : this.db
          .prepare(
            'SELECT * FROM notification WHERE recipient_id = ? ORDER BY occurred_at DESC, id',
          )
          .all(filter.recipientId)) as unknown as NotificationRow[];

    return rows.map(restore);
  }
}

function restore(row: NotificationRow): Notification {
  return Notification.restore({
    id: row.id,
    event: row.event as NotificationEvent,
    recipientId: row.recipient_id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    content: {
      client: { id: row.client_id, name: row.client_name },
      broker: { id: row.broker_id, name: row.broker_name },
      product: { id: row.product_id, name: row.product_name },
      // Stored as notified, not re-checked: a parcelled CT may be above 100% (REQ-295).
      workedCommission:
        row.worked_commission === null
          ? null
          : Percentage.fromStringWithoutCeiling(row.worked_commission),
      subsequentWorkedCommission:
        row.subsequent_worked_commission === null
          ? null
          : Percentage.fromStringWithoutCeiling(row.subsequent_worked_commission),
      netPremium: Money.fromString(row.net_premium),
    },
    occurredAt: new Date(row.occurred_at),
  });
}
