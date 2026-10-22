import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { accessMailContent } from './access-mail-content.ts';
import { LogAccessMailer } from './log-access-mailer.ts';
import { SmtpAccessMailer, createSmtpTransport } from './smtp-access-mailer.ts';

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

describe('the HTML of the e-mails of access (REQ-435)', () => {
  it('invites to create the password, with a button to the invitation page of the configured address', () => {
    const { html, text } = accessMailContent('INVITATION', MAIL, 'https://usina.example');

    expect(html).toContain('Convite para criar sua senha');
    expect(html).toContain(
      '<a href="https://usina.example/app/invitation/?token=TOKEN-123" target="_blank"',
    );
    expect(html).toContain('Criar minha senha');
    expect(html).toContain('17/10/2026, 05:00');
    // The text stays, for clients that do not show HTML.
    expect(text).toContain('https://usina.example/app/invitation/?token=TOKEN-123');
  });

  it('recovers the password, with a button to the reset page', () => {
    const { html } = accessMailContent('PASSWORD_RESET', MAIL, 'https://usina.example');

    expect(html).toContain('Recuperação de senha');
    expect(html).toContain('href="https://usina.example/app/password-reset/?token=TOKEN-123"');
    expect(html).toContain('Definir nova senha');
  });

  it('escapes what goes into the HTML', () => {
    const { html } = accessMailContent(
      'INVITATION',
      { ...MAIL, token: 'a"b' },
      'https://usina.example/"><script>',
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('goes as the HTML part of the message sent by SMTP', async () => {
    const { transport, messages } = captured();
    const mailer = new SmtpAccessMailer(transport, {
      from: 'naoresponda@usina.example',
      publicUrl: 'https://usina.example',
    });

    await mailer.sendInvitation(MAIL);

    expect(messages[0]).toContain('Content-Type: text/plain');
    expect(messages[0]).toContain('Content-Type: text/html');
  });
});

describe('createSmtpTransport', () => {
  const SMTP = {
    driver: 'smtp',
    host: 'smtp.usina.example',
    port: 587,
    secure: false,
    requireTls: true,
    user: 'naoresponda',
    password: 'segredo',
    from: 'naoresponda@usina.example',
  } as const;

  it('requires STARTTLS on 587 unless told otherwise, so the password never goes in clear', () => {
    const options = (transport: ReturnType<typeof createSmtpTransport>) =>
      (transport as unknown as { options: Record<string, unknown> }).options;

    expect(options(createSmtpTransport(SMTP))).toMatchObject({
      host: 'smtp.usina.example',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'naoresponda', pass: 'segredo' },
    });
    expect(options(createSmtpTransport({ ...SMTP, requireTls: false })).requireTLS).toBe(false);
    expect(options(createSmtpTransport({ ...SMTP, port: 465, secure: true }))).toMatchObject({
      secure: true,
      requireTLS: false,
    });
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
