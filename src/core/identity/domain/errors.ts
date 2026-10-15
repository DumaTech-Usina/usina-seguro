/**
 * Message keys of the access module (V2 section 9C).
 *
 * Like every other module, the domain throws a key plus params and never a
 * sentence: the Portuguese lives in `src/i18n/messages.ts`.
 */
export const IDENTITY_MESSAGES = {
  EMAIL_REQUIRED: 'identity.email_required',
  EMAIL_ALREADY_ACTIVE: 'identity.email_already_active',
  PASSWORD_LENGTH: 'identity.password_length',
  INVALID_LINK: 'identity.invalid_link',
  LOGIN_REFUSED: 'identity.login_refused',
  /** REQ-410, REQ-431: an operation reached with no valid session. */
  AUTHENTICATION_REQUIRED: 'identity.authentication_required',
  /** REQ-417: a changing request sent by a page that is not the system's own. */
  FOREIGN_ORIGIN: 'identity.foreign_origin',
} as const;

export type IdentityMessageKey = (typeof IDENTITY_MESSAGES)[keyof typeof IDENTITY_MESSAGES];
