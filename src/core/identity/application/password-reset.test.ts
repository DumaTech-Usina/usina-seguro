import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAccessMailer } from '../../../infrastructure/email/in-memory-access-mailer.ts';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryInvitationRepository } from '../../../infrastructure/persistence/in-memory/in-memory-invitation-repository.ts';
import { InMemoryPasswordResetRepository } from '../../../infrastructure/persistence/in-memory/in-memory-password-reset-repository.ts';
import { InMemorySessionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-session-repository.ts';
import { InMemoryUserRepository } from '../../../infrastructure/persistence/in-memory/in-memory-user-repository.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { CreateUser } from './create-user.ts';
import { DeactivateUser } from './deactivate-user.ts';
import { InviteUser } from './invite-user.ts';
import { LogIn } from './log-in.ts';
import type { PasswordHasher } from './password-hasher.ts';
import { RequestPasswordReset } from './request-password-reset.ts';
import { ResetPassword } from './reset-password.ts';
import { ResolveSession } from './resolve-session.ts';

const AT = new Date('2026-10-14T08:00:00.000Z');
const OLD = 'correct horse battery';
const NEW = 'outra senha bem longa';

const hasher: PasswordHasher = {
  hash: async (password) => `hashed(${password})`,
  verify: async (password, hash) => hash === `hashed(${password})`,
};

function setup(options: { delivers?: boolean } = {}) {
  let clock = AT;
  let ids = 0;
  let tokens = 0;
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const resets = new InMemoryPasswordResetRepository();
  const invitations = new InMemoryInvitationRepository();
  const mailer = new InMemoryAccessMailer({ delivers: options.delivers ?? true });
  const secrets = { generate: () => `token-${++tokens}`, digest: (t: string) => `digest(${t})` };
  const newId = () => `id-${++ids}`;
  const now = () => clock;

  return {
    users,
    resets,
    mailer,
    setClock: (date: Date) => {
      clock = date;
    },
    createUser: new CreateUser({ users, hasher, newId, now }),
    logIn: new LogIn({ users, sessions, hasher, secrets, newId, now }),
    resolveSession: new ResolveSession({ users, sessions, secrets, now }),
    deactivateUser: new DeactivateUser({ users, sessions, now }),
    inviteUser: new InviteUser({ users, invitations, secrets, mailer, newId, now }),
    requestPasswordReset: new RequestPasswordReset({ users, resets, secrets, mailer, newId, now }),
    resetPassword: new ResetPassword({
      users,
      resets,
      sessions,
      hasher,
      secrets,
      transaction: new ImmediateTransaction(),
      now,
    }),
  };
}

type Setup = ReturnType<typeof setup>;

async function expectRefusal(work: Promise<unknown>, messageKey: string) {
  try {
    await work;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).messageKey).toBe(messageKey);
  }
}

async function aUser(
  s: Setup,
  email = 'ana@usina.com.br',
  role: 'USER' | 'ADMINISTRATOR' = 'USER',
) {
  return s.createUser.execute({ email, password: OLD, role, name: null });
}

/** The token the e-mail of the last reset carried. */
function lastResetToken(s: Setup): string {
  const sent = s.mailer.sent.filter((mail) => mail.kind === 'PASSWORD_RESET').at(-1);
  if (sent === undefined) {
    throw new Error('No reset e-mail was sent.');
  }
  return sent.token;
}

describe('RequestPasswordReset (REQ-425)', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('sends an active user a single-use link valid for 1 hour, keeping only its digest', async () => {
    await aUser(s);

    await s.requestPasswordReset.execute({ email: ' ANA@usina.com.br' });

    expect(s.mailer.sent).toEqual([
      {
        kind: 'PASSWORD_RESET',
        to: 'ana@usina.com.br',
        token: 'token-1',
        expiresAt: '2026-10-14T09:00:00.000Z',
      },
    ]);
    expect(await s.resets.findByTokenDigest('digest(token-1)')).not.toBeNull();
    expect(await s.resets.findByTokenDigest('token-1')).toBeNull();
  });

  it('answers the same and sends nothing for an e-mail with no active user (FA-402, CA-410)', async () => {
    const user = await aUser(s, 'saiu@usina.com.br');
    await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR');
    await s.deactivateUser.execute({
      actor: { id: 'x', role: 'ADMINISTRATOR' },
      userId: user.id,
    });

    await expect(
      s.requestPasswordReset.execute({ email: 'nobody@usina.com.br' }),
    ).resolves.toBeUndefined();
    await expect(
      s.requestPasswordReset.execute({ email: 'saiu@usina.com.br' }),
    ).resolves.toBeUndefined();
    await expect(s.requestPasswordReset.execute({ email: '' })).resolves.toBeUndefined();

    expect(s.mailer.sent).toEqual([]);
  });
});

describe('ResetPassword (REQ-426)', () => {
  let s: Setup;
  beforeEach(async () => {
    s = setup();
    await aUser(s);
  });

  it('sets the new password: the old one stops working and the new one works (CA-409)', async () => {
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });

    await s.resetPassword.execute({ token: lastResetToken(s), password: NEW });

    await expectRefusal(
      s.logIn.execute({ email: 'ana@usina.com.br', password: OLD }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
    );
    await expect(
      s.logIn.execute({ email: 'ana@usina.com.br', password: NEW }),
    ).resolves.toBeDefined();
  });

  it('ends every session of the user (REQ-408 of the plan, REQ-426)', async () => {
    const { token: session } = await s.logIn.execute({ email: 'ana@usina.com.br', password: OLD });
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });

    await s.resetPassword.execute({ token: lastResetToken(s), password: NEW });

    await expect(s.resolveSession.execute({ token: session })).resolves.toBeNull();
  });

  it('refuses the same link twice, and every other pending link of the user (REJ-403)', async () => {
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });
    const first = lastResetToken(s);
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });
    const second = lastResetToken(s);

    await s.resetPassword.execute({ token: second, password: NEW });

    await expectRefusal(
      s.resetPassword.execute({ token: second, password: NEW }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
    await expectRefusal(
      s.resetPassword.execute({ token: first, password: NEW }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
  });

  it('refuses a link older than 1 hour, and an unknown one', async () => {
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });
    s.setClock(new Date('2026-10-14T09:00:00.000Z'));

    await expectRefusal(
      s.resetPassword.execute({ token: lastResetToken(s), password: NEW }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
    await expectRefusal(
      s.resetPassword.execute({ token: 'made-up', password: NEW }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
  });

  it('refuses a short password and leaves the link usable (REQ-415)', async () => {
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });
    const token = lastResetToken(s);

    await expectRefusal(
      s.resetPassword.execute({ token, password: 'short' }),
      IDENTITY_MESSAGES.PASSWORD_LENGTH,
    );
    await expect(s.resetPassword.execute({ token, password: NEW })).resolves.toBeUndefined();
  });

  it('lets a suspended login in again with the new password (REQ-414)', async () => {
    for (let i = 0; i < 5; i++) {
      await s.logIn
        .execute({ email: 'ana@usina.com.br', password: 'wrong password!' })
        .catch(() => {});
    }
    await s.requestPasswordReset.execute({ email: 'ana@usina.com.br' });

    await s.resetPassword.execute({ token: lastResetToken(s), password: NEW });

    await expect(
      s.logIn.execute({ email: 'ana@usina.com.br', password: NEW }),
    ).resolves.toBeDefined();
  });
});

describe('the invitation e-mail (REQ-435, REQ-436)', () => {
  const admin = { id: 'admin', role: 'ADMINISTRATOR' as const };

  it('with e-mail configured, sends the link by e-mail and hands no link back', async () => {
    const s = setup({ delivers: true });

    const issued = await s.inviteUser.execute({
      actor: admin,
      email: 'bruno@usina.com.br',
      role: 'USER',
    });

    expect(issued.token).toBeNull();
    expect(s.mailer.sent).toEqual([
      expect.objectContaining({ kind: 'INVITATION', to: 'bruno@usina.com.br', token: 'token-1' }),
    ]);
  });

  it('without e-mail configured, hands the link back to the administrator and sends nothing', async () => {
    const s = setup({ delivers: false });

    const issued = await s.inviteUser.execute({
      actor: admin,
      email: 'bruno@usina.com.br',
      role: 'USER',
    });

    expect(issued.token).toBe('token-1');
    expect(s.mailer.sent).toEqual([]);
  });
});
