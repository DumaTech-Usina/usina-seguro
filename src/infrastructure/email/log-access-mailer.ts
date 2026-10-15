import type { AccessMail, AccessMailer } from '../../core/identity/application/access-mailer.ts';
import { type AccessMailKind, accessMailContent } from './access-mail-content.ts';

/**
 * REQ-436: while no SMTP is configured nothing reaches people. The link of an
 * invitation goes back to the administrator instead (`delivers` is false); a
 * password reset — which has nobody else to go to — is written to the output
 * of the server, for whoever runs it. Interim, until the SMTP is configured.
 */
export class LogAccessMailer implements AccessMailer {
  readonly delivers = false;
  private readonly write: (line: string) => void;
  private readonly publicUrl: string;

  constructor(write: (line: string) => void, publicUrl: string) {
    this.write = write;
    this.publicUrl = publicUrl;
  }

  async sendInvitation(mail: AccessMail): Promise<void> {
    this.log('INVITATION', mail);
  }

  async sendPasswordReset(mail: AccessMail): Promise<void> {
    this.log('PASSWORD_RESET', mail);
  }

  private log(kind: AccessMailKind, mail: AccessMail): void {
    const content = accessMailContent(kind, mail, this.publicUrl);
    this.write(`[e-mail não enviado: SMTP não configurado] Para: ${mail.to}`);
    this.write(`Assunto: ${content.subject}`);
    this.write(content.link);
  }
}
