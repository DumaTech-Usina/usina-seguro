import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { type SignedIn, logInAs, signIn } from './support/sign-in.ts';

/**
 * The roles over HTTP and the administrator's management of users (V2
 * section 9C: REQ-401, REQ-403, REQ-404, REQ-406, REQ-420, REQ-421, REQ-430,
 * REQ-436, REQ-440). The test user of `signIn` is an administrator; a Usuário
 * is created alongside and sends its own cookie.
 */
const PASSWORD = 'correct horse battery';

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
let admin: SignedIn;
let userCookie: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-users-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    PERSISTENCE_DRIVER: 'sqlite',
    SQLITE_FILE: path.join(directory, 'usina.sqlite'),
    APP_BASE_URL: 'https://usina.example',
  });

  application = composeApplication(config);
  app = createHttpServer(application.useCases, {
    logger: false,
    publicUrl: config.http.publicUrl,
  });
  await app.listen({ port: config.http.port, host: config.http.host });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not expose a TCP address.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  admin = await signIn(application.useCases, baseUrl);
  ({ cookie: userCookie } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
    email: 'usuario@usina.com.br',
    role: 'USER',
  }));
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function as(cookie: string, method: string, url: string, body?: unknown): Promise<Response> {
  return admin.anonymousFetch(`${baseUrl}${url}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const asAdmin = (method: string, url: string, body?: unknown) =>
  as(admin.cookie, method, url, body);

async function json<T>(response: Promise<Response>, status: number): Promise<T> {
  const answered = await response;
  const body = await answered.text();
  expect(answered.status, body).toBe(status);
  return (body === '' ? null : JSON.parse(body)) as T;
}

function tokenOf(link: string): string {
  return new URL(link).searchParams.get('token') as string;
}

describe('a Usuário (REQ-401, REQ-430, REQ-431)', () => {
  it('runs the business operations and reads the user directory', async () => {
    expect((await as(userCookie, 'GET', '/proposals')).status).toBe(200);
    expect((await as(userCookie, 'GET', '/users/directory')).status).toBe(200);
  });

  it('is refused every management operation with 403 and a message (EX-402, CA-411)', async () => {
    for (const [method, url, body] of [
      ['GET', '/users', undefined],
      ['POST', '/users/invitations', { email: 'x@usina.com.br', role: 'USER' }],
      ['POST', '/users/invitations/any/resend', undefined],
      ['POST', `/users/${admin.user.id}/deactivation`, undefined],
      ['POST', `/users/${admin.user.id}/role`, { role: 'USER' }],
    ] as const) {
      const response = await as(userCookie, method, url, body);

      expect(response.status, url).toBe(403);
      expect(await response.json(), url).toEqual({
        error: 'forbidden',
        messageKey: 'identity.administrator_only',
        message: 'Somente um administrador pode fazer isto.',
      });
    }
  });
});

describe('the administrator (REQ-440)', () => {
  it('invites, and gets the link to hand over while no e-mail is configured (REQ-436)', async () => {
    const invited = await json<{ email: string; expiresAt: string; link: string }>(
      asAdmin('POST', '/users/invitations', { email: 'Bruno@Usina.com.br', role: 'USER' }),
      201,
    );

    expect(invited.email).toBe('bruno@usina.com.br');
    expect(invited.link).toMatch(/^https:\/\/usina\.example\/app\/invitation\/\?token=[\w-]{43}$/);
    const user = await application.useCases.acceptInvitation.execute({
      token: tokenOf(invited.link),
      password: PASSWORD,
    });
    expect(user.role).toBe('USER');
  });

  it('lists users with their situation and the pending invitations', async () => {
    await json(
      asAdmin('POST', '/users/invitations', { email: 'carla@usina.com.br', role: 'ADMINISTRATOR' }),
      201,
    );

    const listing = await json<{
      users: { email: string; role: string; status: string; displayName: string }[];
      invitations: { id: string; email: string; role: string; expiresAt: string }[];
    }>(asAdmin('GET', '/users'), 200);

    expect(listing.users).toContainEqual(
      expect.objectContaining({ email: 'usuario@usina.com.br', role: 'USER', status: 'ACTIVE' }),
    );
    expect(listing.invitations).toContainEqual(
      expect.objectContaining({ email: 'carla@usina.com.br', role: 'ADMINISTRATOR' }),
    );
    expect(JSON.stringify(listing)).not.toMatch(/password|token|digest/i);
  });

  it('resends an invitation: the new link works and the old one does not (FA-401)', async () => {
    const first = await json<{ link: string }>(
      asAdmin('POST', '/users/invitations', { email: 'dora@usina.com.br', role: 'USER' }),
      201,
    );
    const { invitations } = await json<{ invitations: { id: string; email: string }[] }>(
      asAdmin('GET', '/users'),
      200,
    );
    const pending = invitations.find((invitation) => invitation.email === 'dora@usina.com.br');

    const resent = await json<{ link: string }>(
      asAdmin('POST', `/users/invitations/${pending?.id}/resend`),
      201,
    );

    await expect(
      application.useCases.acceptInvitation.execute({
        token: tokenOf(first.link),
        password: PASSWORD,
      }),
    ).rejects.toThrow();
    await expect(
      application.useCases.acceptInvitation.execute({
        token: tokenOf(resent.link),
        password: PASSWORD,
      }),
    ).resolves.toMatchObject({ email: 'dora@usina.com.br' });
  });

  it('deactivates a user, whose session stops at once (CA-413)', async () => {
    const { user, cookie } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'saindo@usina.com.br',
      role: 'USER',
    });
    expect((await as(cookie, 'GET', '/proposals')).status).toBe(200);

    await json(asAdmin('POST', `/users/${user.id}/deactivation`), 200);

    expect((await as(cookie, 'GET', '/proposals')).status).toBe(401);
  });

  it('changes a role, in force at the next request of that user (CA-414)', async () => {
    const { user, cookie } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'promovido@usina.com.br',
      role: 'USER',
    });
    expect((await as(cookie, 'GET', '/users')).status).toBe(403);

    const changed = await json<{ role: string }>(
      asAdmin('POST', `/users/${user.id}/role`, { role: 'ADMINISTRATOR' }),
      200,
    );

    expect(changed.role).toBe('ADMINISTRATOR');
    expect((await as(cookie, 'GET', '/users')).status).toBe(200);
  });

  it('never leaves the system without an active administrator (REQ-406)', async () => {
    const lonely = await mkdtempAdminOnly();

    const response = await lonely.call('POST', `/users/${lonely.adminId}/deactivation`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-406' });
    await lonely.close();
  });

  it('answers 400 to an unknown role and 404 to an unknown user', async () => {
    expect(
      (await asAdmin('POST', '/users/invitations', { email: 'e@usina.com.br', role: 'ROOT' }))
        .status,
    ).toBe(400);
    expect((await asAdmin('POST', '/users/nobody/deactivation')).status).toBe(404);
  });
});

/** A server of its own whose only administrator is the one logged in. */
async function mkdtempAdminOnly() {
  const own = mkdtempSync(path.join(tmpdir(), 'usina-e2e-lonely-'));
  const ownApplication = composeApplication(
    loadConfig({
      NODE_ENV: 'test',
      PERSISTENCE_DRIVER: 'sqlite',
      SQLITE_FILE: path.join(own, 'u.sqlite'),
    }),
  );
  const server = createHttpServer(ownApplication.useCases);
  const adminUser = await ownApplication.useCases.createUser.execute({
    email: 'sozinho@usina.com.br',
    password: PASSWORD,
    role: 'ADMINISTRATOR',
    name: null,
  });
  const login = await server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'sozinho@usina.com.br', password: PASSWORD },
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0] as string;

  return {
    adminId: adminUser.id,
    call: async (method: 'POST', url: string) => {
      const answered = await server.inject({ method, url, headers: { cookie } });
      return { status: answered.statusCode, json: async () => answered.json() };
    },
    close: async () => {
      await server.close();
      await ownApplication.shutdown();
      rmSync(own, { recursive: true, force: true });
    },
  };
}
