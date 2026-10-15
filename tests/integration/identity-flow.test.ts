import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { User } from '../../src/core/identity/domain/user.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteUserRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-user-repository.ts';

/**
 * The access foundation (V2 section 9C) over the real drivers: SQLite on disk,
 * `scrypt` and `randomBytes`. What a fake cannot answer is checked here — that
 * nothing secret reaches the file in clear (REQ-416), that the stored records
 * come back as they were, and that the first administrator really is born from
 * a command run on the server (REQ-405).
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const PASSWORD = 'correct horse battery';

let directory: string;
let file: string;
let application: Application;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-identity-'));
  file = path.join(directory, 'usina.sqlite');
  application = composeApplication(
    loadConfig({ NODE_ENV: 'test', PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }),
  );
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function everyStoredText(db: DatabaseSync): string {
  const tables = ['app_user', 'user_invitation', 'user_session'];
  return tables
    .flatMap((table) => db.prepare(`SELECT * FROM ${table}`).all())
    .flatMap((row) => Object.values(row as Record<string, unknown>))
    .map(String)
    .join('\n');
}

describe('the access foundation on SQLite (V2 section 9C)', () => {
  it('invites, accepts, logs in and resolves the session (REQ-405, REQ-411, REQ-422)', async () => {
    const { useCases } = application;
    const { token } = await useCases.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });
    const admin = await useCases.acceptInvitation.execute({ token, password: PASSWORD });

    const session = await useCases.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });

    await expect(useCases.resolveSession.execute({ token: session.token })).resolves.toEqual(admin);
    await useCases.logOut.execute({ token: session.token });
    await expect(useCases.resolveSession.execute({ token: session.token })).resolves.toBeNull();
  });

  it('keeps no password, session token or invitation link in clear (CA-406)', async () => {
    const { useCases } = application;
    const invitation = await useCases.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });
    await useCases.acceptInvitation.execute({ token: invitation.token, password: PASSWORD });
    const session = await useCases.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });

    const db = openSqliteConnection(file);
    try {
      const stored = everyStoredText(db);
      expect(stored).not.toContain(PASSWORD);
      expect(stored).not.toContain(invitation.token);
      expect(stored).not.toContain(session.token);
    } finally {
      db.close();
    }
  });

  it('keeps the count of failures and the suspension across reads (REQ-414)', async () => {
    const { useCases } = application;
    const { token } = await useCases.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });
    await useCases.acceptInvitation.execute({ token, password: PASSWORD });

    for (let i = 0; i < 5; i++) {
      await expect(
        useCases.logIn.execute({ email: 'ana@usina.com.br', password: 'wrong password!' }),
      ).rejects.toThrow();
    }

    await expect(
      useCases.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD }),
    ).rejects.toThrow();
  });

  it('allows one active user per e-mail, and a deactivated one does not block it (REQ-421)', async () => {
    const db = openSqliteConnection(file);
    const users = new SqliteUserRepository(db);
    const at = new Date('2026-10-14T08:00:00.000Z');
    const user = (id: string) =>
      User.create({
        id,
        email: 'ana@usina.com.br',
        name: null,
        role: 'USER',
        passwordHash: 'h',
        createdAt: at,
      });

    try {
      await users.save(User.restore({ ...user('user-1').toData(), status: 'DEACTIVATED' }));
      await users.save(user('user-2'));
      await expect(users.save(user('user-3'))).rejects.toThrow();

      expect((await users.findActiveByEmail('ana@usina.com.br'))?.id).toBe('user-2');
      expect((await users.findById('user-1'))?.status).toBe('DEACTIVATED');
    } finally {
      db.close();
    }
  });
});

describe('the first-administrator command (REQ-405)', () => {
  it('prints an administrator invitation link that can be accepted', async () => {
    const output = execFileSync(
      process.execPath,
      [path.join(ROOT, 'src/first-administrator.ts'), 'ana@usina.com.br'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PERSISTENCE_DRIVER: 'sqlite',
          SQLITE_FILE: file,
          APP_BASE_URL: 'https://usina.example',
        },
      },
    );

    const link = output.match(/https:\/\/usina\.example\/app\/invitation\/\?token=([\w-]+)/);
    expect(link, output).not.toBeNull();

    const admin = await application.useCases.acceptInvitation.execute({
      token: link?.[1] as string,
      password: PASSWORD,
    });
    expect(admin.role).toBe('ADMINISTRATOR');
  });

  it('refuses to run without an e-mail', () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(ROOT, 'src/first-administrator.ts')], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file },
      }),
    ).toThrow();
  });
});
