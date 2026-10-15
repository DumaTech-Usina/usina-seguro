import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAccessMailer } from '../../../infrastructure/email/in-memory-access-mailer.ts';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryInvitationRepository } from '../../../infrastructure/persistence/in-memory/in-memory-invitation-repository.ts';
import { InMemoryRoleChangeRepository } from '../../../infrastructure/persistence/in-memory/in-memory-role-change-repository.ts';
import { InMemorySessionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-session-repository.ts';
import { InMemoryUserRepository } from '../../../infrastructure/persistence/in-memory/in-memory-user-repository.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import type { Role } from '../domain/role.ts';
import { AcceptInvitation } from './accept-invitation.ts';
import { ChangeUserRole } from './change-user-role.ts';
import { CreateUser } from './create-user.ts';
import { DeactivateUser } from './deactivate-user.ts';
import { InviteUser } from './invite-user.ts';
import { ListUsers } from './list-users.ts';
import { LogIn } from './log-in.ts';
import type { PasswordHasher } from './password-hasher.ts';
import { ResendInvitation } from './resend-invitation.ts';
import { ResolveSession } from './resolve-session.ts';
import type { UserView } from './user-view.ts';

const AT = new Date('2026-10-14T08:00:00.000Z');
const PASSWORD = 'correct horse battery';

const hasher: PasswordHasher = {
  hash: async (password) => `hashed(${password})`,
  verify: async (password, hash) => hash === `hashed(${password})`,
};

function setup() {
  let clock = AT;
  let ids = 0;
  let tokens = 0;
  const users = new InMemoryUserRepository();
  const invitations = new InMemoryInvitationRepository();
  const sessions = new InMemorySessionRepository();
  const roleChanges = new InMemoryRoleChangeRepository();
  const secrets = { generate: () => `token-${++tokens}`, digest: (t: string) => `digest(${t})` };
  const newId = () => `id-${++ids}`;
  const now = () => clock;
  // No e-mail configured: the link comes back to the administrator (REQ-436).
  const mailer = new InMemoryAccessMailer({ delivers: false });

  return {
    users,
    roleChanges,
    setClock: (date: Date) => {
      clock = date;
    },
    createUser: new CreateUser({ users, hasher, newId, now }),
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
    resolveSession: new ResolveSession({ users, sessions, secrets, now }),
    inviteUser: new InviteUser({ users, invitations, secrets, mailer, newId, now }),
    resendInvitation: new ResendInvitation({ users, invitations, secrets, mailer, newId, now }),
    listUsers: new ListUsers({ users, invitations }),
    deactivateUser: new DeactivateUser({ users, sessions, now }),
    changeUserRole: new ChangeUserRole({ users, roleChanges, newId, now }),
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

function aUser(s: Setup, email: string, role: Role, name: string | null = null): Promise<UserView> {
  return s.createUser.execute({ email, password: PASSWORD, role, name });
}

describe('managing users is for administrators only (REQ-401, REQ-430)', () => {
  let s: Setup;
  let user: UserView;
  let admin: UserView;
  beforeEach(async () => {
    s = setup();
    admin = await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR');
    user = await aUser(s, 'user@usina.com.br', 'USER');
  });

  it('refuses every management act to a user of role USER', async () => {
    for (const work of [
      s.inviteUser.execute({ actor: user, email: 'x@usina.com.br', role: 'USER' }),
      s.listUsers.execute({ actor: user }),
      s.deactivateUser.execute({ actor: user, userId: admin.id }),
      s.changeUserRole.execute({ actor: user, userId: user.id, role: 'ADMINISTRATOR' }),
      s.resendInvitation.execute({ actor: user, invitationId: 'any' }),
    ]) {
      await expectRefusal(work, IDENTITY_MESSAGES.ADMINISTRATOR_ONLY, 'REQ-401');
    }
  });
});

describe('InviteUser and ResendInvitation (REQ-420, REQ-421)', () => {
  let s: Setup;
  let admin: UserView;
  beforeEach(async () => {
    s = setup();
    admin = await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR');
  });

  it('invites with the role, signed by the administrator, valid for 72 hours', async () => {
    const issued = await s.inviteUser.execute({
      actor: admin,
      email: 'Bruno@Usina.com.br',
      role: 'USER',
    });

    expect(issued).toMatchObject({
      email: 'bruno@usina.com.br',
      expiresAt: '2026-10-17T08:00:00.000Z',
    });
    const created = await s.acceptInvitation.execute({
      token: issued.token as string,
      password: PASSWORD,
    });
    expect(created.role).toBe('USER');
  });

  it('refuses the e-mail of an active user (EX-406)', async () => {
    await expectRefusal(
      s.inviteUser.execute({ actor: admin, email: 'admin@usina.com.br', role: 'USER' }),
      IDENTITY_MESSAGES.EMAIL_ALREADY_ACTIVE,
    );
  });

  it('resends a pending invitation with a new link and kills the previous one (FA-401)', async () => {
    const first = await s.inviteUser.execute({
      actor: admin,
      email: 'bruno@usina.com.br',
      role: 'USER',
    });
    const [pending] = (await s.listUsers.execute({ actor: admin })).invitations;

    s.setClock(new Date('2026-10-20T08:00:00.000Z'));
    const resent = await s.resendInvitation.execute({
      actor: admin,
      invitationId: pending?.id as string,
    });

    expect(resent.expiresAt).toBe('2026-10-23T08:00:00.000Z');
    await expectRefusal(
      s.acceptInvitation.execute({ token: first.token as string, password: PASSWORD }),
      IDENTITY_MESSAGES.INVALID_LINK,
    );
    await expect(
      s.acceptInvitation.execute({ token: resent.token as string, password: PASSWORD }),
    ).resolves.toMatchObject({ email: 'bruno@usina.com.br', role: 'USER' });
  });

  it('does not resend an invitation that is no longer pending', async () => {
    const issued = await s.inviteUser.execute({
      actor: admin,
      email: 'bruno@usina.com.br',
      role: 'USER',
    });
    const [pending] = (await s.listUsers.execute({ actor: admin })).invitations;
    await s.acceptInvitation.execute({ token: issued.token as string, password: PASSWORD });

    await expectRefusal(
      s.resendInvitation.execute({ actor: admin, invitationId: pending?.id as string }),
      IDENTITY_MESSAGES.INVITATION_NOT_PENDING,
    );
  });
});

describe('ListUsers (REQ-440)', () => {
  it('lists every user with name, e-mail, role and situation, and the pending invitations', async () => {
    const s = setup();
    const admin = await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR', 'Ana Admin');
    const user = await aUser(s, 'user@usina.com.br', 'USER');
    await s.deactivateUser.execute({ actor: admin, userId: user.id });
    await s.inviteUser.execute({ actor: admin, email: 'novo@usina.com.br', role: 'USER' });

    const listing = await s.listUsers.execute({ actor: admin });

    expect(listing.users).toEqual([
      {
        id: admin.id,
        email: 'admin@usina.com.br',
        name: 'Ana Admin',
        role: 'ADMINISTRATOR',
        status: 'ACTIVE',
        displayName: 'Ana Admin',
      },
      {
        id: user.id,
        email: 'user@usina.com.br',
        name: null,
        role: 'USER',
        status: 'DEACTIVATED',
        displayName: 'user@usina.com.br',
      },
    ]);
    expect(listing.invitations).toEqual([
      {
        id: expect.any(String),
        email: 'novo@usina.com.br',
        role: 'USER',
        expiresAt: '2026-10-17T08:00:00.000Z',
      },
    ]);
  });
});

describe('DeactivateUser (REQ-403, REQ-406)', () => {
  let s: Setup;
  let admin: UserView;
  beforeEach(async () => {
    s = setup();
    admin = await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR');
  });

  it('deactivates and ends the sessions of the user at once (CA-413)', async () => {
    const user = await aUser(s, 'user@usina.com.br', 'USER');
    const { token } = await s.logIn.execute({ email: 'user@usina.com.br', password: PASSWORD });

    const deactivated = await s.deactivateUser.execute({ actor: admin, userId: user.id });

    expect(deactivated.status).toBe('DEACTIVATED');
    await expect(s.resolveSession.execute({ token })).resolves.toBeNull();
    await expectRefusal(
      s.logIn.execute({ email: 'user@usina.com.br', password: PASSWORD }),
      IDENTITY_MESSAGES.LOGIN_REFUSED,
    );
  });

  it('refuses to deactivate the last active administrator (REQ-406)', async () => {
    await expectRefusal(
      s.deactivateUser.execute({ actor: admin, userId: admin.id }),
      IDENTITY_MESSAGES.LAST_ADMINISTRATOR,
      'REQ-406',
    );
  });

  it('deactivates an administrator when another one remains', async () => {
    const other = await aUser(s, 'other@usina.com.br', 'ADMINISTRATOR');

    await expect(
      s.deactivateUser.execute({ actor: admin, userId: other.id }),
    ).resolves.toMatchObject({ status: 'DEACTIVATED' });
  });

  it('answers 404 for a user that does not exist', async () => {
    await expect(
      s.deactivateUser.execute({ actor: admin, userId: 'nobody' }),
    ).rejects.toMatchObject({
      messageKey: IDENTITY_MESSAGES.USER_NOT_FOUND,
    });
  });
});

describe('ChangeUserRole (REQ-404, REQ-406)', () => {
  let s: Setup;
  let admin: UserView;
  beforeEach(async () => {
    s = setup();
    admin = await aUser(s, 'admin@usina.com.br', 'ADMINISTRATOR');
  });

  it('changes the role, recording who, when, before and after (CA-414)', async () => {
    const user = await aUser(s, 'user@usina.com.br', 'USER');
    s.setClock(new Date('2026-10-15T09:00:00.000Z'));

    const changed = await s.changeUserRole.execute({
      actor: admin,
      userId: user.id,
      role: 'ADMINISTRATOR',
    });

    expect(changed.role).toBe('ADMINISTRATOR');
    expect(await s.roleChanges.listByUser(user.id)).toEqual([
      expect.objectContaining({
        userId: user.id,
        previousRole: 'USER',
        newRole: 'ADMINISTRATOR',
        changedBy: admin.id,
        changedAt: new Date('2026-10-15T09:00:00.000Z'),
      }),
    ]);
  });

  it('is in force at the next operation, with no new login (REQ-404)', async () => {
    const user = await aUser(s, 'user@usina.com.br', 'USER');
    const { token } = await s.logIn.execute({ email: 'user@usina.com.br', password: PASSWORD });

    await s.changeUserRole.execute({ actor: admin, userId: user.id, role: 'ADMINISTRATOR' });

    await expect(s.resolveSession.execute({ token })).resolves.toMatchObject({
      role: 'ADMINISTRATOR',
    });
  });

  it('refuses to demote the last active administrator (REQ-406)', async () => {
    await expectRefusal(
      s.changeUserRole.execute({ actor: admin, userId: admin.id, role: 'USER' }),
      IDENTITY_MESSAGES.LAST_ADMINISTRATOR,
      'REQ-406',
    );
  });

  it('records nothing when the role does not change', async () => {
    const user = await aUser(s, 'user@usina.com.br', 'USER');

    await s.changeUserRole.execute({ actor: admin, userId: user.id, role: 'USER' });

    expect(await s.roleChanges.listByUser(user.id)).toEqual([]);
  });
});
