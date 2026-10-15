import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';

/**
 * REQ-407: the command that creates a user with a password, run as the real
 * process. The password never goes in the arguments: it is read apart — typed
 * without echo on a terminal, one line per question when piped, as here.
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const COMMAND = path.join(ROOT, 'src/cli/create-user.ts');
const PASSWORD = 'correct horse battery';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-create-user-'));
  file = path.join(directory, 'usina.sqlite');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run(args: string[], input: string) {
  return spawnSync(process.execPath, [COMMAND, ...args], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file },
  });
}

async function withApplication<T>(work: (application: Application) => Promise<T>): Promise<T> {
  const application = composeApplication(
    loadConfig({ NODE_ENV: 'test', PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }),
  );
  try {
    return await work(application);
  } finally {
    await application.shutdown();
  }
}

describe('the create-user command (REQ-407)', () => {
  it('creates a user who logs in with the password typed apart', async () => {
    const result = run(['--email=dev@email.com', '--name=Dev'], `${PASSWORD}\n${PASSWORD}\n`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('dev@email.com');
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);

    const session = await withApplication((application) =>
      application.useCases.logIn.execute({ email: 'dev@email.com', password: PASSWORD }),
    );
    expect(session.user).toMatchObject({ name: 'Dev', role: 'USER' });
  });

  it('creates an administrator when asked', async () => {
    const result = run(['--email=admin@email.com', '--role=admin'], `${PASSWORD}\n${PASSWORD}\n`);

    expect(result.status, result.stderr).toBe(0);
    const session = await withApplication((application) =>
      application.useCases.logIn.execute({ email: 'admin@email.com', password: PASSWORD }),
    );
    expect(session.user.role).toBe('ADMINISTRATOR');
  });

  it('creates nothing when the confirmation differs', async () => {
    const result = run(['--email=dev@email.com'], `${PASSWORD}\noutra senha qualquer\n`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('As senhas não conferem.');
    await expect(
      withApplication((application) =>
        application.useCases.logIn.execute({ email: 'dev@email.com', password: PASSWORD }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a short password with the rule in Portuguese (REQ-415)', () => {
    const result = run(['--email=dev@email.com'], 'curta\ncurta\n');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A senha deve ter de 12 a 128 caracteres.');
  });

  it('refuses to run without an e-mail, or with an unknown role', () => {
    expect(run([], '').status).not.toBe(0);
    const unknown = run(['--email=dev@email.com', '--role=root'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('--role');
  });
});
