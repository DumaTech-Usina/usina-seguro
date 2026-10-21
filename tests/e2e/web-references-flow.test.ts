// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { recognitionBody } from '../support/policy-recognition.ts';
import { registerBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { signIn } from './support/sign-in.ts';

/**
 * IN-01 driven the way the Administrator (ATR-003) drives it, and then read
 * where it matters.
 *
 * Until this slice every screen identified a business by the identifier typed
 * on the proposal — `client-1`, `insurer-1`, `auto`. (The broker has its own
 * registry since V2 section 9D: `web-brokers-flow.test.ts`.) REQ-096 asks a
 * document to identify it by the *name* of the client, the broker and the
 * ramo, and the checklist recorded the absence of those names as what blocked
 * it. This file walks the loop that closes it: register the names, see the
 * operation start using them, and see a reference nobody registered keep
 * showing its identifier rather than disappearing.
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
/** REQ-307: the registered broker the proposals of this journey name. */
let brokerId: string;

/** Every request a page made, in order, as `METHOD path`. */
const requests: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-references-'));
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
  brokerId = await registerBroker(baseUrl, 'Corretora Alfa', 1);

  const nodeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return nodeFetch(url, init);
  }) as typeof globalThis.fetch;

  window.scrollTo = () => {};

  // Two businesses already sold, the way FP-01 leaves them, before anybody
  // maintains IN-01: this is the state the registry is introduced into.
  await registeredPolicy({
    clientName: 'Ana Lima',
    proposalNumber: 'PRP-A',
    policyNumber: 'PRP-A',
  });
  await registeredPolicy({
    clientName: 'Bruno Souza',
    insurerId: 'seguradora-sem-cadastro',
    proposalNumber: 'PRP-B',
    policyNumber: 'PRP-B',
  });
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

/** Opens a page and waits for the reading it makes on load to land. */
async function open(page: string, module: string, settled: string): Promise<void> {
  vi.resetModules();
  openPage(page);
  await import(module);

  await vi.waitFor(() => {
    expect(document.querySelectorAll(`${settled} .skeleton`)).toHaveLength(0);
  });
}

const openSettings = () => open('settings/index.html', '/app/settings/index.js', '.registry');
const openPolicies = () => open('policies/index.html', '/app/policies/index.js', '#list');

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

/** Submits and waits for the reading this submission caused. */
async function submit(form: string, region: string, route: string): Promise<void> {
  const from = requests.length;
  document.querySelector(form)?.dispatchEvent(new window.Event('submit', { cancelable: true }));

  await vi.waitFor(() => {
    expect(requests.slice(from)).toContain(`GET ${route}`);
    expect(document.querySelectorAll(`${region} .skeleton`)).toHaveLength(0);
  });
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

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

/* --------------------------------------------------------- the backend -- */

async function callApi(method: string, apiPath: string, body?: unknown): Promise<Untyped> {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return response.status === 204 ? null : await response.json();
}

async function registeredPolicy(options: {
  clientName: string;
  insurerId?: string;
  proposalNumber: string;
  policyNumber: string;
}): Promise<void> {
  const proposal = await callApi('POST', '/proposals', {
    client: clientNamed(options.clientName),
    brokerId,
    insurerId: options.insurerId ?? 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber: options.proposalNumber,
    netPremium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [{ amount: '1200.00', dueDate: '2026-10-10' }],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
  });

  await callApi('POST', '/policies', recognitionBody(proposal.id, 'APL-TESTE'));
}

/* -------------------------------------------------------------- tests -- */

describe('the reference registry (IN-01)', () => {
  it('shows the operation by identifier while nothing is registered', async () => {
    await openPolicies();

    // This is the state REQ-096 was blocked by: a listing that can only name a
    // business by the code somebody typed on the proposal.
    const line = rowContaining('#list', 'PRP-A');
    expect(line.textContent).toContain('insurer-1');
    expect(line.textContent).toContain('auto');
  });

  it('registers each kind of reference and lists it back (IN-01)', async () => {
    await openSettings();

    expect(requests).toContain('GET /references');
    expect(text('#list-references')).toContain('Nenhum cadastro registrado');

    for (const [kind, id, name] of [
      ['INSURER', 'insurer-1', 'Seguradora Norte'],
      ['PRODUCT', 'auto', 'Automóvel'],
    ] as const) {
      fill('#form-reference', { kind, id, name });
      await submit('#form-reference', '#list-references', '/references');
    }

    expect(snackbars().join(' ')).toContain('Automóvel registrado');
    // The listing is re-read from the backend, not patched into the page.
    expect(requests.at(-1)).toBe('GET /references');
    expect(rows('#list-references')).toHaveLength(2);

    const insurer = rowContaining('#list-references', 'Seguradora Norte');
    expect(insurer.textContent).toContain('Seguradora');
    // The identifier stays visible: it is what every other record matches on.
    expect(insurer.textContent).toContain('insurer-1');
    // REQ-320: the client is no kind of IN-01 any more; it has its own page.
    expect(
      [...document.querySelectorAll('#form-reference [name="kind"] option')].map(
        (option: Untyped) => option.value,
      ),
    ).toEqual(['INSURER', 'INTERMEDIARY', 'PRODUCT']);
  });

  it('refuses a reference with no name, in Portuguese, leaving the registry alone', async () => {
    await openSettings();
    const before = rows('#list-references').length;

    fill('#form-reference', { kind: 'INSURER', id: 'insurer-9', name: '   ' });
    document
      .querySelector('#form-reference')
      ?.dispatchEvent(new window.Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });

    expect(snackbars().join(' ')).toContain('Cadastro de referência');
    expect(snackbars().join(' ')).toContain('IN-01');
    expect(rows('#list-references')).toHaveLength(before);
  });

  it('names the businesses on the policy listing (REQ-096, OUT-03)', async () => {
    await openPolicies();

    const line = rowContaining('#list', 'PRP-A');

    // REQ-318: the client's name comes from the client registry.
    expect(line.textContent).toContain('Ana Lima');
    expect(line.textContent).toContain('Seguradora Norte');
    // REQ-022 names the field "produto/ramo": the product's name is the ramo.
    expect(line.textContent).toContain('Automóvel');
  });

  it('keeps showing the identifier of a reference nobody registered (REQ-002)', async () => {
    await openPolicies();

    const unnamed = rowContaining('#list', 'PRP-B');

    // The business is listed exactly like the other one; what it lacks is a
    // name, and the screen says the identifier rather than leaving a gap.
    expect(unnamed.textContent).toContain('seguradora-sem-cadastro');
    expect(unnamed.textContent).toContain('Bruno Souza');
    expect(rows('#list')).toHaveLength(2);
  });

  it('offers the registered identifiers on the new-proposal form, without requiring them', async () => {
    vi.resetModules();
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#insurer-options option').length).toBeGreaterThan(0);
    });

    const insurers = [...document.querySelectorAll('#insurer-options option')].map(
      (option: Untyped) => ({ value: option.value, label: option.textContent }),
    );

    expect(requests).toContain('GET /references');
    expect(insurers).toContainEqual({ value: 'insurer-1', label: 'Seguradora Norte' });
    // A suggestion, never a constraint: the field is free text and the list
    // only spares the operator from retyping what the registry already holds.
    expect(field('#form-proposal', 'insurerId').getAttribute('list')).toBe('insurer-options');
    expect(field('#form-proposal', 'insurerId').hasAttribute('pattern')).toBe(false);
    // REQ-317: the client is typed as name and CPF, not picked from IN-01.
    expect(document.querySelector('#client-options')).toBeNull();
  });

  it('corrects a name in place instead of listing it twice', async () => {
    await openSettings();

    fill('#form-reference', { kind: 'INSURER', id: 'insurer-1', name: 'Seguradora Norte Ltda' });
    await submit('#form-reference', '#list-references', '/references');

    const insurer = rows('#list-references').filter((row: Untyped) =>
      row.textContent.includes('insurer-1'),
    );

    expect(insurer).toHaveLength(1);
    expect(insurer[0].textContent).toContain('Seguradora Norte Ltda');

    // And the correction reaches the operation, which reads the registry fresh.
    await openPolicies();
    expect(rowContaining('#list', 'PRP-A').textContent).toContain('Seguradora Norte Ltda');
  });
});
