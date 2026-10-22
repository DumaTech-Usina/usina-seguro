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
  /** REQ-401, REQ-430: an act reserved to administrators. */
  ADMINISTRATOR_ONLY: 'identity.administrator_only',
  /** REQ-406: the act would leave no active administrator. */
  LAST_ADMINISTRATOR: 'identity.last_administrator',
  /** REQ-421: only a pending invitation is resent. */
  INVITATION_NOT_PENDING: 'identity.invitation_not_pending',
  USER_NOT_FOUND: 'identity.user_not_found',
  INVITATION_NOT_FOUND: 'identity.invitation_not_found',
  /** REQ-425: the one answer to every request of a reset. */
  RESET_REQUESTED: 'identity.reset_requested',
  /** REQ-435: the words of the e-mails of access, with `{link}` and `{expiresAt}`. */
  INVITATION_EMAIL_SUBJECT: 'identity.invitation_email_subject',
  INVITATION_EMAIL_BODY: 'identity.invitation_email_body',
  RESET_EMAIL_SUBJECT: 'identity.reset_email_subject',
  RESET_EMAIL_BODY: 'identity.reset_email_body',
  /** The HTML version of the same e-mails: a heading, a button, the link written out. */
  INVITATION_EMAIL_HEADING: 'identity.invitation_email_heading',
  INVITATION_EMAIL_INTRO: 'identity.invitation_email_intro',
  INVITATION_EMAIL_BUTTON: 'identity.invitation_email_button',
  INVITATION_EMAIL_IGNORE: 'identity.invitation_email_ignore',
  RESET_EMAIL_HEADING: 'identity.reset_email_heading',
  RESET_EMAIL_INTRO: 'identity.reset_email_intro',
  RESET_EMAIL_BUTTON: 'identity.reset_email_button',
  RESET_EMAIL_IGNORE: 'identity.reset_email_ignore',
  EMAIL_LINK_FALLBACK: 'identity.email_link_fallback',
} as const;

export type IdentityMessageKey = (typeof IDENTITY_MESSAGES)[keyof typeof IDENTITY_MESSAGES];
