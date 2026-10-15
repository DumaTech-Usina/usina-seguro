import type { Transporter } from 'nodemailer';
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
    });
  }
}
