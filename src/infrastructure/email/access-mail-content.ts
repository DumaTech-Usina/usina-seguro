import type { AccessMail } from '../../core/identity/application/access-mailer.ts';
import { IDENTITY_MESSAGES } from '../../core/identity/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';

export type AccessMailKind = 'INVITATION' | 'PASSWORD_RESET';

export interface AccessMailContent {
  readonly subject: string;
  readonly text: string;
  readonly link: string;
}

/** The page each link opens: the acceptance of the invitation or the reset. */
const PAGE: Record<AccessMailKind, string> = {
  INVITATION: '/app/invitation/',
  PASSWORD_RESET: '/app/password-reset/',
};

const WORDS = {
  INVITATION: [IDENTITY_MESSAGES.INVITATION_EMAIL_SUBJECT, IDENTITY_MESSAGES.INVITATION_EMAIL_BODY],
  PASSWORD_RESET: [IDENTITY_MESSAGES.RESET_EMAIL_SUBJECT, IDENTITY_MESSAGES.RESET_EMAIL_BODY],
} as const;

/** The subject, the text and the link of an e-mail of access (REQ-435), in Portuguese. */
export function accessMailContent(
  kind: AccessMailKind,
  mail: AccessMail,
  publicUrl: string,
): AccessMailContent {
  const link = `${publicUrl}${PAGE[kind]}?token=${encodeURIComponent(mail.token)}`;
  const expiresAt = new Date(mail.expiresAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const [subject, body] = WORDS[kind];

  return { subject: translate(subject), text: translate(body, { link, expiresAt }), link };
}
