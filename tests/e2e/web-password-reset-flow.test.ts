// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { type SignedIn, TEST_USER, signIn } from './support/sign-in.ts';

/**
 * "Esqueci a senha" driven through the pages (REQ-425, REQ-426, CA-417): the
 * link on the login page, the request that answers the same for every e-mail,
 * and the new password set through the link of the e-mail.
 */
const WEB_PUBLIC = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');
const NEW_PASSWORD = 'uma senha nova e longa';

// biome-ignore lint/suspicious/noExplicitAny: see `web-fp01-flow.test.ts`.
type Untyped = any;
const { document, window, DOMParser } = globalThis as Untyped;

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
let signedIn: SignedIn;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-web-reset-'));
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

beforeEach(() => {
  vi.resetModules();
  // A visitor with no session.
  globalThis.fetch = ((input: Untyped, init: Untyped) =>
    signedIn.anonymousFetch(new URL(String(input), baseUrl), init)) as typeof globalThis.fetch;
});

function openPage(relativePath: string, search = ''): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath.replace(/index\.html$/, '')}${search}`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

function fill(form: string, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    document.querySelector(`${form} [name="${name}"]`).value = value;
  }
}

function submit(form: string): void {
  document.querySelector(form).dispatchEvent(new window.Event('submit', { cancelable: true }));
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? '';
}

describe('"Esqueci a senha" (REQ-425, REQ-426)', () => {
  it('is reached from the login page', () => {
    openPage('login/index.html');

    const link = document.querySelector('a[href="/app/password-reset/"]');
    expect(link?.textContent).toContain('Esqueci a senha');
  });

  it('asks for the e-mail and shows the one answer of the server (CA-410)', async () => {
    openPage('password-reset/index.html');
    await import('/app/password-reset/index.js');
    expect(document.querySelector('#form-new-password').hidden).toBe(true);

    fill('#form-request', { email: 'nobody@usina.com.br' });
    submit('#form-request');

    await vi.waitFor(() => {
      expect(text('#access-done')).toContain('Se houver um usuário ativo com este e-mail');
    });
    expect(document.querySelector('#access-done').hidden).toBe(false);
  });

  it('sets the new password through the link of the e-mail, then points to the login', async () => {
    await application.useCases.requestPasswordReset.execute({ email: TEST_USER.email });
    const token = application.outbox?.at(-1)?.token as string;
    openPage('password-reset/index.html', `?token=${token}`);
    await import('/app/password-reset/index.js');
    expect(document.querySelector('#form-request').hidden).toBe(true);

    fill('#form-new-password', { password: NEW_PASSWORD });
    submit('#form-new-password');

    await vi.waitFor(() => {
      expect(document.querySelector('#access-done').hidden).toBe(false);
    });
    expect(text('#access-done')).toContain('Senha redefinida');
    expect(document.querySelector('#access-done a')?.getAttribute('href')).toBe('/app/login/');
    await expect(
      application.useCases.logIn.execute({ email: TEST_USER.email, password: NEW_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('shows the server refusal for a link already used (EX-403)', async () => {
    openPage('password-reset/index.html', '?token=made-up');
    await import('/app/password-reset/index.js');

    fill('#form-new-password', { password: NEW_PASSWORD });
    submit('#form-new-password');

    await vi.waitFor(() => {
      expect(text('#access-error')).toBe('Este link não é válido ou já expirou.');
    });
  });
});
