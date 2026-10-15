import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { composeApplication } from '../composition-root.ts';
import { loadConfig } from '../config/config.ts';
import type { Role } from '../core/identity/domain/role.ts';
import { BusinessRuleViolation } from '../core/proposal/domain/errors.ts';
import { translate } from '../i18n/messages.ts';

/**
 * REQ-407: creates a user with a password, run on the server:
 *
 *   npm run create-user -- --email=dev@email.com [--name="Dev"] [--role=admin|user]
 *
 * The password is never an argument — it would stay in the shell history. It
 * is asked apart, twice, without echo on a terminal; piped, it is read as the
 * first two lines of the input. The role is Usuário unless `--role=admin`
 * (`Q-415` keeps the rest of the specification open).
 */
const ROLES: Record<string, Role> = { user: 'USER', admin: 'ADMINISTRATOR' };
const ROLE_NAMES: Record<Role, string> = { USER: 'Usuário', ADMINISTRATOR: 'Administrador' };

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'user' },
    },
  });

  if (values.email === undefined || values.email.trim() === '') {
    console.error(
      'Uso: npm run create-user -- --email=<e-mail> [--name=<nome>] [--role=admin|user]',
    );
    return 1;
  }
  const role = ROLES[values.role ?? 'user'];
  if (role === undefined) {
    console.error('Papel desconhecido. Use --role=admin ou --role=user.');
    return 1;
  }

  const [password, confirmation] = await readPasswords();
  if (password !== confirmation) {
    console.error('As senhas não conferem.');
    return 1;
  }

  const application = composeApplication(loadConfig());
  try {
    const user = await application.useCases.createUser.execute({
      email: values.email,
      password,
      role,
      name: values.name?.trim() || null,
    });
    console.log(`Usuário criado: ${user.email} (${ROLE_NAMES[user.role]})`);
    return 0;
  } catch (error) {
    if (!(error instanceof BusinessRuleViolation)) {
      throw error;
    }
    console.error(translate(error.messageKey, error.params));
    return 1;
  } finally {
    await application.shutdown();
  }
}

/** On a terminal, asked twice without echo; piped, the first two lines. */
async function readPasswords(): Promise<[string, string]> {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    const [first = '', second = ''] = input.split(/\r?\n/);
    return [first, second];
  }

  return [await askHidden('Senha: '), await askHidden('Repita a senha: ')];
}

function askHidden(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Everything readline would echo after the question is swallowed.
  const muted = prompt as unknown as { _writeToOutput: (text: string) => void };
  muted._writeToOutput = (text) => {
    if (text.startsWith(question)) {
      process.stdout.write(question);
    }
  };

  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
