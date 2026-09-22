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
 * FP-01 of V2, from the registration of the proposal up to — not including —
 * the recognition of issuance, driven the way an operator drives it: through
 * the pages.
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

/** The registration body of a V2 proposal awaiting issuance, over the API. */
function proposalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    proposalNumber: 'PRP-API',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    userId: 'ana.souza',
    ...overrides,
  };
}

async function awaitingProposal(overrides: Record<string, unknown> = {}): Promise<string> {
  const proposal = await callApi('POST', '/proposals', proposalBody(overrides));
  return proposal.id;
}

/** Fills the registration form of `new.html` with a complete, valid proposal. */
function fillRegistration(): void {
  field('#form-proposal', 'clientId').value = 'client-web';
  field('#form-proposal', 'brokerId').value = 'broker-1';
  field('#form-proposal', 'insurerId').value = 'insurer-1';
  field('#form-proposal', 'productId').value = 'auto';
  field('#form-proposal', 'paymentMethodId').value = 'bank-slip';
  field('#form-proposal', 'customerAccepted').checked = true;
  field('#form-proposal', 'proposalNumber').value = 'PRP-WEB-1';
  field('#form-proposal', 'netPremium').value = '100.00';
  field('#form-proposal', 'coverageStart').value = '2026-10-01';
  field('#form-proposal', 'coverageEnd').value = '2027-10-01';
  field('#form-proposal', 'workedCommission').value = '20';
  field('#form-proposal', 'workedCommissionMode').value = 'INTEGRAL';
  field('#form-proposal', 'userId').value = 'ana.souza';
}

function choose(form: string, name: string, value: string): void {
  const select = field(form, name);
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

async function openProposal(id: string): Promise<void> {
  vi.resetModules();
  openPage('proposals/detail.html', `?id=${id}`);
  await import('/app/proposals/detail.js');
  await vi.waitFor(() => {
    expect(document.querySelector('.stage-strip')).not.toBeNull();
  });
}

function hidden(selector: string): boolean {
  return document.querySelector(selector)?.classList.contains('hidden') ?? true;
}

/* -------------------------------------------------------------- tests -- */

describe('FP-01 through the web interface', () => {
  it('registers a proposal awaiting issuance from one form (steps 1 to 6)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    fillRegistration();
    // REQ-204, FA-205: one installment, with no due date.
    click('#add-installment');
    field('#installments', 'amount').value = '100.00';
    // REQ-220, REQ-221: through the one intermediary, with its CTU.
    choose('#form-proposal', 'receiptKind', 'INTERMEDIARY');
    field('#form-proposal', 'intermediaryId').value = 'intermediary-1';
    field('#form-proposal', 'ctu').value = '50';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-WEB-1');
    });
    expect(requests).toContain('POST /proposals');
    // REQ-232, CA-203: the expected value, before any issuance.
    expect(text('#done-body')).toContain('R$ 10,00');

    // What the screen says happened, the backend has to agree with.
    const [stored] = await callApi('GET', '/proposals?status=AWAITING_ISSUANCE');
    expect(stored).toMatchObject({
      proposalNumber: 'PRP-WEB-1',
      clientId: 'client-web',
      coverageEnd: '2027-10-01',
      renewalDate: '2027-10-01',
      installments: [{ number: 1, amount: '100.00', dueDate: null }],
      workedCommission: '20',
      workedCommissionMode: 'INTEGRAL',
      intermediaryId: 'intermediary-1',
      ctu: '50',
      expectedReceipt: { intermediary: '20.00', usina: '10.00' },
    });
    expect(stored.workedCommissionHistory[0].informedBy).toBe('ana.souza');

    const link = document.querySelector('#done-body a.btn--filled');
    expect(link?.href).toContain(`/app/proposals/detail.html?id=${stored.id}`);
  });

  it('asks for the CTU only when the receipt goes through an intermediary (REQ-221)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    expect(hidden('#intermediary-fields')).toBe(true);

    choose('#form-proposal', 'receiptKind', 'INTERMEDIARY');
    expect(hidden('#intermediary-fields')).toBe(false);
    // The field explains how the percentage affects what the Usina receives.
    expect(text('#intermediary-fields')).toContain('sobre o valor que a intermediária recebe');

    choose('#form-proposal', 'receiptKind', 'DIRECT');
    expect(hidden('#intermediary-fields')).toBe(true);
  });

  it('shows the refusal the server rendered when an intermediary has no CTU (REJ-202)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    fillRegistration();
    choose('#form-proposal', 'receiptKind', 'INTERMEDIARY');
    field('#form-proposal', 'intermediaryId').value = 'intermediary-1';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain(
      'Com intermediária, a CTU (comissão trabalhada da Usina) é obrigatória.',
    );
    expect(snackbars()[0]).toContain('REQ-221');
    expect(hidden('[data-panel="done"]')).toBe(true);
  });

  it('shows the refusal the server rendered without the customer acceptance (REQ-040)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    fillRegistration();
    field('#form-proposal', 'customerAccepted').checked = false;
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain('Proposta exige aceite do cliente registrado.');
    expect(snackbars()[0]).toContain('REQ-040');
  });

  it('lists the proposals awaiting issuance with the expected value, and filters by state', async () => {
    await awaitingProposal({ proposalNumber: 'PRP-OPEN-1' });
    const refusedId = await awaitingProposal({ proposalNumber: 'PRP-REFUSED-1' });
    await callApi('POST', `/proposals/${refusedId}/rejection`, { reason: 'perfil de risco' });

    openPage('proposals/index.html');
    await import('/app/proposals/index.js');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#list tbody tr').length).toBeGreaterThan(0);
    });

    // The default worklist is what awaits issuance, asked for by state.
    expect(requests).toContain('GET /proposals?status=AWAITING_ISSUANCE');
    expect(text('#list')).toContain('PRP-OPEN-1');
    expect(text('#list')).toContain('R$ 20,00');
    expect(text('#list')).toContain('Aguardando emissão');
    expect(text('#list')).not.toContain('PRP-REFUSED-1');

    const open = document.querySelector('#list tbody a.btn');
    expect(open?.href).toContain('/app/proposals/detail.html?id=');

    click('[data-tab="rejected"]');
    await vi.waitFor(() => {
      expect(text('#list')).toContain('PRP-REFUSED-1');
    });
    expect(requests).toContain('GET /proposals?status=REJECTED');
    expect(text('#list')).toContain('perfil de risco');
  });

  it('shows everything the proposal holds and who informed it (REQ-202, REQ-215, CA-203)', async () => {
    const id = await awaitingProposal({
      proposalNumber: 'PRP-SHOW-1',
      installments: [{ amount: '100.00', dueDate: '2026-10-10' }],
      intermediary: { intermediaryId: 'intermediary-1', ctu: '50' },
    });

    await openProposal(id);

    const page = text('#page');
    expect(page).toContain('PRP-SHOW-1');
    expect(page).toContain('01/10/2026');
    // REQ-203: the renewal is the end of coverage.
    expect(text('[data-definition="renewal"]')).toContain('01/10/2027');
    expect(page).toContain('10/10/2026');
    expect(text('[data-definition="workedCommission"]')).toContain('20%');
    expect(text('[data-definition="workedCommission"]')).toContain('Integral');
    expect(text('[data-definition="receipt"]')).toContain('intermediary-1');
    expect(text('[data-definition="receipt"]')).toContain('50%');
    expect(text('#expected')).toContain('R$ 20,00');
    expect(text('#expected')).toContain('R$ 10,00');
    expect(text('#history')).toContain('ana.souza');
  });

  it('corrects the CT and its mode before issuance, signed (FA-203, CA-204, CA-217)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-CT-1' });
    await openProposal(id);

    expect(hidden('[data-panel="corrections"]')).toBe(false);

    field('#form-worked-commission', 'workedCommission').value = '25';
    field('#form-worked-commission', 'workedCommissionMode').value = 'PARCELLED';
    field('#form-worked-commission', 'userId').value = 'bruno.lima';
    submit('#form-worked-commission');

    await vi.waitFor(() => {
      expect(text('#expected')).toContain('R$ 25,00');
    });
    expect(requests).toContain(`POST /proposals/${id}/worked-commission`);
    expect(text('[data-definition="workedCommission"]')).toContain('Parcelada');
    // REQ-215, REQ-124: both entries, each with its author.
    expect(text('#history')).toContain('ana.souza');
    expect(text('#history')).toContain('bruno.lima');

    const stored = await callApi('GET', `/proposals/${id}`);
    expect(stored.workedCommissionHistory.map((entry: Untyped) => entry.informedBy)).toEqual([
      'ana.souza',
      'bruno.lima',
    ]);
  });

  it('refuses an unsigned correction with the sentence the server rendered (REQ-216)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-CT-2' });
    await openProposal(id);

    field('#form-worked-commission', 'workedCommission').value = '25';
    field('#form-worked-commission', 'userId').value = '  ';
    submit('#form-worked-commission');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain('Informe quem está registrando esta informação.');
    expect((await callApi('GET', `/proposals/${id}`)).workedCommission).toBe('20');
  });

  it('declares and then removes the intermediary before issuance (FA-204, FA-209, CA-214)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-INT-1' });
    await openProposal(id);

    choose('#form-receipt', 'receiptKind', 'INTERMEDIARY');
    field('#form-receipt', 'intermediaryId').value = 'intermediary-1';
    field('#form-receipt', 'ctu').value = '50';
    field('#form-receipt', 'userId').value = 'bruno.lima';
    submit('#form-receipt');

    await vi.waitFor(() => {
      expect(text('#expected')).toContain('R$ 10,00');
    });
    expect(text('[data-definition="receipt"]')).toContain('intermediary-1');

    choose('#form-receipt', 'receiptKind', 'DIRECT');
    field('#form-receipt', 'userId').value = 'bruno.lima';
    submit('#form-receipt');

    await vi.waitFor(() => {
      expect(text('[data-definition="receipt"]')).toContain('Direto da seguradora');
    });
    expect(text('#expected')).toContain('R$ 20,00');
    expect(text('#expected')).not.toContain('R$ 10,00');

    const stored = await callApi('GET', `/proposals/${id}`);
    expect(stored.receiptHistory.map((entry: Untyped) => entry.intermediaryId)).toEqual([
      null,
      'intermediary-1',
      null,
    ]);
  });

  it('refuses a rejection with no reason, records one with it, and then offers nothing (REQ-253)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-REJECT-1' });
    await openProposal(id);

    click('[data-outcome="reject"]');
    expect(hidden('#form-rejection')).toBe(false);

    // REJ-208: the reason is mandatory, and it is the domain that says so.
    submit('#form-rejection');
    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain('Recusa de proposta exige motivo.');
    expect(snackbars()[0]).toContain('REQ-253');
    expect((await callApi('GET', `/proposals/${id}`)).status).toBe('AWAITING_ISSUANCE');

    field('#form-rejection', 'reason').value = 'perfil de risco';
    submit('#form-rejection');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Proposta recusada');
    });
    expect(text('#page')).toContain('perfil de risco');
    // REJ-212: a refused proposal is final — no correction, no outcome.
    expect(hidden('[data-panel="outcome"]')).toBe(true);
    expect(hidden('[data-panel="corrections"]')).toBe(true);

    const stored = await callApi('GET', `/proposals/${id}`);
    expect(stored.status).toBe('REJECTED');
    expect(stored.rejectionReason).toBe('perfil de risco');
  });

  it('still registers the V1 policy from a proposal awaiting issuance (bridge)', async () => {
    const proposalId = await awaitingProposal({ proposalNumber: 'PRP-ACCEPT-1' });
    await openProposal(proposalId);

    field('#form-policy', 'policyNumber').value = 'APL-WEB-1';
    field('#form-policy', 'premium').value = '100.00';
    field('#form-policy', 'coverageStart').value = '2026-10-01';
    field('#form-policy', 'coverageEnd').value = '2027-09-30';
    field('#form-policy', 'renewalDate').value = '2027-09-30';
    const amounts: Untyped[] = [
      ...document.querySelectorAll('#policy-installments [name="amount"]'),
    ];
    const dates: Untyped[] = [
      ...document.querySelectorAll('#policy-installments [name="dueDate"]'),
    ];
    amounts[0].value = '100.00';
    dates[0].value = '2026-10-10';
    submit('#form-policy');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Apólice registrada');
    });
    expect(requests).toContain('POST /policies');
    expect(hidden('[data-panel="outcome"]')).toBe(true);
    expect(hidden('[data-panel="corrections"]')).toBe(true);

    const proposal = await callApi('GET', `/proposals/${proposalId}`);
    expect(proposal.status).toBe('ISSUED');
  });
});

/**
 * The commercial progression the operator reads: Cotação → Proposta → Apólice.
 *
 * Three stages of a business, not three states of one record. What this group
 * protects is that each screen says which stage the record is in, and that
 * the three are reachable from one another.
 */
describe('the commercial progression on screen', () => {
  /** The stage marked `current` on the strip, and the sentence under it. */
  function stage(): { current: string; note: string } {
    const current = document.querySelector('.stage-strip .step[data-state="current"]');
    return {
      current: current?.dataset.stage ?? '',
      note: text('.stage-strip__note'),
    };
  }

  it('shows a business waiting for the insurer to issue the proposal', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-STAGE-1' });

    await openProposal(id);

    expect(stage().current).toBe('proposal');
    expect(stage().note).toBe('Aguardando proposta ser emitida pela seguradora.');
    expect(text('#page')).toContain('Aguardando emissão');
    // Cotação is shown as a stage of the business, and as one this system
    // does not hold.
    const quote = document.querySelector('.stage-strip .step[data-stage="quote"]');
    expect(quote?.textContent).toContain('Cotação');
    expect(quote?.textContent).toContain('fora do sistema');
    expect(quote?.dataset.state).toBeUndefined();
  });

  it('carries the issued proposal into the policy stage, both ways', async () => {
    const proposalId = await awaitingProposal({ proposalNumber: 'PRP-STAGE-3' });
    const policy = await callApi('POST', '/policies', {
      proposalId,
      policyNumber: 'APL-STAGE-3',
      premium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      installments: [{ number: 1, amount: '100.00', dueDate: '2026-10-10' }],
    });

    await openProposal(proposalId);
    expect(stage().current).toBe('policy');
    expect(stage().note).toBe('Proposta emitida: o negócio evoluiu para apólice.');
    expect(text('#page')).toContain('Emitida');

    // On the policy: the third stage, and the way back to where it came from.
    vi.resetModules();
    openPage('policies/detail.html', `?id=${policy.id}`);
    await import('/app/policies/detail.js');
    await vi.waitFor(() => {
      expect(document.querySelector('.stage-strip')).not.toBeNull();
    });

    expect(stage().current).toBe('policy');
    const origin: Untyped = document.querySelector('.policy-head__origin');
    expect(origin.textContent).toContain('PRP-STAGE-3');
    expect(origin.getAttribute('href')).toBe(`/app/proposals/detail.html?id=${proposalId}`);
  });

  it('names the filters after the states of REQ-250', async () => {
    vi.resetModules();
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.filters__option').length).toBeGreaterThan(0);
    });

    const labels = [...document.querySelectorAll('.filters__option')].map(
      (tab: Untyped) => tab.textContent,
    );
    expect(labels).toEqual(['Aguardando emissão', 'Emitidas', 'Recusadas', 'Todas']);
  });
});
