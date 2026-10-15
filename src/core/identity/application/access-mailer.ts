/**
 * Sends the e-mails of access to the system (REQ-435): the invitation and the
 * password reset. The means — SMTP today, another tomorrow — is the adapter's,
 * and so are the link and the words; the core only says what to send and to
 * whom.
 *
 * Not a `NotificationChannel`: these are not business notifications
 * (REQ-100 to REQ-105 of V1) and are never listed among them.
 */
export interface AccessMail {
  readonly to: string;
  /** The token of the link, in clear: it exists only in the e-mail (REQ-416). */
  readonly token: string;
  readonly expiresAt: string;
}

export interface AccessMailer {
  /**
   * REQ-436: whether e-mail really reaches people. Without it, the link of an
   * invitation goes back to the administrator instead.
   */
  readonly delivers: boolean;
  sendInvitation(mail: AccessMail): Promise<void>;
  sendPasswordReset(mail: AccessMail): Promise<void>;
}
