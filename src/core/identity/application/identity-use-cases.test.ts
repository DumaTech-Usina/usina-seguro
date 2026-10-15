import { beforeEach, describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryInvitationRepository } from '../../../infrastructure/persistence/in-memory/in-memory-invitation-repository.ts';
import { InMemorySessionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-session-repository.ts';
import { InMemoryUserRepository } from '../../../infrastructure/persistence/in-memory/in-memory-user-repository.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { User } from '../domain/user.ts';
import { AcceptInvitation } from './accept-invitation.ts';
import { IssueFirstAdministratorInvitation } from './issue-first-administrator-invitation.ts';
import { LogIn } from './log-in.ts';
import { LogOut } from './log-out.ts';
import type { PasswordHasher } from './password-hasher.ts';
import { ResolveSession } from './resolve-session.ts';
import type { SecretGenerator } from './secret-generator.ts';

const AT = new Date('2026-10-14T08:00:00.000Z');
const PASSWORD = 'correct horse battery';

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Readable stand-ins: what matters here is that the clear text is never what is kept. */
const hasher: PasswordHasher = {
  hash: async (password) => `hashed(${password})`,
  verify: async (password, hash) => hash === `hashed(${password})`,
};

function counterSecrets(): SecretGenerator {
  let next = 0;
  return {
    generate: () => `token-${++next}`,
    digest: (token) => `digest(${token})`,
  };
}

function setup() {
  let clock = AT;
  let ids = 0;
  const users = new InMemoryUserRepository();
  const invitations = new InMemoryInvitationRepository();
  const sessions = new InMemorySessionRepository();
  const secrets = counterSecrets();
  const newId = () => `id-${++ids}`;
  const now = () => clock;

  return {
    users,
    invitations,
    sessions,
    setClock: (date: Date) => {
      clock = date;
    },
    issueFirstAdministratorInvitation: new IssueFirstAdministratorInvitation({
      users,
      invitations,
      secrets,
      newId,
      now,
    }),
    acceptInvitation: new AcceptInvitation({
      users,
      invitations,
      hasher,
      secrets,
      transaction: new ImmediateTransaction(),
      newId,
      now,
    }),
    logIn: new LogIn({ users, sessions, hasher, secrets, newId, now }),
    logOut: new LogOut({ sessions, secrets, now }),
    resolveSession: new ResolveSession({ users, sessions, secrets, now }),
  };
}

type Setup = ReturnType<typeof setup>;

async function expectRefusal(work: Promise<unknown>, messageKey: string, rule?: string) {
  try {
    await work;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).messageKey).toBe(messageKey);
    if (rule !== undefined) {
      expect((error as BusinessRuleViolation).rule).toBe(rule);
    }
  }
}

/** An administrator who accepted the first invitation, with `PASSWORD`. */
async function anAdministrator(s: Setup, email = 'ana@usina.com.br', name?: string) {
  const { token } = await s.issueFirstAdministratorInvitation.execute({ email });
  return s.acceptInvitation.execute({
    token,
    password: PASSWORD,
    ...(name === undefined ? {} : { name }),
  });
}

describe('IssueFirstAdministratorInvitation (REQ-405)', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('issues an administrator invitation valid for 72 hours and answers its link token', async () => {
    const issued = await s.issueFirstAdministratorInvitation.execute({ email: 'Ana@Usina.com.br' });

    expect(issued).toEqual({
      email: 'ana@usina.com.br',
      token: 'token-1',
      expiresAt: '2026-10-17T08:00:00.000Z',
    });
  });

  it('keeps only the digest of the token, never the token (REQ-416)', async () => {
    await s.issueFirstAdministratorInvitation.execute({ email: 'ana@usina.com.br' });

    const stored = await s.invitations.findByTokenDigest('digest(token-1)');
    expect(stored?.role).toBe('ADMINISTRATOR');
    expect(stored?.invitedBy).toBeNull();
    expect(await s.invitations.findByTokenDigest('token-1')).toBeNull();
  });

  it('a newer invitation for the same e-mail supersedes the previous one (REQ-421, CA-408)', async () => {
    const first = await s.issueFirstAdministratorInvitation.execute({ email: 'ana@usina.com.br' });
    const second = await s.issueFirstAdministratorInvitation.execute({
      email: 'ANA@usina.com.br',
    });

    await expectRefusal(
      s.acceptInvitation.execute({ token: first.token, password: PASSWORD }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
    await expect(
      s.acceptInvitation.execute({ token: second.token, password: PASSWORD }),
    ).resolves.toMatchObject({ email: 'ana@usina.com.br' });
  });

  it('refuses the e-mail of an active user (REQ-421, EX-406)', async () => {
    await anAdministrator(s);

    await expectRefusal(
      s.issueFirstAdministratorInvitation.execute({ email: 'ana@usina.com.br' }),
      IDENTITY_MESSAGES.EMAIL_ALREADY_ACTIVE,
      'REQ-421',
    );
  });
});

describe('AcceptInvitation (REQ-422)', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('creates the user active, with the invited role and the name informed (CA-407)', async () => {
    const user = await anAdministrator(s, 'ana@usina.com.br', ' Ana Lima ');

    expect(user).toEqual({
      id: expect.any(String),
      email: 'ana@usina.com.br',
      name: 'Ana Lima',
      role: 'ADMINISTRATOR',
      displayName: 'Ana Lima',
    });

    const stored = await s.users.findById(user.id);
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.passwordHash).toBe(`hashed(${PASSWORD})`);
  });

  it('accepts no name, and the user is shown by the e-mail (FA-405)', async () => {
    const user = await anAdministrator(s);

    expect(user.name).toBeNull();
    expect(user.displayName).toBe('ana@usina.com.br');
  });

  it('refuses the same link a second time (REJ-403)', async () => {
    const { token } = await s.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });
    await s.acceptInvitation.execute({ token, password: PASSWORD });

    await expectRefusal(
      s.acceptInvitation.execute({ token, password: PASSWORD }),
      IDENTITY_MESSAGES.INVALID_LINK,
      'REQ-422',
    );
  });

  it('refuses an unknown link with the same message (EX-403)', async () => {
    await expectRefusal(
      s.acceptInvitation.execute({ token: 'made-up', password: PASSWORD }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
  });

  it('refuses a link older than 72 hours (CA-408)', async () => {
    const { token } = await s.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });
    s.setClock(minutesAfter(AT, 72 * 60));

    await expectRefusal(
      s.acceptInvitation.execute({ token, password: PASSWORD }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
  });

  it('refuses a short password and leaves the link usable (REQ-415)', async () => {
    const { token } = await s.issueFirstAdministratorInvitation.execute({
      email: 'ana@usina.com.br',
    });

    await expectRefusal(
      s.acceptInvitation.execute({ token, password: 'short' }),
      IDENTITY_MESSAGES.PASSWORD_LENGTH,
      'REQ-415',
    );
    await expect(s.acceptInvitation.execute({ token, password: PASSWORD })).resolves.toMatchObject({
      role: 'ADMINISTRATOR',
    });
  });
});

describe('LogIn, ResolveSession and LogOut (REQ-411 to REQ-414)', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('opens a session for the right e-mail and password (CA-402)', async () => {
    const admin = await anAdministrator(s);

    const session = await s.logIn.execute({ email: ' ANA@usina.com.br', password: PASSWORD });

    expect(session.user).toEqual(admin);
    expect(session.expiresAt).toBe('2026-10-14T20:00:00.000Z');
    await expect(s.resolveSession.execute({ token: session.token })).resolves.toEqual(admin);
  });

  it('keeps only the digest of the session token (REQ-416)', async () => {
    await anAdministrator(s);
    const { token } = await s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });

    expect(await s.sessions.findByTokenDigest(`digest(${token})`)).not.toBeNull();
    expect(await s.sessions.findByTokenDigest(token)).toBeNull();
  });

  it('answers the same refusal to a wrong password and to an unknown e-mail (CA-404)', async () => {
    await anAdministrator(s);

    await expectRefusal(
      s.logIn.execute({ email: 'ana@usina.com.br', password: 'wrong password!' }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
      'REQ-413',
    );
    await expectRefusal(
      s.logIn.execute({ email: 'nobody@usina.com.br', password: PASSWORD }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
      'REQ-413',
    );
  });

  it('refuses a deactivated user with the same refusal (EX-404)', async () => {
    const admin = await anAdministrator(s);
    const stored = (await s.users.findById(admin.id)) as User;
    await s.users.save(User.restore({ ...stored.toData(), status: 'DEACTIVATED' }));

    await expectRefusal(
      s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
    );
  });

  it('after 5 failures in a row refuses even the right password, for 15 minutes (CA-405)', async () => {
    await anAdministrator(s);
    for (let i = 0; i < 5; i++) {
      await expectRefusal(
        s.logIn.execute({ email: 'ana@usina.com.br', password: 'wrong password!' }),
        IDENTITY_MESSAGES.LOGIN_REFUSED,
      );
    }

    await expectRefusal(
      s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
      'REQ-413',
    );

    s.setClock(minutesAfter(AT, 15));
    await expect(
      s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD }),
    ).resolves.toMatchObject({ user: { email: 'ana@usina.com.br' } });
  });

  it('a successful login resets the count of failures (REQ-414)', async () => {
    await anAdministrator(s);
    for (let i = 0; i < 4; i++) {
      await expectRefusal(
        s.logIn.execute({ email: 'ana@usina.com.br', password: 'wrong password!' }),
        IDENTITY_MESSAGES.LOGIN_REFUSED,
      );
    }
    await s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });
    await expectRefusal(
      s.logIn.execute({ email: 'ana@usina.com.br', password: 'wrong password!' }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
    );

    await expect(
      s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('no longer resolves a session 12 hours after the login (CA-403)', async () => {
    await anAdministrator(s);
    const { token } = await s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });

    s.setClock(minutesAfter(AT, 12 * 60 - 1));
    await expect(s.resolveSession.execute({ token })).resolves.not.toBeNull();

    s.setClock(minutesAfter(AT, 12 * 60));
    await expect(s.resolveSession.execute({ token })).resolves.toBeNull();
  });

  it('no longer resolves a session after the logout (CA-402)', async () => {
    await anAdministrator(s);
    const { token } = await s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });

    await s.logOut.execute({ token });

    await expect(s.resolveSession.execute({ token })).resolves.toBeNull();
  });

  it('a logout with an unknown token changes nothing and does not fail', async () => {
    await expect(s.logOut.execute({ token: 'made-up' })).resolves.toBeUndefined();
  });

  it('does not resolve an unknown token', async () => {
    await expect(s.resolveSession.execute({ token: 'made-up' })).resolves.toBeNull();
  });

  it('no longer resolves the session of a user deactivated afterwards (REQ-403)', async () => {
    const admin = await anAdministrator(s);
    const { token } = await s.logIn.execute({ email: 'ana@usina.com.br', password: PASSWORD });
    const stored = (await s.users.findById(admin.id)) as User;
    await s.users.save(User.restore({ ...stored.toData(), status: 'DEACTIVATED' }));

    await expect(s.resolveSession.execute({ token })).resolves.toBeNull();
  });
});
