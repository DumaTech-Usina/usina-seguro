import { parseArgs } from 'node:util';
import { loadConfig } from '../config/config.ts';
import { accessMailContent } from '../infrastructure/email/access-mail-content.ts';
import { createSmtpTransport } from '../infrastructure/email/smtp-access-mailer.ts';

/**
 * Checks the SMTP the server would use, with the same configuration:
 *
 *   npm run smtp-check                      # connects and authenticates, sends nothing
 *   npm run smtp-check -- --to=<e-mail>     # also sends the two templates to that address
 *
 * The test e-mails carry a token that opens no account: the link shows the
 * page with "link inválido". The password is never printed.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { to: { type: 'string' } } });
  const config = loadConfig();
  const { email } = config;

  if (email.driver !== 'smtp') {
    console.error(
      `SMTP não configurado: o envio está em '${email.driver}'. Defina SMTP_HOST e SMTP_FROM.`,
    );
    return 1;
  }

  const tls = email.secure
    ? 'TLS implícito'
    : email.requireTls
      ? 'STARTTLS exigido'
      : 'STARTTLS opcional';
  const auth = email.user === null ? 'sem autenticação' : `usuário ${email.user}`;
  console.log(`SMTP ${email.host}:${email.port} (${tls}, ${auth})`);

  const transport = createSmtpTransport(email);
  try {
    await transport.verify();
    console.log('Conexão e autenticação: OK');

    if (values.to !== undefined) {
      const mail = {
        to: values.to,
        token: 'verificacao-smtp',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      for (const kind of ['INVITATION', 'PASSWORD_RESET'] as const) {
        const content = accessMailContent(kind, mail, config.http.publicUrl);
        await transport.sendMail({
          from: email.from,
          to: values.to,
          subject: `[Teste] ${content.subject}`,
          text: content.text,
          html: content.html,
        });
      }
      console.log(`Dois e-mails de teste enviados para ${values.to}.`);
    }
    return 0;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    console.error(`Falha no SMTP${code === undefined ? '' : ` (${code})`}: ${message}`);
    return 1;
  } finally {
    transport.close();
  }
}

main().then((code) => process.exit(code));
