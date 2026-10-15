// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { type SignedIn, TEST_USER, logInAs, signIn } from './support/sign-in.ts';

/**
 * The users page of the administrator, driven through the page (REQ-440):
 * the list with name, e-mail, role and situation, the pending invitations,
 * inviting with the link on screen while there is no e-mail (REQ-436),
 * resending, deactivating and changing a role. And what a Usuário sees: no
 * "Usuários" in the menu, and a refusal from the server if the page is opened.
 */
const WEB_PUBLIC = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');

/** See the note in `web-fp01-flow.test.ts`: the DOM is outside the type program. */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type Untyped = any;

const { document, window, DOMParser } = globalThis as Untyped;

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
let admin: SignedIn;
let adminFetch: typeof globalThis.fetch;

const requests: string[] = [];

function recording(fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
  return ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return fetcher(url, init);
  }) as typeof globalThis.fetch;
}

/** jsdom has `<dialog>` without its behaviour; see `web-payout-flow.test.ts`. */
function installDialogSupport(): void {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = function showModal(this: Untyped) {
    this.open = true;
  };
  proto.close = function close(this: Untyped, value?: string) {
    if (value !== undefined) {
      this.returnValue = value;
    }
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  document.addEventListener('click', (event: Untyped) => {
    const button = event.target?.closest?.('button[value]');
    const dialog = button?.closest('dialog');
    if (button !== null && dialog != null && button.form?.getAttribute('method') === 'dialog') {
      event.preventDefault();
      dialog.close(button.value);
    }
  });
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-web-users-'));
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
  adminFetch = globalThis.fetch;
  window.scrollTo = () => {};
  installDialogSupport();
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  requests.length = 0;
  globalThis.fetch = recording(adminFetch);
});

function openPage(relativePath: string): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath.replace(/index\.html$/, '')}`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

async function openUsers(): Promise<void> {
  openPage('users/index.html');
  await import('/app/users/index.js');
  await vi.waitFor(() => {
    expect(document.querySelectorAll('#users .skeleton')).toHaveLength(0);
    expect(document.querySelector('#users table, #users .empty, #users .banner')).not.toBeNull();
  });
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function rowWith(content: string): Untyped {
  return [...document.querySelectorAll('#users tbody tr')].find((row: Untyped) =>
    row.textContent.includes(content),
  );
}

function clickIn(row: Untyped, label: string): void {
  const button = [...row.querySelectorAll('button')].find((node: Untyped) =>
    node.textContent.includes(label),
  );
  if (button === undefined) {
    throw new Error(`No button ${label} in the row.`);
  }
  button.click();
}

function answerDialog(id: string, values: Record<string, string>): void {
  const dialog = document.querySelector(id);
  expect(dialog.open, `${id} should be open`).toBe(true);
  for (const [name, value] of Object.entries(values)) {
    dialog.querySelector(`[name="${name}"]`).value = value;
  }
  [...dialog.querySelectorAll('button')].find((node: Untyped) => node.value === 'confirm').click();
}

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

describe('the users page of the administrator (REQ-440)', () => {
  it('lists the users with name, e-mail, role and situation', async () => {
    await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'usuaria@usina.com.br',
      role: 'USER',
      name: 'Usuária Comum',
    });

    await openUsers();

    const self = rowWith(TEST_USER.email);
    expect(self.textContent).toContain(TEST_USER.name);
    expect(self.textContent).toContain('Administrador');
    expect(self.textContent).toContain('Ativo');
    const other = rowWith('usuaria@usina.com.br');
    expect(other.textContent).toContain('Usuária Comum');
    expect(other.textContent).toContain('Usuário');
    expect(requests).toContain('GET /users');
  });

  it('invites and shows the link to hand over, and the pending invitation (REQ-420, REQ-436)', async () => {
    await openUsers();

    document.querySelector('#form-invite [name="email"]').value = 'novo@usina.com.br';
    document.querySelector('#form-invite [name="role"]').value = 'USER';
    document
      .querySelector('#form-invite')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('#invite-link [name="link"]')?.value).toMatch(
        /^https:\/\/usina\.example\/app\/invitation\/\?token=/,
      );
    });
    expect(requests).toContain('POST /users/invitations');
    await vi.waitFor(() => {
      const row = rowWith('novo@usina.com.br');
      expect(row?.textContent).toContain('Convite pendente');
      expect(row?.textContent).toContain('Usuário');
    });
  });

  it('resends a pending invitation, with a new link on screen (FA-401)', async () => {
    await application.useCases.inviteUser.execute({
      actor: admin.user,
      email: 'reenvio@usina.com.br',
      role: 'USER',
    });
    await openUsers();

    clickIn(rowWith('reenvio@usina.com.br'), 'Reenviar convite');

    await vi.waitFor(() => {
      expect(text('#invite-link')).toContain('reenvio@usina.com.br');
    });
    expect(
      requests.some((request) => /^POST \/users\/invitations\/.+\/resend$/.test(request)),
    ).toBe(true);
  });

  it('deactivates a user after a confirmation (REQ-403)', async () => {
    const { user } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'desligado@usina.com.br',
      role: 'USER',
    });
    await openUsers();

    clickIn(rowWith('desligado@usina.com.br'), 'Desativar');
    answerDialog('#dialog-deactivate', {});

    await vi.waitFor(() => {
      expect(rowWith('desligado@usina.com.br').textContent).toContain('Desativado');
    });
    expect(requests).toContain(`POST /users/${user.id}/deactivation`);
    // A deactivated user offers no action any more.
    expect(rowWith('desligado@usina.com.br').querySelectorAll('button')).toHaveLength(0);
  });

  it('changes a role (REQ-404)', async () => {
    await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'promovida@usina.com.br',
      role: 'USER',
    });
    await openUsers();

    clickIn(rowWith('promovida@usina.com.br'), 'Trocar papel');
    answerDialog('#dialog-role', { role: 'ADMINISTRATOR' });

    await vi.waitFor(() => {
      expect(rowWith('promovida@usina.com.br').textContent).toContain('Administrador');
    });
  });

  it('shows the server refusal to deactivate the last administrator (REQ-406)', async () => {
    // Every other administrator created above is deactivated first.
    const listing = await application.useCases.listUsers.execute({ actor: admin.user });
    for (const user of listing.users) {
      if (user.role === 'ADMINISTRATOR' && user.id !== admin.user.id && user.status === 'ACTIVE') {
        await application.useCases.deactivateUser.execute({ actor: admin.user, userId: user.id });
      }
    }
    await openUsers();

    clickIn(rowWith(TEST_USER.email), 'Desativar');
    answerDialog('#dialog-deactivate', {});

    await vi.waitFor(() => {
      expect(snackbars().join(' ')).toContain('ao menos um administrador ativo');
    });
    expect(rowWith(TEST_USER.email).textContent).toContain('Ativo');
  });
});

describe('a Usuário (REQ-401, REQ-430)', () => {
  it('does not see "Usuários" in the menu, which an administrator does', async () => {
    const { cookie } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'menu@usina.com.br',
      role: 'USER',
    });
    globalThis.fetch = recording(((input: Untyped, init: Untyped) =>
      admin.anonymousFetch(input, {
        ...init,
        headers: { ...(init?.headers ?? {}), cookie },
      })) as typeof globalThis.fetch);

    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => expect(text('.app-bar__user')).toBe('menu@usina.com.br'));

    const item = document.querySelector('.app-nav__item[href="/app/users/"]');
    expect(item === null || item.hidden).toBe(true);

    vi.resetModules();
    globalThis.fetch = recording(adminFetch);
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => {
      expect(document.querySelector('.app-nav__item[href="/app/users/"]')?.hidden).toBe(false);
    });
  });

  it('opening the page anyway shows the refusal the server answers', async () => {
    const { cookie } = await logInAs(application.useCases, baseUrl, admin.anonymousFetch, {
      email: 'curiosa@usina.com.br',
      role: 'USER',
    });
    globalThis.fetch = recording(((input: Untyped, init: Untyped) =>
      admin.anonymousFetch(input, {
        ...init,
        headers: { ...(init?.headers ?? {}), cookie },
      })) as typeof globalThis.fetch);

    openPage('users/index.html');
    await import('/app/users/index.js');

    await vi.waitFor(() => {
      expect(text('#users')).toContain('Somente um administrador pode fazer isto.');
    });
    expect(document.querySelector('#form-invite')?.hidden).toBe(true);
  });
});
