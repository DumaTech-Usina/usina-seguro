// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * FP-01 step 7 driven the way it actually happens: the operator registers the
 * policy on the proposal screen, and the notification of REQ-100 shows up in
 * the interface without anybody producing it by hand.
 *
 * That is the whole point of this file. The notification is not something a
 * user sends — there is no route that creates one — so the only honest way to
 * prove OUT-10 is to walk the journey that produces it: proposal, transmission,
 * policy, and then the screen where the broker reads what he was told.
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-notifications-'));
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

  const nodeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return nodeFetch(url, init);
  }) as typeof globalThis.fetch;

  window.scrollTo = () => {};

  // IN-01: the three names REQ-100 asks the notification to carry.
  for (const reference of [
    { kind: 'CLIENT', id: 'client-1', name: 'Maria Souza' },
    { kind: 'BROKER', id: 'broker-1', name: 'Corretora Alfa' },
    { kind: 'PRODUCT', id: 'auto', name: 'Automovel' },
  ]) {
    await callApi('POST', '/references', reference);
  }
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

/** Opens the notification screen and waits for the first reading to land. */
async function openNotifications(): Promise<void> {
  vi.resetModules();
  openPage('notifications/index.html');
  await import('/app/notifications/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

/** Picks a broker in the filter, the way an operator narrows the reading. */
async function filterByRecipient(label: string): Promise<void> {
  const select = document.querySelector('#recipient');
  const option = [...select.options].find((candidate: Untyped) => candidate.textContent === label);

  if (option === undefined) {
    throw new Error(`No recipient "${label}" on screen.`);
  }

  select.value = option.value;
  select.dispatchEvent(new window.Event('change'));

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

function rows(): Untyped[] {
  return [...document.querySelectorAll('#list tbody tr')];
}

/** The line of an emission, found by the policy number that identifies it. */
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

/** Opens the policy screen the way the notification hands it over: by its link. */
async function followToPolicy(row: Untyped): Promise<void> {
  const href = row.querySelector('a.btn').getAttribute('href');
  const [page, search] = href.split('?');

  vi.resetModules();
  openPage(page.replace('/app/', ''), `?${search}`);
  await import('/app/policies/detail.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#page .skeleton')).toBeNull();
  });
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

interface Emission {
  readonly proposalId: string;
  readonly policyId: string;
}

/**
 * FP-01 as the operator walks it, up to the act that produces the
 * notification: register, transmit, register the policy.
 */
async function issuePolicy(
  proposalNumber: string,
  policyNumber: string,
  brokerId = 'broker-1',
): Promise<Emission> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    customerAccepted: true,
    netPremium: '1200.00',
  });

  await callApi('POST', `/proposals/${proposal.id}/transmission`, {
    proposalNumber,
    workedCommission: '32.5',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    policyNumber,
    premium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [{ number: 1, amount: '1200.00', dueDate: '2026-10-10' }],
  });

  return { proposalId: proposal.id, policyId: policy.id };
}

/* -------------------------------------------------------------- tests -- */

describe('the notification of an effectuated emission (OUT-10)', () => {
  it('starts empty, and says so instead of showing a blank table', async () => {
    await openNotifications();

    expect(requests).toContain('GET /notifications');
    expect(rows()).toHaveLength(0);
    expect(text('#list')).toContain('Nenhuma emissão notificada ainda');
  });

  it('shows the five fields of REQ-100 after the policy is registered (CA-029)', async () => {
    await issuePolicy('PRP-WEB-N1', 'APL-WEB-N1');

    await openNotifications();

    const notified = rowOf('APL-WEB-N1');
    // The five REQ-096 and REQ-100 require, side by side on one line.
    expect(notified.textContent).toContain('Maria Souza');
    expect(notified.textContent).toContain('Corretora Alfa');
    expect(notified.textContent).toContain('Automovel');
    expect(notified.textContent).toContain('32,5%');
    expect(notified.textContent).toContain('R$ 1.200,00');
  });

  it('shows what the backend recorded, not a reading of the registry today', async () => {
    // REQ-105: the record says what was notified. Correcting the name in
    // IN-01 afterwards must not rewrite what the broker was told.
    await callApi('POST', '/references', {
      kind: 'CLIENT',
      id: 'client-1',
      name: 'Maria Souza Lima',
    });

    await openNotifications();
    expect(rowOf('APL-WEB-N1').textContent).toContain('Maria Souza');
    expect(rowOf('APL-WEB-N1').textContent).not.toContain('Maria Souza Lima');

    // And a business registered from here on carries the corrected name.
    await issuePolicy('PRP-WEB-N2', 'APL-WEB-N2');
    await openNotifications();
    expect(rowOf('APL-WEB-N2').textContent).toContain('Maria Souza Lima');
  });

  it('narrows to one broker with a new reading, not a local slice', async () => {
    // A second broker, with no name in IN-01: the identifier is what shows.
    await issuePolicy('PRP-WEB-N3', 'APL-WEB-N3', 'broker-2');

    await openNotifications();
    expect(rows()).toHaveLength(3);

    await filterByRecipient('Corretora Alfa');

    expect(requests).toContain('GET /notifications?recipientId=broker-1');
    expect(rows()).toHaveLength(2);
    expect(rowOf('APL-WEB-N1')).toBeDefined();

    await filterByRecipient('broker-2');
    expect(requests).toContain('GET /notifications?recipientId=broker-2');
    expect(rows()).toHaveLength(1);
    expect(rowOf('APL-WEB-N3').textContent).toContain('broker-2');
  });

  it('offers only the brokers that were notified, and keeps the full list', async () => {
    await openNotifications();
    await filterByRecipient('broker-2');

    // The options come from the complete reading, so narrowing does not
    // shrink the filter itself: the operator can always go back.
    const labels = [...document.querySelector('#recipient').options].map(
      (option: Untyped) => option.textContent,
    );
    // Ordered by the label a human reads, not by the identifier.
    expect(labels).toEqual(['Todos os corretores', 'broker-2', 'Corretora Alfa']);

    await filterByRecipient('Todos os corretores');
    expect(requests).toContain('GET /notifications');
    expect(rows()).toHaveLength(3);
  });

  it('carries the reader from the notification to the policy it is about', async () => {
    await openNotifications();

    const link = rowOf('APL-WEB-N1').querySelector('a.btn');
    const [notified] = (await callApi('GET', '/notifications?recipientId=broker-1')).filter(
      (notification: Untyped) => notification.policyNumber === 'APL-WEB-N1',
    );

    expect(link.getAttribute('href')).toBe(`/app/policies/detail.html?id=${notified.policyId}`);

    // FP-01 step 8: the policy is what the broker forwards to the insured, so
    // the notification has to land on it and not on a dead end.
    await followToPolicy(rowOf('APL-WEB-N1'));
    expect(text('#page')).toContain('APL-WEB-N1');
  });

  it('writes nothing: the screen only reads (REQ-105)', async () => {
    await openNotifications();
    await filterByRecipient('Corretora Alfa');

    // A notification is produced by FP-01 step 7 and by nothing else. If this
    // page could create, edit or dismiss one, the record would stop being
    // evidence of what happened.
    expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(document.querySelector('#list button')).toBeNull();
  });
});
