import type { NotificationView } from './notification-view.ts';

/**
 * The single contract every notification channel implements (REQ-101).
 *
 * REJ-017 forbids a business rule from being coupled to a channel, so this is
 * the only thing the core knows about delivery: a name for the record and a
 * call that takes the notification already rendered as plain data.
 *
 * - **REQ-103**: e-mail, WhatsApp, Facebook or anything else is an adapter
 *   that implements this interface and is added to the list the composition
 *   root hands the use case. No rule that produces a notification changes
 *   (CA-030).
 * - **REQ-104**: the call is asynchronous and answers nothing, so an adapter
 *   is free to hand the payload to an external queue (Redis, RabbitMQ) and
 *   return. The core never learns that a queue exists — `NotificationView` is
 *   a plain object precisely so it can be serialised by whoever does.
 *
 * **REQ-102** — the initial implementation is the in-app notification — is not
 * an adapter here: in-app delivery *is* the record this system keeps and
 * serves at `OUT-10`, written by the use case through
 * `NotificationRepository`. That is why the composition root wires no channel
 * yet, and why the first outbound channel will not have to touch the core.
 */
export interface NotificationChannel {
  /** Identifies the channel in a log or an error. Never read as a rule. */
  readonly name: string;
  publish(notification: NotificationView): Promise<void>;
}
