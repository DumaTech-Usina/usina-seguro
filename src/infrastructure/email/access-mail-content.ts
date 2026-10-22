import type { AccessMail } from '../../core/identity/application/access-mailer.ts';
import { IDENTITY_MESSAGES } from '../../core/identity/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';

export type AccessMailKind = 'INVITATION' | 'PASSWORD_RESET';

export interface AccessMailContent {
  readonly subject: string;
  readonly text: string;
  /** The same message for e-mail clients that show HTML; `text` stays the fallback. */
  readonly html: string;
  readonly link: string;
}

/** The page each link opens: the acceptance of the invitation or the reset. */
const PAGE: Record<AccessMailKind, string> = {
  INVITATION: '/app/invitation/',
  PASSWORD_RESET: '/app/password-reset/',
};

const WORDS = {
  INVITATION: {
    subject: IDENTITY_MESSAGES.INVITATION_EMAIL_SUBJECT,
    body: IDENTITY_MESSAGES.INVITATION_EMAIL_BODY,
    heading: IDENTITY_MESSAGES.INVITATION_EMAIL_HEADING,
    intro: IDENTITY_MESSAGES.INVITATION_EMAIL_INTRO,
    button: IDENTITY_MESSAGES.INVITATION_EMAIL_BUTTON,
    ignore: IDENTITY_MESSAGES.INVITATION_EMAIL_IGNORE,
  },
  PASSWORD_RESET: {
    subject: IDENTITY_MESSAGES.RESET_EMAIL_SUBJECT,
    body: IDENTITY_MESSAGES.RESET_EMAIL_BODY,
    heading: IDENTITY_MESSAGES.RESET_EMAIL_HEADING,
    intro: IDENTITY_MESSAGES.RESET_EMAIL_INTRO,
    button: IDENTITY_MESSAGES.RESET_EMAIL_BUTTON,
    ignore: IDENTITY_MESSAGES.RESET_EMAIL_IGNORE,
  },
} as const;

/** The subject, the text, the HTML and the link of an e-mail of access (REQ-435), in Portuguese. */
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
  const words = WORDS[kind];

  return {
    subject: translate(words.subject),
    text: translate(words.body, { link, expiresAt }),
    html: htmlOf({
      heading: translate(words.heading),
      intro: translate(words.intro, { expiresAt }),
      button: translate(words.button),
      fallback: translate(IDENTITY_MESSAGES.EMAIL_LINK_FALLBACK),
      ignore: translate(words.ignore),
      link,
    }),
    link,
  };
}

/**
 * One column, tables and inline styles: what e-mail clients render alike, on
 * a phone as on a desktop. Every value is escaped before it goes in.
 */
function htmlOf(parts: {
  heading: string;
  intro: string;
  button: string;
  fallback: string;
  ignore: string;
  link: string;
}): string {
  const heading = escapeHtml(parts.heading);
  const link = escapeHtml(parts.link);
  const text = 'font-family:Arial,Helvetica,sans-serif;color:#1f2933;';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px 28px;${text}">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;${text}">${heading}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;${text}">${escapeHtml(parts.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="border-radius:6px;background:#0b5cad;">
<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(parts.button)}</a>
</td></tr>
</table>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;${text}">${escapeHtml(parts.fallback)}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;word-break:break-all;${text}"><a href="${link}" style="color:#0b5cad;">${link}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(parts.ignore)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
