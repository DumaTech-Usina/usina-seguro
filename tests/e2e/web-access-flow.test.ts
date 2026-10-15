// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { TEST_USER, signIn } from './support/sign-in.ts';

/**
 * Access to the system driven through the pages (V2 section 9C, CA-417): the
 * login, the acceptance of an invitation, the way a page without a session
 * sends the operator to the login, and the user and "Sair" in the app bar.
 *
 * The server is the real one. The one thing replaced is `navigateTo`, the
 * single place a page changes `window.location`: jsdom does not navigate, so
 * the test records where the page asked to go instead.
 */
const WEB_PUBLIC = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');
const PASSWORD = 'correct horse battery';

/** See the note in `web-fp01-flow.test.ts`: the DOM is outside the type program. */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type Untyped = any;

const { document, window, DOMParser } = globalThis as Untyped;

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
let cookie: string;
let anonymousFetch: typeof globalThis.fetch;
let signedInFetch: typeof globalThis.fetch;

const requests: string[] = [];
const navigateTo = vi.fn();

function recording(fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
  return ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return fetcher(url, init);
  }) as typeof globalThis.fetch;
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-web-access-'));
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

  ({ cookie, anonymousFetch } = await signIn(application.useCases, baseUrl));
  signedInFetch = globalThis.fetch;
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  vi.doMock('/app/shared/navigation.js', () => ({ navigateTo }));
  navigateTo.mockClear();
  requests.length = 0;
});

/** The browser of someone with no session. */
function asVisitor(): void {
  globalThis.fetch = recording(anonymousFetch);
}

/** The browser of the test user, logged in. */
function asTestUser(): void {
  globalThis.fetch = recording(signedInFetch);
}

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
    const input = document.querySelector(`${form} [name="${name}"]`);
    if (input === null) {
      throw new Error(`No field ${name} in ${form}.`);
    }
    input.value = value;
  }
}

function submit(form: string): void {
  document.querySelector(form)?.dispatchEvent(new window.Event('submit', { cancelable: true }));
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? '';
}

async function invitationToken(email: string): Promise<string> {
  const { token } = await application.useCases.issueFirstAdministratorInvitation.execute({
    email,
  });
  return token;
}

describe('the login page (REQ-411, REQ-413)', () => {
  it('shows the server refusal and stays on the page (CA-404)', async () => {
    asVisitor();
    openPage('login/index.html');
    await import('/app/login/index.js');

    fill('#form-login', { email: TEST_USER.email, password: 'wrong password!' });
    submit('#form-login');

    await vi.waitFor(() => {
      expect(text('#access-error')).toBe(
        'Não foi possível entrar. Confira o e-mail e a senha ou tente novamente mais tarde.',
      );
    });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('logs in and goes back to the page the operator was on', async () => {
    asVisitor();
    openPage('login/index.html', '?next=%2Fapp%2Fpolicies%2F');
    await import('/app/login/index.js');

    fill('#form-login', { email: TEST_USER.email, password: TEST_USER.password });
    submit('#form-login');

    await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/app/policies/'));
    expect(requests).toContain('POST /auth/login');
  });

  it('goes to the home page when the return address is not one of the pages', async () => {
    for (const next of ['https%3A%2F%2Fevil.example%2F', '%2F%2Fevil.example', '%2Fpolicies']) {
      vi.resetModules();
      vi.doMock('/app/shared/navigation.js', () => ({ navigateTo }));
      navigateTo.mockClear();
      asVisitor();
      openPage('login/index.html', `?next=${next}`);
      await import('/app/login/index.js');

      fill('#form-login', { email: TEST_USER.email, password: TEST_USER.password });
      submit('#form-login');

      await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/app/'));
    }
  });
});

describe('the invitation page (REQ-422)', () => {
  it('creates the access with the name and password, then points to the login (CA-407)', async () => {
    const token = await invitationToken('bruno@usina.com.br');
    asVisitor();
    openPage('invitation/index.html', `?token=${token}`);
    await import('/app/invitation/index.js');

    fill('#form-invitation', { name: 'Bruno Alves', password: PASSWORD });
    submit('#form-invitation');

    // The notice is in the markup from the start, hidden: what counts is that it shows.
    await vi.waitFor(() => {
      expect(document.querySelector('#access-done')?.hidden).toBe(false);
    });
    expect(text('#access-done')).toContain('Cadastro concluído');
    expect(document.querySelector('#access-done a')?.getAttribute('href')).toBe('/app/login/');
    expect(document.querySelector('#form-invitation')?.hidden).toBe(true);
    expect(requests).toContain('POST /auth/invitation/acceptance');

    const session = await application.useCases.logIn.execute({
      email: 'bruno@usina.com.br',
      password: PASSWORD,
    });
    expect(session.user.displayName).toBe('Bruno Alves');
  });

  it('shows the server refusal for a link already used (EX-403)', async () => {
    const token = await invitationToken('carla@usina.com.br');
    await application.useCases.acceptInvitation.execute({ token, password: PASSWORD });
    asVisitor();
    openPage('invitation/index.html', `?token=${token}`);
    await import('/app/invitation/index.js');

    fill('#form-invitation', { password: PASSWORD });
    submit('#form-invitation');

    await vi.waitFor(() => {
      expect(text('#access-error')).toBe('Este link não é válido ou já expirou.');
    });
  });

  it('says the link is not valid when it carries no token', async () => {
    asVisitor();
    openPage('invitation/index.html');
    await import('/app/invitation/index.js');

    expect(text('#access-error')).toBe('Este link não é válido ou já expirou.');
    expect(document.querySelector('#form-invitation')?.hidden).toBe(true);
  });
});

describe('a page opened with no session (REQ-431, FA-403)', () => {
  it('sends the operator to the login, keeping the way back', async () => {
    asVisitor();
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');

    await vi.waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith('/app/login/?next=%2Fapp%2Fproposals%2F'),
    );
  });
});

describe('the app bar of a logged-in operator (REQ-400, REQ-411)', () => {
  it('shows who is logged in, by the name', async () => {
    asTestUser();
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');

    await vi.waitFor(() => expect(text('.app-bar__user')).toBe(TEST_USER.name));
  });

  it('"Sair" ends the session on the server and goes to the login', async () => {
    // A session of its own, so ending it does not log the other tests out.
    const own = await (
      await anonymousFetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
      })
    ).headers.get('set-cookie');
    const ownCookie = (own ?? '').split(';')[0] as string;
    globalThis.fetch = recording(((input: Untyped, init: Untyped) =>
      anonymousFetch(input, {
        ...init,
        headers: { ...(init?.headers ?? {}), cookie: ownCookie },
      })) as typeof globalThis.fetch);

    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => expect(text('.app-bar__user')).toBe(TEST_USER.name));

    document.querySelector('.app-bar__logout')?.click();

    await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/app/login/'));
    expect(requests).toContain('POST /auth/logout');
    const me = await anonymousFetch(`${baseUrl}/auth/me`, { headers: { cookie: ownCookie } });
    expect(me.status).toBe(401);
    // The shared session of the other tests is untouched.
    const shared = await anonymousFetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    expect(shared.status).toBe(200);
  });
});
