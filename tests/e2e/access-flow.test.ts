import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * Access to the system over HTTP (V2 section 9C): what the server answers with
 * and without a session, the cookie it hands out, the logout, the invitation
 * accepted through the API, the refusal of a request from another site and
 * what never reaches the log.
 *
 * Real server, real SQLite on disk, plain `fetch` with no cookie jar: every
 * cookie sent here is one the test chose to send.
 */
const PASSWORD = 'correct horse battery';

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-access-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    PERSISTENCE_DRIVER: 'sqlite',
    SQLITE_FILE: path.join(directory, 'usina.sqlite'),
  });

  application = composeApplication(config);
  app = createHttpServer(application.useCases);
  await app.listen({ port: config.http.port, host: config.http.host });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not expose a TCP address.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

let emails = 0;

/** A fresh invitation link token for an administrator. */
async function invitationToken(): Promise<{ email: string; token: string }> {
  const email = `user-${++emails}@usina.com.br`;
  const { token } = await application.useCases.issueFirstAdministratorInvitation.execute({
    email,
  });
  return { email, token };
}

async function aUser(): Promise<string> {
  const { email, token } = await invitationToken();
  await application.useCases.acceptInvitation.execute({ token, password: PASSWORD });
  return email;
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function logIn(email: string): Promise<{ response: Response; cookie: string }> {
  const response = await post('/auth/login', { email, password: PASSWORD });
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
  return { response, cookie };
}

describe('without a session (REQ-410, REQ-431)', () => {
  it('refuses every operation with 401 and a message (CA-401, EX-401)', async () => {
    for (const [method, url] of [
      ['GET', '/proposals'],
      ['GET', '/policies'],
      ['GET', '/policies/does-not-exist'],
      ['GET', '/payouts/eligible'],
      ['GET', '/references'],
      ['GET', '/notifications'],
      ['GET', '/auth/me'],
    ] as const) {
      const response = await fetch(`${baseUrl}${url}`, { method });

      expect(response.status, url).toBe(401);
      expect(await response.json(), url).toEqual({
        error: 'unauthenticated',
        messageKey: 'identity.authentication_required',
        message: 'Entre no sistema para continuar.',
      });
    }
  });

  it('refuses a write before reading its body', async () => {
    const response = await post('/proposals', { anything: true });

    expect(response.status).toBe(401);
  });

  it('keeps open only the exceptions of REQ-410: health and the pages', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/app/`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/app/login/`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/app/invitation/`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/`, { redirect: 'manual' })).status).toBe(302);
  });
});

describe('invitation accepted over HTTP (REQ-422)', () => {
  it('creates the user with the name informed, and refuses the same link again', async () => {
    const { email, token } = await invitationToken();

    const accepted = await post('/auth/invitation/acceptance', {
      token,
      password: PASSWORD,
      name: 'Ana Lima',
    });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual({
      id: expect.any(String),
      email,
      name: 'Ana Lima',
      role: 'ADMINISTRATOR',
      displayName: 'Ana Lima',
    });

    const again = await post('/auth/invitation/acceptance', { token, password: PASSWORD });
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({
      rule: 'REQ-422',
      message: 'Este link não é válido ou já expirou.',
    });
  });

  it('refuses a short password with the policy in the message (REQ-415)', async () => {
    const { token } = await invitationToken();

    const response = await post('/auth/invitation/acceptance', { token, password: 'short' });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toBe(
      'A senha deve ter de 12 a 128 caracteres.',
    );
  });

  it('accepts no name', async () => {
    const { email, token } = await invitationToken();

    const response = await post('/auth/invitation/acceptance', { token, password: PASSWORD });

    expect(await response.json()).toMatchObject({ name: null, displayName: email });
  });
});

describe('login and logout (REQ-411 to REQ-413)', () => {
  it('opens a session in an HttpOnly, SameSite=Strict cookie (CA-402)', async () => {
    const email = await aUser();

    const { response, cookie } = await logIn(email);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email, role: 'ADMINISTRATOR' } });

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^usina_session=[\w-]{43}$/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Expires=/);
    // Outside production the service runs on plain http (REQ-412 cookie flags).
    expect(setCookie).not.toContain('Secure');
  });

  it('answers who is logged in, and opens the operations', async () => {
    const email = await aUser();
    const { cookie } = await logIn(email);

    const me = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email, displayName: email });

    expect((await fetch(`${baseUrl}/proposals`, { headers: { cookie } })).status).toBe(200);
  });

  it('refuses a wrong password and an unknown e-mail with the same answer, and no cookie (CA-404)', async () => {
    const email = await aUser();

    const wrong = await post('/auth/login', { email, password: 'wrong password!' });
    const unknown = await post('/auth/login', { email: 'nobody@usina.com.br', password: PASSWORD });

    expect(wrong.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('ends the session on the server at the logout (CA-402)', async () => {
    const email = await aUser();
    const { cookie } = await logIn(email);

    const out = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie } });

    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/^usina_session=;/);
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('answers a logout with no session the same way', async () => {
    const out = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });

    expect(out.status).toBe(204);
  });

  it('marks the cookie Secure when the server is told to (production)', async () => {
    const secure = createHttpServer(application.useCases, { logger: false, secureCookies: true });
    const email = await aUser();

    const response = await secure.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD },
    });

    expect(response.headers['set-cookie']).toContain('Secure');
    await secure.close();
  });
});

describe('requests from another site (REQ-417)', () => {
  it('refuses a write whose Origin is another site, even with a session (EX-405)', async () => {
    const { cookie } = await logIn(await aUser());

    const response = await post(
      '/references',
      { kind: 'INSURER', id: 'i-1', name: 'Seguradora' },
      { cookie, origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden_origin',
      messageKey: 'identity.foreign_origin',
      message: 'Operação recusada: a requisição não veio do próprio sistema.',
    });
  });

  it('refuses a login posted from another site', async () => {
    const email = await aUser();

    const response = await post(
      '/auth/login',
      { email, password: PASSWORD },
      { origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
  });

  it('accepts a write whose Origin is the system itself', async () => {
    const { cookie } = await logIn(await aUser());

    const response = await post(
      '/references',
      { kind: 'INSURER', id: 'i-1', name: 'Seguradora' },
      { cookie, origin: baseUrl },
    );

    expect(response.status).toBe(201);
  });
});

describe('the log (REQ-416)', () => {
  it('records neither the link token nor the password', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logged = createHttpServer(application.useCases, { logger: true, logStream: stream });

    await logged.inject({ method: 'GET', url: '/app/invitation/?token=SECRET-TOKEN' });
    await logged.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@usina.com.br', password: 'SECRET-PASSWORD' },
    });
    await logged.close();

    const log = lines.join('');
    expect(log).toContain('/app/invitation/');
    expect(log).not.toContain('SECRET-TOKEN');
    expect(log).not.toContain('SECRET-PASSWORD');
  });
});
