import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { LogAccessMailer } from './log-access-mailer.ts';
import { SmtpAccessMailer } from './smtp-access-mailer.ts';

/**
 * The e-mails of REQ-435, built by the SMTP adapter on a transport that writes
 * the message instead of sending it: nothing leaves the machine.
 */
function captured() {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const messages: string[] = [];
  const original = transport.sendMail.bind(transport);
  transport.sendMail = (async (mail: Parameters<typeof original>[0]) => {
    const info = await original(mail);
    messages.push(decoded(String((info as unknown as { message: Buffer }).message)));
    return info;
  }) as typeof transport.sendMail;
  return { transport, messages };
}

/**
 * The body goes quoted-printable (it has accents): soft line breaks are
 * dropped and `=XX` turned back into its character, enough to read an ASCII
 * link.
 */
function decoded(message: string): string {
  return message
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

const MAIL = {
  to: 'bruno@usina.com.br',
  token: 'TOKEN-123',
  expiresAt: '2026-10-17T08:00:00.000Z',
};

describe('SmtpAccessMailer (REQ-435)', () => {
  it('delivers: an invitation goes by e-mail, with the link to accept it', async () => {
    const { transport, messages } = captured();
    const mailer = new SmtpAccessMailer(transport, {
      from: 'Usina do Seguro <naoresponda@usina.example>',
      publicUrl: 'https://usina.example',
    });

    await mailer.sendInvitation(MAIL);

    expect(mailer.delivers).toBe(true);
    const [message] = messages;
    expect(message).toContain('To: bruno@usina.com.br');
    expect(message).toContain('naoresponda@usina.example');
    expect(message).toContain('https://usina.example/app/invitation/?token=TOKEN-123');
  });

  it('sends the password reset with its own link', async () => {
    const { transport, messages } = captured();
    const mailer = new SmtpAccessMailer(transport, {
      from: 'naoresponda@usina.example',
      publicUrl: 'https://usina.example',
    });

    await mailer.sendPasswordReset(MAIL);

    expect(messages[0]).toContain('https://usina.example/app/password-reset/?token=TOKEN-123');
  });
});

describe('LogAccessMailer (REQ-436)', () => {
  it('does not deliver, and writes the reset e-mail to the output of the server', async () => {
    const lines: string[] = [];
    const mailer = new LogAccessMailer((line) => lines.push(line), 'http://127.0.0.1:3000');

    await mailer.sendPasswordReset(MAIL);

    expect(mailer.delivers).toBe(false);
    expect(lines.join('\n')).toContain('bruno@usina.com.br');
    expect(lines.join('\n')).toContain('http://127.0.0.1:3000/app/password-reset/?token=TOKEN-123');
  });
});
