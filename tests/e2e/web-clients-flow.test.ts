// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { cpfOf } from '../support/cpf.ts';
import { recognitionBody } from '../support/policy-recognition.ts';
import { chooseBroker, registerBroker } from './support/brokers.ts';
import { TEST_USER, signIn } from './support/sign-in.ts';

/**
 * The clients of V2 section 9E, driven through the pages (CA-317): register,
 * search and change a client on its page; type the client's name and CPF on a
 * new proposal and get the registered client; find proposals and policies by
 * the client's name or CPF; see the client on the policy.
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

/** The broker registered by `registerBroker(…, 1)`: a client may hold the same CPF (CA-311). */
const BROKER_CPF = cpfOf(1);

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-clients-'));
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
  await registerBroker(baseUrl, 'Corretora Alfa', 1);

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

async function openClients(): Promise<void> {
  openPage('clients/index.html');
  await import('/app/clients/index.js');
  await vi.waitFor(() => {
    expect(document.querySelector('#list-clients .registry__head')).not.toBeNull();
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

/** Types in a search field the way the operator does. */
function type(form: string, name: string, value: string): void {
  const input = field(form, name);
  input.value = value;
  input.dispatchEvent(new window.Event('input'));
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

/** A complete proposal over HTTP, for the journeys that start after it exists. */
function proposalBody(
  proposalNumber: string,
  client: { name: string; cpf: string },
  brokerId: string,
) {
  return {
    client,
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber,
    netPremium: '1000.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [],
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
  };
}

/* -------------------------------------------------------------- tests -- */

describe('the clients page (V2 section 9E)', () => {
  it('starts empty, and registers a client signed by the session (CA-310, REQ-314)', async () => {
    await openClients();
    expect(text('#list-clients')).toContain('Nenhum cliente cadastrado');

    fill('#form-client', { name: 'Ana Silva', cpf: '529.982.247-25' });
    submit('#form-client');

    await vi.waitFor(() => {
      expect(rows('#list-clients')).toHaveLength(1);
    });
    expect(requests).toContain('POST /clients');
    expect(snackbars()).toContain('Cliente Ana Silva cadastrado.');
    expect(rowContaining('#list-clients', 'Ana Silva').textContent).toContain('529.982.247-25');

    const [stored] = (await callApi('GET', '/clients')).items;
    expect(stored.cpf).toBe('52998224725');
    expect(stored.history).toHaveLength(1);
  });

  it('refuses an invalid CPF and a CPF already registered, in Portuguese (REJ-311, REJ-312)', async () => {
    await openClients();

    fill('#form-client', { name: 'Outra Pessoa', cpf: '529.982.247-24' });
    submit('#form-client');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('CPF do cliente inválido');
    });

    fill('#form-client', { name: 'Outra Pessoa', cpf: '52998224725' });
    submit('#form-client');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('Já existe um cliente cadastrado com este CPF.');
    });
    expect(snackbars()).toContain('REQ-312');

    expect((await callApi('GET', '/clients')).items).toHaveLength(1);
    expect(field('#form-client', 'name').value).toBe('Outra Pessoa');
  });

  it('accepts the CPF a broker holds: each registry has its own uniqueness (CA-311)', async () => {
    await openClients();

    fill('#form-client', { name: 'Bruno Lima', cpf: BROKER_CPF });
    submit('#form-client');

    await vi.waitFor(() => {
      expect(rows('#list-clients')).toHaveLength(2);
    });
  });

  it('searches by part of the name or by the CPF digits (REQ-316)', async () => {
    await openClients();

    type('#form-client-search', 'q', 'silva');
    await vi.waitFor(() => {
      expect(requests).toContain('GET /clients?q=silva');
      expect(rows('#list-clients')).toHaveLength(1);
    });
    expect(text('#list-clients')).toContain('Ana Silva');

    type('#form-client-search', 'q', '529.982');
    await vi.waitFor(() => {
      expect(requests).toContain(`GET /clients?q=${encodeURIComponent('529.982')}`);
      expect(text('#list-clients')).toContain('Ana Silva');
    });
    expect(text('#list-clients')).not.toContain('Bruno Lima');

    type('#form-client-search', 'q', 'Carlos');
    await vi.waitFor(() => {
      expect(text('#list-clients')).toContain('Nenhum cliente encontrado');
    });
  });

  it('changes a client and keeps the earlier record in the history, signed (CA-312)', async () => {
    await openClients();

    rowContaining('#list-clients', 'Bruno Lima').querySelector('button').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#client-detail').classList.contains('hidden')).toBe(false);
    });

    field('#form-client-change', 'name').value = 'Bruno Lima Neto';
    submit('#form-client-change');

    await vi.waitFor(() => {
      expect(rows('#client-history')).toHaveLength(2);
    });
    expect(requests.some((request) => /^POST \/clients\/.+\/revision$/.test(request))).toBe(true);
    const [latest, earliest] = rows('#client-history');
    expect(latest.textContent).toContain('Bruno Lima Neto');
    expect(latest.textContent).toContain(TEST_USER.name);
    expect(earliest.textContent).toContain('Bruno Lima');
    // REQ-315: there is no removal.
    expect(text('main')).not.toContain('Excluir');
  });
});

describe('the client of a new proposal (REQ-317)', () => {
  async function openNewProposal(): Promise<void> {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');
  }

  function fillTheRest(proposalNumber: string): void {
    fill('#form-proposal', {
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

  async function registerThroughForm(
    proposalNumber: string,
    client: { name: string; cpf: string },
  ): Promise<Untyped> {
    await openNewProposal();
    await chooseBroker(document, window, 'alfa', 'Corretora Alfa');
    fill('#form-proposal', { clientName: client.name, clientCpf: client.cpf });
    fillTheRest(proposalNumber);

    submit('#form-proposal');
    await vi.waitFor(() => {
      expect(text('#done-body')).toContain(proposalNumber);
    });

    const all = (await callApi('GET', '/proposals')).items;
    return all.find((proposal: Untyped) => proposal.proposalNumber === proposalNumber);
  }

  it('uses the registered client of a known CPF and never overwrites it (CA-313, REJ-314)', async () => {
    const proposal = await registerThroughForm('PRP-CLI-1', {
      name: 'A. Silva Digitada',
      cpf: '52998224725',
    });

    const [ana] = (await callApi('GET', '/clients?q=52998224725')).items;
    expect(proposal.clientId).toBe(ana.id);
    expect(ana.name).toBe('Ana Silva');
    expect(ana.history).toHaveLength(1);

    // The proposal page shows the registered name and the CPF, not the id.
    vi.resetModules();
    openPage('proposals/detail.html', `?id=${proposal.id}`);
    await import('/app/proposals/detail.js');
    await vi.waitFor(() => {
      expect(text('#page')).toContain('Ana Silva · 529.982.247-25');
    });
    expect(text('#page')).not.toContain('A. Silva Digitada');
    expect(text('#page')).not.toContain(ana.id);
  });

  it('registers the client of a new CPF, signed by the session (CA-313)', async () => {
    const proposal = await registerThroughForm('PRP-CLI-2', {
      name: 'Carla Dias',
      cpf: cpfOf(77),
    });

    const client = await callApi('GET', `/clients/${proposal.clientId}`);
    expect(client).toMatchObject({ name: 'Carla Dias', cpf: cpfOf(77) });
    expect(client.history[0].signedBy).toBe(proposal.workedCommissionHistory[0].informedBy);

    vi.resetModules();
    await openClients();
    expect(text('#list-clients')).toContain('Carla Dias');
  });

  it('leaves no client behind when the registration is refused (CA-314)', async () => {
    await openNewProposal();
    // The broker typed and not chosen is refused (REJ-304), after the client.
    field('#form-proposal', 'brokerSearch').value = 'Corretora Inventada';
    fill('#form-proposal', { clientName: 'Davi Rocha', clientCpf: cpfOf(78) });
    fillTheRest('PRP-CLI-REFUSED');

    submit('#form-proposal');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('brokerId');
    });

    expect((await callApi('GET', `/clients?q=${cpfOf(78)}`)).items).toEqual([]);
  });

  it('refuses a client without name or with an invalid CPF, in Portuguese (REJ-310, REJ-311)', async () => {
    await openNewProposal();
    await chooseBroker(document, window, 'alfa', 'Corretora Alfa');
    fill('#form-proposal', { clientName: 'Eva Prado', clientCpf: '123.456.789-00' });
    fillTheRest('PRP-CLI-INVALID');

    submit('#form-proposal');
    await vi.waitFor(() => {
      expect(snackbars()).toContain('CPF do cliente inválido');
    });
    expect(field('#form-proposal', 'clientName').value).toBe('Eva Prado');
  });

  it('leaves one client when two registrations of the same new CPF arrive together (CA-314)', async () => {
    const [broker] = await callApi('GET', '/brokers?q=alfa');
    const client = { name: 'Fabio Reis', cpf: cpfOf(79) };

    const [first, second] = await Promise.all([
      callApi('POST', '/proposals', proposalBody('PRP-CLI-RACE-1', client, broker.id)),
      callApi('POST', '/proposals', proposalBody('PRP-CLI-RACE-2', client, broker.id)),
    ]);

    expect(first.clientId).toBeDefined();
    expect(second.clientId).toBe(first.clientId);
    expect((await callApi('GET', `/clients?q=${cpfOf(79)}`)).items).toHaveLength(1);
  });
});

describe('proposals and policies by client (REQ-318, REQ-319)', () => {
  it('finds the proposals of a client by name or CPF, with the state filter (CA-316)', async () => {
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => {
      expect(rows('#list').length).toBeGreaterThan(0);
    });
    // REQ-318: the line names the client, not its id.
    expect(rowContaining('#list', 'PRP-CLI-1').textContent).toContain('Cliente Ana Silva');

    type('#form-client-search', 'client', 'silva');
    await vi.waitFor(() => {
      expect(requests).toContain('GET /proposals?status=AWAITING_ISSUANCE&client=silva');
      expect(rows('#list')).toHaveLength(1);
    });
    expect(text('#list')).toContain('PRP-CLI-1');

    type('#form-client-search', 'client', '529.982.247-25');
    await vi.waitFor(() => {
      expect(requests).toContain(
        `GET /proposals?status=AWAITING_ISSUANCE&client=${encodeURIComponent('529.982.247-25')}`,
      );
      expect(rows('#list')).toHaveLength(1);
    });

    type('#form-client-search', 'client', 'ninguem');
    await vi.waitFor(() => {
      expect(text('#list')).toContain('Nenhuma proposta desse cliente');
    });
  });

  it('gives the policy its proposal’s client and finds it on the policies page (CA-315, CA-316)', async () => {
    const [proposal] = (await callApi('GET', '/proposals')).items.filter(
      (candidate: Untyped) => candidate.proposalNumber === 'PRP-CLI-1',
    );
    const policy = await callApi('POST', '/policies', recognitionBody(proposal.id, 'APL-TESTE'));
    expect(policy.clientId).toBe(proposal.clientId);
    const other = (await callApi('GET', '/proposals')).items.find(
      (candidate: Untyped) => candidate.proposalNumber === 'PRP-CLI-2',
    );
    await callApi('POST', '/policies', recognitionBody(other.id, 'APL-TESTE'));

    openPage('policies/index.html');
    await import('/app/policies/index.js');
    await vi.waitFor(() => {
      expect(rows('#list')).toHaveLength(2);
    });

    type('.renewal-filter', 'client', '52998');
    await vi.waitFor(() => {
      expect(requests).toContain('GET /policies?client=52998');
      expect(rows('#list')).toHaveLength(1);
    });
    expect(text('#list')).toContain('Ana Silva');
    expect(text('#list')).not.toContain('Carla Dias');

    // REQ-318: a renamed client reaches the policy: it is read, not copied.
    await callApi('POST', `/clients/${proposal.clientId}/revision`, {
      name: 'Ana Silva Prado',
      cpf: '52998224725',
    });
    vi.resetModules();
    openPage('policies/detail.html', `?id=${policy.id}`);
    await import('/app/policies/detail.js');
    await vi.waitFor(() => {
      expect(text('#page')).toContain('Ana Silva Prado · 529.982.247-25');
    });
  });
});
