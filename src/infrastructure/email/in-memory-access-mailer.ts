import type { AccessMail, AccessMailer } from '../../core/identity/application/access-mailer.ts';

export interface SentAccessMail extends AccessMail {
  readonly kind: 'INVITATION' | 'PASSWORD_RESET';
}

/** The outbox of the tests: nothing leaves, everything sent is kept to be read. */
export class InMemoryAccessMailer implements AccessMailer {
  readonly delivers: boolean;
  readonly sent: SentAccessMail[] = [];

  constructor(options: { delivers: boolean }) {
    this.delivers = options.delivers;
  }

  async sendInvitation(mail: AccessMail): Promise<void> {
    this.sent.push({ kind: 'INVITATION', ...mail });
  }

  async sendPasswordReset(mail: AccessMail): Promise<void> {
    this.sent.push({ kind: 'PASSWORD_RESET', ...mail });
  }
}
