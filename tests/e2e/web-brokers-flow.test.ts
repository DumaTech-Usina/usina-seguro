// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { chooseBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { TEST_USER, signIn } from './support/sign-in.ts';

/**
 * The brokers of V2 section 9D, driven through the pages (CA-306): register,
 * search and change a broker on its page, choose it on a new proposal, and see
 * it on the proposal and on the policy that inherits it.
 *
 * Nothing here is a mock. The server is the real one, listening on an ephemeral
 * port over SQLite on disk, and the modules under test are the same files the
 * browser downloads.
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

/** Every request a page made, in order, as `METHOD path`. */
const requests: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-brokers-'));
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

  // REQ-410: every journey starts logged in, as the test user.
  await signIn(application.useCases, baseUrl);

  const nodeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return nodeFetch(url, init);
  }) as typeof globalThis.fetch;

  window.scrollTo = () => {};
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  requests.length = 0;
});

/* ----------------------------------------------------------- the pages -- */

function openPage(relativePath: string, search = ''): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath}${search}`);

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

async function openBrokers(): Promise<void> {
  openPage('brokers/index.html');
  await import('/app/brokers/index.js');
  await vi.waitFor(() => {
    expect(document.querySelector('#list-brokers .registry__head')).not.toBeNull();
  });
}

function field(form: string, name: string): Untyped {
  const input = document.querySelector(`${form} [name="${name}"]`);
  if (input === null) {
    throw new Error(`No field ${name} in ${form}.`);
  }
  return input;
}

function fill(form: string, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    field(form, name).value = value;
  }
}

function submit(form: string): void {
  document.querySelector(form)?.dispatchEvent(new window.Event('submit', { cancelable: true }));
}

function rows(region: string): Untyped[] {
  return [...document.querySelectorAll(`${region} tbody tr`)];
}

function rowContaining(region: string, text: string): Untyped {
  const found = rows(region).find((row: Untyped) => row.textContent.includes(text));
  if (found === undefined) {
    throw new Error(`No line mentioning ${text} on screen.`);
  }
  return found;
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function snackbars(): string {
  return [...document.querySelectorAll('.snackbar')]
    .map((node: Untyped) => node.textContent ?? '')
    .join(' ');
}

/** Searches the list the way the operator types, and waits for what it shows. */
async function searchFor(query: string, shown: string): Promise<void> {
  const search = field('#form-broker-search', 'q');
  search.value = query;
  search.dispatchEvent(new window.Event('input'));
  await vi.waitFor(() => {
    expect(requests).toContain(`GET /brokers?q=${encodeURIComponent(query)}`);
    expect(text('#list-brokers')).toContain(shown);
  });
}

async function callApi(method: string, apiPath: string, body?: unknown): Promise<Untyped> {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return response.json();
}

/* -------------------------------------------------------------- tests -- */

describe('the brokers page (V2 section 9D)', () => {
  it('starts empty, and registers a broker signed by the session (CA-300, REQ-304)', async () => {
    await openBrokers();
    expect(text('#list-brokers')).toContain('Nenhum corretor cadastrado');

    fill('#form-broker', { name: 'Ana Silva', cpf: '529.982.247-25' });
    submit('#form-broker');

    await vi.waitFor(() => {
      expect(rows('#list-brokers')).toHaveLength(1);
    });
    expect(requests).toContain('POST /brokers');
    expect(snackbars()).toContain('Corretor Ana Silva cadastrado.');
    expect(rowContaining('#list-brokers', 'Ana Silva').textContent).toContain('529.982.247-25');

    // REQ-301: the server keeps the digits; REQ-304: the session signed it.
    const [stored] = await callApi('GET', '/brokers');
    expect(stored.cpf).toBe('52998224725');
    expect(stored.history).toHaveLength(1);
  });

  it('refuses an invalid CPF and a CPF already registered, in Portuguese (REJ-301, REJ-302)', async () => {
    await openBrokers();

    fill('#form-broker', { name: 'Outra Pessoa', cpf: '529.982.247-24' });
    submit('#form-broker');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('CPF inválido');
    });

    fill('#form-broker', { name: 'Outra Pessoa', cpf: '52998224725' });
    submit('#form-broker');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('Já existe um corretor cadastrado com este CPF.');
    });
    expect(snackbars()).toContain('REQ-302');

    // Nothing was registered, and what was typed stays for correction.
    expect(await callApi('GET', '/brokers')).toHaveLength(1);
    expect(field('#form-broker', 'name').value).toBe('Outra Pessoa');
  });

  it('searches by part of the name or by the CPF digits (CA-303)', async () => {
    await callApi('POST', '/brokers', { name: 'Bruno Lima', cpf: '111.444.777-35' });
    await openBrokers();
    expect(rows('#list-brokers')).toHaveLength(2);

    await searchFor('silva', '1 registro');
    expect(text('#list-brokers')).toContain('Ana Silva');
    expect(text('#list-brokers')).not.toContain('Bruno Lima');

    await searchFor('111.444', 'Bruno Lima');
    expect(rows('#list-brokers')).toHaveLength(1);

    await searchFor('Carlos', 'Nenhum corretor encontrado');
  });

  it('changes a broker and keeps the earlier record in the history, signed (CA-302)', async () => {
    await openBrokers();

    rowContaining('#list-brokers', 'Ana Silva').querySelector('button').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#broker-detail').classList.contains('hidden')).toBe(false);
    });
    expect(field('#form-broker-change', 'name').value).toBe('Ana Silva');

    field('#form-broker-change', 'name').value = 'Ana Silva Souza';
    submit('#form-broker-change');

    await vi.waitFor(() => {
      expect(rows('#broker-history')).toHaveLength(2);
    });
    expect(requests.some((request) => /^POST \/brokers\/.+\/revision$/.test(request))).toBe(true);
    // Newest first, each with who signed it (REQ-304): the session's user.
    const [latest, earliest] = rows('#broker-history');
    expect(latest.textContent).toContain('Ana Silva Souza');
    expect(latest.textContent).toContain(TEST_USER.name);
    expect(earliest.textContent).toContain('Ana Silva');
    expect(text('#list-brokers')).toContain('Ana Silva Souza');
    // REQ-305: there is no removal.
    expect(text('#page, main')).not.toContain('Excluir');
  });
});

describe('the broker of a proposal and of its policy (REQ-307, REQ-308)', () => {
  async function openNewProposal(): Promise<void> {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');
  }

  function fillTheRest(proposalNumber: string): void {
    fill('#form-proposal', {
      clientName: 'Cliente Web',
      clientCpf: clientNamed('Cliente Web').cpf,
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'bank-slip',
      proposalNumber,
      netPremium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      workedCommission: '20',
      workedCommissionMode: 'INTEGRAL',
    });
  }

  it('refuses a proposal whose broker was typed but not chosen (REJ-304)', async () => {
    await openNewProposal();
    field('#form-proposal', 'brokerSearch').value = 'Corretora Inventada';
    field('#form-proposal', 'brokerSearch').dispatchEvent(new window.Event('input'));
    fillTheRest('PRP-BRK-0');

    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars()).toContain('brokerId');
    });
    expect(await callApi('GET', '/proposals')).toEqual([]);
  });

  it('registers the proposal with the broker chosen by CPF, and shows its name (CA-304)', async () => {
    await openNewProposal();
    await chooseBroker(document, window, '529.982', 'Ana Silva Souza');
    expect(text('#broker-hint')).toContain('Corretor escolhido: Ana Silva Souza.');
    fillTheRest('PRP-BRK-1');

    submit('#form-proposal');
    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-BRK-1');
    });

    const [ana] = await callApi('GET', '/brokers?q=ana');
    const [proposal] = await callApi('GET', '/proposals');
    expect(proposal.brokerId).toBe(ana.id);

    // The proposal page shows the broker's name, not the id.
    vi.resetModules();
    openPage('proposals/detail.html', `?id=${proposal.id}`);
    await import('/app/proposals/detail.js');
    await vi.waitFor(() => {
      expect(text('#page')).toContain('Ana Silva Souza');
    });
    expect(text('#page')).not.toContain(ana.id);
  });

  it('shows on the policy the current name of the broker of its proposal (REQ-308, CA-304)', async () => {
    const [proposal] = await callApi('GET', '/proposals');
    const policy = await callApi('POST', '/policies', { proposalId: proposal.id });
    expect(policy.brokerId).toBe(proposal.brokerId);

    // A later change of the broker reaches the policy: it is read, not copied.
    await callApi('POST', `/brokers/${proposal.brokerId}/revision`, {
      name: 'Ana S. Souza',
      cpf: '52998224725',
    });

    vi.resetModules();
    openPage('policies/detail.html', `?id=${policy.id}`);
    await import('/app/policies/detail.js');
    await vi.waitFor(() => {
      expect(text('#page')).toContain('Ana S. Souza');
    });
  });
});
