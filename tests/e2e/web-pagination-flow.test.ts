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
 * REQ-330 to REQ-333, CA-334: every listing in pages, driven the way an
 * operator drives it — the total of records, the page numbers, the next page,
 * and the choice of 25, 50 or 100 per page.
 *
 * One database for the file, built through the API: 80 businesses, 54 with CT
 * integral and 26 parcelled, each with its own client and its policy; 27 of
 * the integral ones made eligible. Every listing then has more lines than one
 * page of 25 holds.
 *
 * Nothing here is a mock: the real server over SQLite on disk, and the page
 * modules the browser downloads.
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
/** REQ-307: the one broker every business names. */
let brokerId: string;

/** Every request a page made, in order, as `METHOD path`. */
const requests: string[] = [];

const BUSINESSES = 80;
const PARCELLED = 26;
const ELIGIBLE = 27;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-pages-'));
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

  const policies: string[] = [];
  for (let n = 1; n <= BUSINESSES; n++) {
    const parcelled = n > BUSINESSES - PARCELLED;
    const number = String(n).padStart(2, '0');
    const proposal = await callApi('POST', '/proposals', {
      client: clientNamed(`Cliente Página ${number}`),
      brokerId,
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      proposalNumber: `PRP-PG-${number}`,
      netPremium: '1200.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      installments: parcelled ? [{ amount: '600.00' }, { amount: '600.00' }] : [],
      workedCommission: parcelled ? '100' : '20',
      subsequentWorkedCommission: parcelled ? '30' : null,
      workedCommissionMode: parcelled ? 'PARCELLED' : 'INTEGRAL',
      intermediary: null,
    });
    const policy = await callApi(
      'POST',
      '/policies',
      recognitionBody(proposal.id, `APL-PG-${number}`),
    );
    policies.push(policy.id);
  }
  for (const policyId of policies.slice(0, ELIGIBLE)) {
    await callApi('POST', `/policies/${policyId}/payout`, { rate: '50' });
    await callApi('POST', `/policies/${policyId}/payout/eligibility`, {});
  }

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

async function callApi(method: string, apiPath: string, body?: unknown): Promise<Untyped> {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status >= 400) {
    throw new Error(`${method} ${apiPath}: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : await response.json();
}

/* ----------------------------------------------------------- the pages -- */

async function openPage(relativePath: string, search = ''): Promise<void> {
  vi.resetModules();
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath}${search}`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  await import(`/app/${relativePath.replace('index.html', 'index.js')}`);
}

function rowsOf(listing: string): Untyped[] {
  return [...document.querySelectorAll(`${listing} tbody tr`)];
}

function pagerOf(listing: string): Untyped {
  return document.querySelector(`${listing} .pager`);
}

async function shown(listing: string, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(pagerOf(listing)).not.toBeNull();
    expect(rowsOf(listing)).toHaveLength(count);
  });
}

function pageButton(listing: string, label: string): Untyped {
  return pagerOf(listing).querySelector(`button[aria-label="${label}"]`);
}

/**
 * CA-330, CA-331 on one listing: the first page of 50 with the total, 25 per
 * page when chosen, then the second page of 25 — each one a new reading.
 */
async function pagesThrough(listing: string, endpoint: string, total: number): Promise<void> {
  await shown(listing, Math.min(total, 50));
  expect(pagerOf(listing).textContent).toContain(`${total} registros`);
  expect(pageButton(listing, 'Página anterior').disabled).toBe(true);

  const size = pagerOf(listing).querySelector('select[name="pageSize"]');
  expect([...size.options].map((option: Untyped) => option.value)).toEqual(['25', '50', '100']);
  expect(size.value).toBe('50');
  size.value = '25';
  size.dispatchEvent(new window.Event('change'));
  await shown(listing, 25);
  expect(requests.some((request) => request.startsWith(`GET ${endpoint}?size=25`))).toBe(true);
  expect(pageButton(listing, `Página ${Math.ceil(total / 25)}`)).not.toBeNull();

  const firstOfPageOne = rowsOf(listing)[0].textContent;
  pageButton(listing, 'Página 2').click();
  // The lines of the second page, not the first one still on screen.
  await vi.waitFor(() => {
    expect(rowsOf(listing)[0]?.textContent).not.toBe(firstOfPageOne);
  });
  await shown(listing, Math.min(25, total - 25));
  expect(
    requests.some((request) => request.includes('page=2') && request.includes('size=25')),
  ).toBe(true);
  expect(pageButton(listing, 'Página 2').getAttribute('aria-current')).toBe('page');
}

describe('the listings in pages, through the screens (REQ-330 to REQ-333, CA-334)', () => {
  it('pages the proposals', async () => {
    await openPage('proposals/index.html');
    // The first tab is the proposals awaiting issuance: every one is issued here.
    const all = [...document.querySelectorAll('[data-tab]')].find(
      (tab: Untyped) => tab.textContent.trim() === 'Todas',
    );
    all?.click();
    await pagesThrough('#list', '/proposals', BUSINESSES);
  });

  it('pages the policies, and a new filter goes back to the first page (REQ-333)', async () => {
    await openPage('policies/index.html');
    await pagesThrough('#list', '/policies', BUSINESSES);

    const search = document.querySelector('#client-search');
    search.value = 'Página 07';
    search.dispatchEvent(new window.Event('input'));
    await shown('#list', 1);
    expect(pagerOf('#list').textContent).toContain('1 registro');
    expect(requests.at(-1)).toBe('GET /policies?client=P%C3%A1gina+07&size=25');
  });

  it('pages the agreed commissions', async () => {
    await openPage('commissions/index.html');
    await pagesThrough('#list', '/commissions', BUSINESSES - PARCELLED);
  });

  it('pages the three listings of the payout, each on its own', async () => {
    await openPage('payouts/index.html');
    await pagesThrough(
      '#without-rate',
      '/payouts/policies-without-rate',
      BUSINESSES - PARCELLED - ELIGIBLE,
    );
    await pagesThrough('#parcelled', '/payouts/parcelled-policies', PARCELLED);
    await pagesThrough('#eligible', '/payouts/eligible', ELIGIBLE);
  });

  it('pages the clients', async () => {
    await openPage('clients/index.html');
    await pagesThrough('#list-clients', '/clients', BUSINESSES);
  });

  it('pages the notifications', async () => {
    await openPage('notifications/index.html');
    await pagesThrough('#list', '/notifications', BUSINESSES);
  });

  it('keeps the page in the address, and opens on the page the address asks for', async () => {
    await openPage('policies/index.html', '?page=2&size=25');
    await shown('#list', 25);
    expect(requests).toContain('GET /policies?page=2&size=25');
    expect(pageButton('#list', 'Página 2').getAttribute('aria-current')).toBe('page');

    // Each choice is written into the address, so going back lands on it.
    pageButton('#list', 'Página 3').click();
    await vi.waitFor(() => expect(window.location.search).toBe('?page=3&size=25'));
    await shown('#list', 25);
    const size = pagerOf('#list').querySelector('select[name="pageSize"]');
    size.value = '50';
    size.dispatchEvent(new window.Event('change'));
    // The first page of 50 is the default and goes unsaid.
    await vi.waitFor(() => expect(window.location.search).toBe(''));
  });

  it('reads a page the address gets wrong as the first one, and past the last as the last', async () => {
    await openPage('clients/index.html', '?page=abc&size=7');
    await shown('#list-clients', 50);
    expect(pageButton('#list-clients', 'Página 1').getAttribute('aria-current')).toBe('page');

    await openPage('clients/index.html', '?page=99&size=25');
    await vi.waitFor(() =>
      expect(pageButton('#list-clients', 'Página 4')?.getAttribute('aria-current')).toBe('page'),
    );
    expect(rowsOf('#list-clients')).toHaveLength(BUSINESSES - 75);
  });

  it('keeps apart the pages of the three listings of the payout', async () => {
    await openPage('payouts/index.html', '?eligiblePage=2&eligibleSize=25');
    await shown('#eligible', ELIGIBLE - 25);
    await shown('#without-rate', BUSINESSES - PARCELLED - ELIGIBLE);
    expect(requests).toContain('GET /payouts/eligible?page=2&size=25');
    expect(requests).toContain('GET /payouts/policies-without-rate');
  });
});

describe('the filters in the address', () => {
  it('opens the policies with the cut the address asks for, and writes each new one there', async () => {
    await openPage('policies/index.html', '?client=P%C3%A1gina+07');
    await shown('#list', 1);
    expect(document.querySelector('#client-search').value).toBe('Página 07');
    expect(requests).toContain('GET /policies?client=P%C3%A1gina+07');

    const renewal = document.querySelector('#renewal-until');
    renewal.value = '2027-10-01';
    renewal.dispatchEvent(new window.Event('change'));
    await vi.waitFor(() => {
      const address = new URLSearchParams(window.location.search);
      expect(address.get('renewalUntil')).toBe('2027-10-01');
      expect(address.get('client')).toBe('Página 07');
    });
  });

  it('opens the proposals on the tab and the client of the address', async () => {
    await openPage('proposals/index.html', '?tab=all&client=P%C3%A1gina+0');
    await shown('#list', 9);
    expect(document.querySelector('[data-tab="all"]').getAttribute('aria-selected')).toBe('true');
    expect(requests).toContain('GET /proposals?client=P%C3%A1gina+0');
  });

  it('opens the agreed commissions on the tab of the address', async () => {
    await openPage('commissions/index.html', '?tab=forecast');
    await shown('#list', 50);
    expect(requests).toContain('GET /commissions?status=FORECAST');
  });

  it('opens the clients with the search of the address', async () => {
    await openPage('clients/index.html', '?q=P%C3%A1gina+1');
    await shown('#list-clients', 10);
    expect(document.querySelector('[name="q"]').value).toBe('Página 1');
  });

  it('opens the notifications of the recipient of the address, chosen in the filter', async () => {
    await openPage('notifications/index.html', `?recipientId=${brokerId}`);
    await shown('#list', 50);
    expect(requests).toContain(`GET /notifications?recipientId=${brokerId}`);
    await vi.waitFor(() => expect(document.querySelector('#recipient').value).toBe(brokerId));
  });

  it('opens the eligible commissions with their filters and their page, apart from the other listings', async () => {
    await openPage('payouts/index.html', '?broker=alfa&eligiblePage=2&eligibleSize=25');
    await shown('#eligible', ELIGIBLE - 25);
    expect(document.querySelector('#eligible-filters [name="broker"]').value).toBe('alfa');
    expect(requests).toContain('GET /payouts/eligible?broker=alfa&page=2&size=25');
    expect(requests).toContain('GET /payouts/policies-without-rate');
  });
});
