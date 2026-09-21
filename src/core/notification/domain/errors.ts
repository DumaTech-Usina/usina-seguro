/**
 * Message keys of the notification module (REQ-100 to REQ-105).
 *
 * Like every other module, the domain throws a key plus params and never a
 * sentence: the Portuguese lives in `src/i18n/messages.ts`.
 */
export const NOTIFICATION_MESSAGES = {
  RECIPIENT_REQUIRED: 'notification.recipient_required',
} as const;

export type NotificationMessageKey =
  (typeof NOTIFICATION_MESSAGES)[keyof typeof NOTIFICATION_MESSAGES];
