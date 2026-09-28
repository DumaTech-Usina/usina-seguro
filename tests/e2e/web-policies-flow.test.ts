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
 * OUT-03 and OUT-04 driven the way an operator drives them: the control of the
 * policies the Usina sold, and the cut by renewal date REQ-055 asks for.
 *
 * Until this listing existed a policy was only reachable from the proposal that
 * originated it, or by an id typed by hand. This file walks the loop that
 * closes that gap — open the listing, see what was sold, narrow it to what
 * renews up to a day, and follow a line into the policy where the work is done.
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-policies-'));
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

  // Three businesses registered out of the order they renew in, so a listing
  // that never sorted anything would show them in the order they were written.
  await registeredPolicy('PRP-MID', 'PRP-MID', '2027-06-30');
  await registeredPolicy('PRP-LAST', 'PRP-LAST', '2027-09-30');
  await registeredPolicy('PRP-FIRST', 'PRP-FIRST', '2027-01-14');
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
 * Opens the listing and waits for the first reading to land.
 *
 * The module registry is reset first because a page opened twice in one journey
 * is loaded twice by the browser, and a cached module would leave the screen
 * showing the skeleton of a page that never ran.
 */
async function openListing(): Promise<void> {
  vi.resetModules();
  openPage('policies/index.html');
  await import('/app/policies/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

/** Informs the renewal cut-off the way an operator does: on the date field. */
async function renewUntil(day: string): Promise<void> {
  const field = document.querySelector('#renewal-until');
  field.value = day;
  field.dispatchEvent(new window.Event('change'));

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

function rows(): Untyped[] {
  return [...document.querySelectorAll('#list tbody tr')];
}

function numbersOnScreen(): string[] {
  return rows().map((row: Untyped) => row.querySelector('.policy-number').textContent);
}

/** The line of a policy, found by the number that identifies it (REQ-020). */
function rowOf(policyNumber: string): Untyped {
  const found = rows().find(
    (row: Untyped) => row.querySelector('.policy-number')?.textContent === policyNumber,
  );

  if (found === undefined) {
    throw new Error(`No line for ${policyNumber} on screen.`);
  }
  return found;
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** Opens the policy screen the way the listing hands it over: by its link. */
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

/** A business the way FP-01 leaves it: proposal accepted, policy registered. */
async function registeredPolicy(
  proposalNumber: string,
  policyNumber: string,
  renewalDate: string,
): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: `client-${policyNumber}`,
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber: proposalNumber,
    netPremium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: renewalDate,
    installments: [{ amount: '1200.00', dueDate: '2026-10-10' }],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    userId: 'operator',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    userId: 'operator',
  });

  return policy.id as string;
}

/* -------------------------------------------------------------- tests -- */

describe('the policy listing (OUT-03, OUT-04)', () => {
  it('shows the policies sold, nearest renewal first (REQ-020, REQ-055)', async () => {
    await openListing();

    expect(requests).toContain('GET /policies');
    // The order is the renewal order, not the order they were registered in.
    expect(numbersOnScreen()).toEqual(['PRP-FIRST', 'PRP-MID', 'PRP-LAST']);

    const first = rowOf('PRP-FIRST');
    // REQ-020: coverage, premium and state, which is what OUT-03 asks for.
    expect(first.textContent).toContain('01/10/2026');
    expect(first.textContent).toContain('14/01/2027');
    expect(first.textContent).toContain('R$ 1.200,00');
    expect(first.textContent).toContain('Vigente');
    // REQ-050, REQ-022: what identifies the business to a human.
    expect(first.textContent).toContain('PRP-FIRST');
    expect(first.textContent).toContain('client-PRP-FIRST');
    expect(first.textContent).toContain('insurer-1');

    expect(text('#summary')).toContain('3 apólices');
  });

  it('narrows to what renews up to the informed day, as a new reading', async () => {
    await openListing();

    await renewUntil('2027-06-30');

    // CA-032: the window is asked of the backend, not sliced out of the page,
    // and the day informed is inside it.
    expect(requests).toContain('GET /policies?renewalUntil=2027-06-30');
    expect(numbersOnScreen()).toEqual(['PRP-FIRST', 'PRP-MID']);
    expect(text('#summary')).toContain('2 apólices');
    expect(text('#summary')).toContain('Renovam até 30/06/2027');

    // REQ-055: what renews after the day asked about is out, not hidden — the
    // full listing is one click away and brings it back.
    document.querySelector('#clear').click();
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(requests.at(-1)).toBe('GET /policies');
  });

  it('says so when nothing renews until the informed day', async () => {
    await openListing();

    await renewUntil('2026-12-31');

    expect(rows()).toHaveLength(0);
    expect(text('#list')).toContain('Nenhuma apólice renova até essa data');
    // The listing is empty, not broken: the operator is told what to do next.
    expect(text('#list')).toContain('data mais distante');
  });

  it('carries the operator from the listing into the policy itself', async () => {
    await openListing();
    await renewUntil('2027-06-30');

    await followToPolicy(rowOf('PRP-MID'));

    // The line landed on the policy it named, with the screen that operates it:
    // schedule, agreed versus real commission and the broker transfer.
    expect(text('#page')).toContain('PRP-MID');
    expect(text('#page')).toContain('PRP-MID');
    expect(text('#page')).toContain('Parcelas');
    expect(requests.some((request) => /^GET \/policies\/[^?]+$/.test(request))).toBe(true);
  });

  // A day the domain refuses (REQ-020) is not reachable from this screen: the
  // date field sanitises anything that is not a calendar day to empty, which
  // the page reads as "no window". The refusal itself is proved where it can
  // be driven honestly — `proposal-to-policy.test.ts` over HTTP, in Portuguese,
  // and `list-policies.test.ts` on the use case.
});
