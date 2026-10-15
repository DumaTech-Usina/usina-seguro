import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { type SignedIn, TEST_USER, signIn } from './support/sign-in.ts';

/**
 * The password reset over HTTP (REQ-425, REQ-426) and the invitation once
 * e-mail is configured (REQ-435, REQ-436). E-mail goes to the in-memory outbox
 * (`EMAIL_DRIVER=memory`): nothing is sent, everything is read back here.
 */
const NEW_PASSWORD = 'uma senha nova e longa';

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
let signedIn: SignedIn;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-reset-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    PERSISTENCE_DRIVER: 'sqlite',
    SQLITE_FILE: path.join(directory, 'usina.sqlite'),
    EMAIL_DRIVER: 'memory',
  });

  application = composeApplication(config);
  app = createHttpServer(application.useCases);
  await app.listen({ port: config.http.port, host: config.http.host });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not expose a TCP address.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  signedIn = await signIn(application.useCases, baseUrl);
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function anonymous(method: string, url: string, body?: unknown): Promise<Response> {
  return signedIn.anonymousFetch(`${baseUrl}${url}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function outbox() {
  return application.outbox ?? [];
}

describe('the password reset over HTTP (REQ-425, REQ-426)', () => {
  it('answers the same to a known and an unknown e-mail; only the known one gets mail (CA-410)', async () => {
    const before = outbox().length;

    const known = await anonymous('POST', '/auth/password-reset/request', {
      email: TEST_USER.email,
    });
    const unknown = await anonymous('POST', '/auth/password-reset/request', {
      email: 'nobody@usina.com.br',
    });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const body = await known.json();
    expect(body).toEqual(await unknown.json());
    expect(body).toEqual({
      message:
        'Se houver um usuário ativo com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.',
    });
    expect(outbox().slice(before)).toEqual([
      expect.objectContaining({ kind: 'PASSWORD_RESET', to: TEST_USER.email }),
    ]);
  });

  it('sets the new password through the link, once; the old sessions end (CA-409)', async () => {
    const { cookie: oldSession } = await (async () => {
      const response = await anonymous('POST', '/auth/login', {
        email: TEST_USER.email,
        password: TEST_USER.password,
      });
      return { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] as string };
    })();
    await anonymous('POST', '/auth/password-reset/request', { email: TEST_USER.email });
    const token = outbox().at(-1)?.token as string;

    const reset = await anonymous('POST', '/auth/password-reset', {
      token,
      password: NEW_PASSWORD,
    });

    expect(reset.status).toBe(204);
    const again = await anonymous('POST', '/auth/password-reset', {
      token,
      password: NEW_PASSWORD,
    });
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({ message: 'Este link não é válido ou já expirou.' });
    const me = await signedIn.anonymousFetch(`${baseUrl}/auth/me`, {
      headers: { cookie: oldSession },
    });
    expect(me.status).toBe(401);
    expect(
      (await anonymous('POST', '/auth/login', { email: TEST_USER.email, password: NEW_PASSWORD }))
        .status,
    ).toBe(200);
  });
});

describe('the invitation once e-mail is configured (REQ-435, REQ-436)', () => {
  it('goes by e-mail, and no link comes back to the administrator', async () => {
    const login = await anonymous('POST', '/auth/login', {
      email: TEST_USER.email,
      password: NEW_PASSWORD,
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const before = outbox().length;

    const response = await signedIn.anonymousFetch(`${baseUrl}/users/invitations`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'convidado@usina.com.br', role: 'USER' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ email: 'convidado@usina.com.br', link: null });
    expect(outbox().slice(before)).toEqual([
      expect.objectContaining({ kind: 'INVITATION', to: 'convidado@usina.com.br' }),
    ]);
  });
});
