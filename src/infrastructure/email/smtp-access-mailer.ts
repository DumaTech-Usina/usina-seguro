import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../../config/config.ts';
import type { AccessMail, AccessMailer } from '../../core/identity/application/access-mailer.ts';
import { type AccessMailKind, accessMailContent } from './access-mail-content.ts';

/**
 * REQ-435: the e-mails of access through the Usina's own SMTP. The transport
 * is built in the composition root from the configuration; any other means of
 * sending is another adapter of the same port.
 */
export class SmtpAccessMailer implements AccessMailer {
  readonly delivers = true;
  private readonly transport: Transporter;
  private readonly options: { from: string; publicUrl: string };

  constructor(transport: Transporter, options: { from: string; publicUrl: string }) {
    this.transport = transport;
    this.options = options;
  }

  sendInvitation(mail: AccessMail): Promise<void> {
    return this.send('INVITATION', mail);
  }

  sendPasswordReset(mail: AccessMail): Promise<void> {
    return this.send('PASSWORD_RESET', mail);
  }

  private async send(kind: AccessMailKind, mail: AccessMail): Promise<void> {
    const content = accessMailContent(kind, mail, this.options.publicUrl);
    await this.transport.sendMail({
      from: this.options.from,
      to: mail.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}

type SmtpConfig = Extract<Config['email'], { driver: 'smtp' }>;

/**
 * The transport to the Usina's SMTP, from the configuration. Shared by the
 * server and `npm run smtp-check`, so the check tests what the server uses.
 *
 * The timeouts keep a request that sends an invitation from hanging on an
 * SMTP that does not answer: nodemailer waits two minutes by default.
 */
export function createSmtpTransport(email: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    // Without implicit TLS: no STARTTLS offered means no sending, rather than
    // the password in clear.
    requireTLS: !email.secure && email.requireTls,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(email.user === null ? {} : { auth: { user: email.user, pass: email.password ?? '' } }),
  });
}
