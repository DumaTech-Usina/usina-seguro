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
 * OUT-05 driven the way the Financeiro drives it: the agreed commission of
 * every policy (REQ-236), and the path from a line to its policy.
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-commissions-'));
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

  await registeredPolicy('PRP-PANEL-A', 'PRP-PANEL-A');
  await registeredPolicy('PRP-PANEL-B', 'PRP-PANEL-B');
  await registeredPolicy('PRP-PANEL-FORE', 'PRP-PANEL-FORE');
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

/**
 * Opens the panel and waits for the first reading to land.
 *
 * The module registry is reset first because a page opened twice in one
 * journey is loaded twice by the browser, and a cached module would leave the
 * screen showing the skeleton of a page that never ran.
 */
async function openPanel(): Promise<void> {
  vi.resetModules();
  openPage('commissions/index.html');
  await import('/app/commissions/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

/** Clicks one of the filters, the way an operator switches worklists. */
async function filterBy(label: string): Promise<void> {
  const tab = [...document.querySelectorAll('.filters__option')].find(
    (option: Untyped) => option.textContent === label,
  );

  if (tab === undefined) {
    throw new Error(`No filter "${label}" on screen.`);
  }

  tab.click();
  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

function rows(): Untyped[] {
  return [...document.querySelectorAll('#list tbody tr')];
}

/** The line of a policy, found by the number that identifies it (REQ-020). */
function rowOf(policyNumber: string): Untyped {
  const found = rows().find((row: Untyped) =>
    row.querySelector('.policy-number')?.textContent?.includes(policyNumber),
  );

  if (found === undefined) {
    throw new Error(`No line for ${policyNumber} on screen.`);
  }
  return found;
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
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

interface Business {
  readonly policyId: string;
  readonly proposalNumber: string;
  readonly policyNumber: string;
}

/** A business the way FP-01 leaves it: policy registered, commission forecast. */
async function registeredPolicy(proposalNumber: string, policyNumber: string): Promise<Business> {
  const proposal = await callApi('POST', '/proposals', {
    client: clientNamed('client-1'),
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber: proposalNumber,
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [{ amount: '100.00', dueDate: '2026-10-10' }],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
  });

  const policy = await callApi('POST', '/policies', recognitionBody(proposal.id, policyNumber));

  return { policyId: policy.id, proposalNumber, policyNumber };
}

/* -------------------------------------------------------------- tests -- */

describe('the agreed commission panel (OUT-05)', () => {
  it('shows every policy with its agreed commission (REQ-236)', async () => {
    await openPanel();

    expect(requests).toContain('GET /commissions');
    expect(rows()).toHaveLength(3);

    const line = rowOf('PRP-PANEL-A');
    expect(line.textContent).toContain('R$ 40,00');
    expect(line.textContent).toContain('Prevista');
    // REQ-050, REQ-022: what identifies the business to a human.
    expect(line.textContent).toContain('PRP-PANEL-A');
    expect(line.textContent).toContain('client-1');

    expect(text('#summary')).toContain('3 apólices');
  });

  it('narrows by state with a new reading, not a local slice', async () => {
    await openPanel();

    await filterBy('Previstas');

    expect(requests).toContain('GET /commissions?status=FORECAST');
    expect(rows()).toHaveLength(3);

    await filterBy('Todas');
    expect(rows()).toHaveLength(3);
  });

  it('carries the operator from a line to the policy that holds it', async () => {
    await openPanel();

    const link = rowOf('PRP-PANEL-A').querySelector('a.btn');
    const lines = (await callApi('GET', '/commissions')).items;
    const line = lines.find((item: Untyped) => item.policyNumber === 'PRP-PANEL-A');

    expect(link.getAttribute('href')).toBe(`/app/policies/detail.html?id=${line.policyId}`);
  });

  it('shows the adjusted value beside the calculated one (REQ-066, REQ-124)', async () => {
    const [forecast] = (await callApi('GET', '/commissions?status=FORECAST')).items;

    await callApi('POST', `/policies/${forecast.policyId}/commission/override`, {
      receivable: '45.00',
      justification: 'acordo extraordinario com a seguradora',
    });

    await openPanel();

    const adjusted = rowOf('PRP-PANEL-FORE');
    expect(adjusted.textContent).toContain('R$ 45,00');
    // The calculated value is not replaced by the adjustment, it is beside it.
    expect(adjusted.textContent).toContain('calculado R$ 40,00');
  });
});
