import { composeApplication } from './composition-root.ts';
import { loadConfig } from './config/config.ts';
import { BusinessRuleViolation } from './core/proposal/domain/errors.ts';
import { translate } from './i18n/messages.ts';

/**
 * REQ-405: the first administrator is born of this command, run on the server:
 *
 *   npm run first-admin -- ana@usina.com.br
 *
 * It issues an administrator invitation and prints its link, valid for 72
 * hours (REQ-420). Nothing is sent by e-mail: whoever runs it hands the link
 * over. There is no default user or password (REJ-407).
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (email === undefined || email.trim() === '') {
    console.error('Usage: npm run first-admin -- <e-mail>');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const application = composeApplication(config);

  try {
    const invitation = await application.useCases.issueFirstAdministratorInvitation.execute({
      email,
    });
    const link = `${config.http.publicUrl}/app/invitation/?token=${invitation.token}`;

    console.log(`Convite de administrador para ${invitation.email}`);
    console.log(`Válido até ${invitation.expiresAt}`);
    console.log(link);
  } catch (error) {
    if (!(error instanceof BusinessRuleViolation)) {
      throw error;
    }
    console.error(translate(error.messageKey, error.params));
    process.exitCode = 1;
  } finally {
    await application.shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
