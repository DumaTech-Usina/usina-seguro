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
 * FP-01 driven the way an operator drives it: through the pages.
 *
 * Nothing here is a mock. The server is the real one, listening on an ephemeral
 * port over SQLite on disk; the modules under test are the same files the
 * browser downloads, loaded into a DOM with the `/app/` prefix resolved to the
 * directory they are served from. What is asserted is behaviour on both sides:
 * what the screen shows, and what the backend stored because of it.
 *
 * The other e2e file covers the contract between the API and the static files
 * (that the pages are reachable and served as what they are). This one covers
 * the flow.
 */
const WEB_PUBLIC = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');

/**
 * The DOM is deliberately outside this project's type program: `tsconfig.json`
 * declares `lib: ["ES2023"]` because everything TypeScript checks here runs on
 * Node, and the browser code is plain `.js` served as it is. This file runs in
 * jsdom, so it reaches the document through one untyped handle instead of
 * pulling the whole DOM into the globals of every other file.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type Untyped = any;

const { document, window, DOMParser } = globalThis as Untyped;

let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

/** Every request the pages made, in order, as `METHOD path`. */
const requests: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-fp01-'));
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

  // The pages call the API by path, the way the browser does when the page and
  // the API share an origin. Here the origin is the test server.
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return nodeFetch(url, init);
  }) as typeof globalThis.fetch;

  // jsdom implements neither, and no assertion here depends on them.
  window.scrollTo = () => {};
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test loads its page fresh, so the module has to run again.
  vi.resetModules();
  requests.length = 0;
});

/* ----------------------------------------------------------- the pages -- */

/** Puts the page in the document exactly as it is on disk, with its query. */
function openPage(relativePath: string, search = ''): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath}${search}`);

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function field(form: string, name: string): Untyped {
  const input = document.querySelector(`${form} [name="${name}"]`);
  if (input === null) {
    throw new Error(`No field ${name} in ${form}.`);
  }
  return input;
}

function click(selector: string): void {
  document.querySelector(selector)?.click();
}

function submit(form: string): void {
  document.querySelector(form)?.dispatchEvent(new Event('submit', { cancelable: true }));
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

async function transmittedProposal(proposalNumber: string): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: '1200.00',
  });

  await callApi('POST', `/proposals/${proposal.id}/transmission`, {
    proposalNumber,
    workedCommission: '32.5',
  });

  return proposal.id;
}

/* -------------------------------------------------------------- tests -- */

describe('FP-01 through the web interface', () => {
  it('registers and transmits a proposal from the form (steps 3 and 4)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    field('#form-proposal', 'clientId').value = 'client-web';
    field('#form-proposal', 'brokerId').value = 'broker-1';
    field('#form-proposal', 'insurerId').value = 'insurer-1';
    field('#form-proposal', 'productId').value = 'auto';
    field('#form-proposal', 'paymentMethodId').value = 'bank-slip';
    field('#form-proposal', 'netPremium').value = '1200.00';
    // REQ-040: without it the domain refuses, which the next test exercises.
    field('#form-proposal', 'customerAccepted').checked = true;
    submit('#form-proposal');

    // The transmission panel only opens once the proposal exists.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-panel="2"]')?.className).not.toContain('hidden');
    });
    expect(requests).toContain('POST /proposals');

    field('#form-transmission', 'proposalNumber').value = 'PRP-WEB-1';
    field('#form-transmission', 'workedCommission').value = '32.5';
    submit('#form-transmission');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-WEB-1');
    });

    // What the screen says happened, the backend has to agree with.
    const [stored] = await callApi('GET', '/proposals?status=TRANSMITTED');
    expect(stored.proposalNumber).toBe('PRP-WEB-1');
    expect(stored.clientId).toBe('client-web');
    expect(stored.workedCommission).toBe('32.5');

    // And the page hands the operator the record it just created.
    const link = document.querySelector('#done-body a.btn--filled');
    expect(link?.href).toContain(`/app/proposals/detail.html?id=${stored.id}`);
  });

  it('shows the refusal the server rendered when a rule is broken (REQ-040)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    field('#form-proposal', 'clientId').value = 'client-x';
    field('#form-proposal', 'brokerId').value = 'broker-1';
    field('#form-proposal', 'insurerId').value = 'insurer-1';
    field('#form-proposal', 'productId').value = 'auto';
    field('#form-proposal', 'paymentMethodId').value = 'bank-slip';
    field('#form-proposal', 'netPremium').value = '1200.00';
    // The customer's acceptance is missing (CA-001, REJ-004).
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });

    // The sentence is the one src/i18n rendered, with the rule beside it.
    expect(snackbars()[0]).toContain('Proposta exige aceite do cliente registrado.');
    expect(snackbars()[0]).toContain('REQ-040');
    // The screen stayed on the step that was refused.
    expect(document.querySelector('[data-panel="2"]')?.className).toContain('hidden');
  });

  it('lists the proposals still open and filters by state (step 5, OUT-01)', async () => {
    const openId = await transmittedProposal('PRP-OPEN-1');
    // A draft: registered, not yet transmitted, so out of the open worklist.
    await callApi('POST', '/proposals', {
      clientId: 'client-draft',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'bank-slip',
      customerAccepted: true,
      netPremium: '800.00',
    });

    openPage('proposals/index.html');
    await import('/app/proposals/index.js');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#list tbody tr').length).toBeGreaterThan(0);
    });

    // The default worklist is the open one, and it asked the API for exactly that.
    expect(requests).toContain('GET /proposals?status=TRANSMITTED');
    const rows: Untyped[] = [...document.querySelectorAll('#list tbody tr')];
    expect(rows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('PRP-OPEN-1')]),
    );
    expect(rows.some((row) => row.textContent?.includes('client-draft'))).toBe(false);
    expect(text('#list')).toContain('Transmitida');

    // Each row reaches the record it lists.
    const open = document.querySelector('#list tbody a.btn');
    expect(open?.href).toContain('/app/proposals/detail.html?id=');

    // Switching the filter is a new read, not a client-side slice of the same one.
    click('[data-tab="draft"]');
    await vi.waitFor(() => {
      expect(text('#list')).toContain('client-draft');
    });
    expect(requests).toContain('GET /proposals?status=DRAFT');
    expect(text('#list')).not.toContain('PRP-OPEN-1');
    expect(openId).not.toBe('');
  });

  it('registers the policy from the proposal being tracked (step 6, acceptance)', async () => {
    const proposalId = await transmittedProposal('PRP-ACCEPT-1');

    openPage('proposals/detail.html', `?id=${proposalId}`);
    await import('/app/proposals/detail.js');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('PRP-ACCEPT-1');
    });
    // A transmitted proposal is the only one that offers an outcome.
    expect(document.querySelector('[data-panel="outcome"]')?.className).not.toContain('hidden');
    expect(document.querySelector('[data-panel="transmission"]')?.className).toContain('hidden');

    field('#form-policy', 'policyNumber').value = 'APL-WEB-1';
    field('#form-policy', 'premium').value = '1200.00';
    field('#form-policy', 'coverageStart').value = '2026-10-01';
    field('#form-policy', 'coverageEnd').value = '2027-09-30';
    field('#form-policy', 'renewalDate').value = '2027-09-30';
    click('#add-installment');
    const amounts: Untyped[] = [...document.querySelectorAll('#installments [name="amount"]')];
    const dates: Untyped[] = [...document.querySelectorAll('#installments [name="dueDate"]')];
    amounts[0].value = '600.00';
    dates[0].value = '2026-10-10';
    amounts[1].value = '600.00';
    dates[1].value = '2026-11-10';

    submit('#form-policy');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Apólice registrada');
    });

    expect(requests).toContain('POST /policies');
    expect(snackbars().some((message) => message.includes('APL-WEB-1'))).toBe(true);
    // The proposal now shows its outcome and no longer offers one.
    expect(text('#page')).toContain('Aceita');
    expect(document.querySelector('[data-panel="outcome"]')?.className).toContain('hidden');

    const policyLink = document.querySelector('a[href^="/app/policies/detail.html"]');
    expect(policyLink).not.toBeNull();
    const policyId = new URL(policyLink?.href ?? '', baseUrl).searchParams.get('id');

    // It crossed the whole way down: the policy and its schedule are stored,
    // and the proposal moved to ACCEPTED (REQ-111).
    const policy = await callApi('GET', `/policies/${policyId}`);
    expect(policy.policyNumber).toBe('APL-WEB-1');
    expect(policy.proposalNumber).toBe('PRP-ACCEPT-1');
    expect(policy.status).toBe('ACTIVE');
    expect(policy.installments).toHaveLength(2);
    expect(policy.installments[0].amount).toBe('600.00');

    const proposal = await callApi('GET', `/proposals/${proposalId}`);
    expect(proposal.status).toBe('ACCEPTED');
  });

  it('refuses a rejection with no reason and records one with it (step 6, refusal)', async () => {
    const proposalId = await transmittedProposal('PRP-REJECT-1');

    openPage('proposals/detail.html', `?id=${proposalId}`);
    await import('/app/proposals/detail.js');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('PRP-REJECT-1');
    });

    click('[data-outcome="reject"]');
    expect(document.querySelector('#form-rejection')?.className).not.toContain('hidden');

    // REQ-045 / REJ-003: the reason is mandatory, and it is the domain that says so.
    submit('#form-rejection');
    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain('Recusa de proposta exige motivo.');
    expect(snackbars()[0]).toContain('REQ-045');
    expect((await callApi('GET', `/proposals/${proposalId}`)).status).toBe('TRANSMITTED');

    field('#form-rejection', 'reason').value = 'perfil de risco';
    submit('#form-rejection');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Proposta recusada');
    });
    // REQ-046, ITP-004: the record stays, with the reason on it.
    expect(text('#page')).toContain('perfil de risco');
    expect(document.querySelector('[data-panel="outcome"]')?.className).toContain('hidden');

    const proposal = await callApi('GET', `/proposals/${proposalId}`);
    expect(proposal.status).toBe('REJECTED');
    expect(proposal.rejectionReason).toBe('perfil de risco');
  });
});
