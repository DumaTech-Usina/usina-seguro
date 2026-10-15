// @vitest-environment jsdom

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { chooseBroker, registerBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { type SignedIn, TEST_USER, signIn } from './support/sign-in.ts';

/**
 * FP-01 of V2, from the registration of the proposal up to its outcome — the
 * refusal or the recognition of issuance, which creates the policy — driven
 * the way an operator drives it: through the pages.
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
/** REQ-307: the registered broker the proposals name. */
let brokerId: string;
let signedIn: SignedIn;

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

  // REQ-410: every journey starts logged in, as the test user.
  signedIn = await signIn(application.useCases, baseUrl);
  brokerId = await registerBroker(baseUrl, 'Corretora Alfa', 1);

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
    client: clientNamed('client-1'),
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-API',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    ...overrides,
  };
}

async function awaitingProposal(overrides: Record<string, unknown> = {}): Promise<string> {
  const proposal = await callApi('POST', '/proposals', proposalBody(overrides));
  return proposal.id;
}

/**
 * Fills the registration form of `new.html` with a complete, valid proposal;
 * the broker is searched and chosen, as the operator does (REQ-306, REQ-307).
 */
async function fillRegistration(): Promise<void> {
  await chooseBroker(document, window, 'alfa', 'Corretora Alfa');
  // REQ-317: name and CPF of the client, typed; a new CPF registers the client.
  field('#form-proposal', 'clientName').value = 'Maria Web';
  field('#form-proposal', 'clientCpf').value = '529.982.247-25';
  field('#form-proposal', 'insurerId').value = 'insurer-1';
  field('#form-proposal', 'productId').value = 'auto';
  field('#form-proposal', 'paymentMethodId').value = 'bank-slip';
  field('#form-proposal', 'proposalNumber').value = 'PRP-WEB-1';
  field('#form-proposal', 'netPremium').value = '100.00';
  field('#form-proposal', 'coverageStart').value = '2026-10-01';
  field('#form-proposal', 'coverageEnd').value = '2027-10-01';
  field('#form-proposal', 'workedCommission').value = '20';
  field('#form-proposal', 'workedCommissionMode').value = 'INTEGRAL';
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
    // REQ-216: the registration is signed by the session; nobody types who signs.
    expect(document.querySelector('#form-proposal [name="userId"]')).toBeNull();

    await fillRegistration();
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
      coverageEnd: '2027-10-01',
      renewalDate: '2027-10-01',
      installments: [{ number: 1, amount: '100.00', dueDate: null }],
      workedCommission: '20',
      workedCommissionMode: 'INTEGRAL',
      intermediaryId: 'intermediary-1',
      ctu: '50',
      expectedReceipt: { intermediary: '20.00', usina: '10.00' },
    });
    expect(stored.workedCommissionHistory[0].informedBy).toBe(signedIn.user.id);
    expect(await callApi('GET', `/clients/${stored.clientId}`)).toMatchObject({
      name: 'Maria Web',
      cpf: '52998224725',
      history: [{ signedBy: signedIn.user.id }],
    });

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

    await fillRegistration();
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

  it('does not ask for the customer acceptance, which the proposal no longer holds (REQ-201)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    expect(document.querySelector('#form-proposal [name="customerAccepted"]')).toBeNull();
    expect(text('#form-proposal')).not.toContain('Aceite do cliente');
  });

  it('shows the refusal the server rendered for a coverage that ends before it starts (REJ-214)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await fillRegistration();
    field('#form-proposal', 'coverageStart').value = '2027-10-01';
    field('#form-proposal', 'coverageEnd').value = '2026-10-01';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain(
      'Fim da vigência (2026-10-01) deve ser posterior ao início (2027-10-01).',
    );
    expect(snackbars()[0]).toContain('REQ-202');
  });

  it('shows the refusal the server rendered for an installment worth nothing (REJ-215)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await fillRegistration();
    click('#add-installment');
    field('#installments', 'amount').value = '0.00';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });
    expect(snackbars()[0]).toContain('Valor da parcela 1 deve ser positivo.');
    expect(snackbars()[0]).toContain('REQ-204');
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
    // REQ-216: the author is shown by name, never by the id the backend keeps.
    expect(text('#history')).toContain(TEST_USER.name);
    expect(text('#history')).not.toContain(signedIn.user.id);
  });

  it('corrects the CT and its mode before issuance, signed (FA-203, CA-204, CA-217)', async () => {
    // REQ-292: a parcelled CT needs at least two installments.
    const id = await awaitingProposal({
      proposalNumber: 'PRP-CT-1',
      installments: [{ amount: '50.00' }, { amount: '50.00' }],
    });
    await openProposal(id);

    expect(hidden('[data-panel="corrections"]')).toBe(false);

    field('#form-worked-commission', 'workedCommission').value = '25';
    choose('#form-worked-commission', 'workedCommissionMode', 'PARCELLED');
    // REQ-291: both CTs of the parcelled CT.
    field('#form-worked-commission', 'subsequentWorkedCommission').value = '10';
    submit('#form-worked-commission');

    await vi.waitFor(() => {
      // REQ-293: 50.00 x 25% on the first installment.
      expect(text('#expected')).toContain('R$ 12,50');
    });
    expect(requests).toContain(`POST /proposals/${id}/worked-commission`);
    expect(text('[data-definition="workedCommission"]')).toContain('Parcelada');
    // REQ-215, REQ-124: both entries, each signed by the session user (REQ-216).
    expect(text('#history')).toContain(TEST_USER.name);

    const stored = await callApi('GET', `/proposals/${id}`);
    expect(stored.workedCommissionHistory.map((entry: Untyped) => entry.informedBy)).toEqual([
      signedIn.user.id,
      signedIn.user.id,
    ]);
  });

  it('asks nobody to type who signs: the corrections are signed by the session (REQ-216)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-CT-2' });
    await openProposal(id);

    for (const form of ['#form-worked-commission', '#form-receipt', '#form-installments']) {
      expect(document.querySelector(`${form} [name="userId"]`), form).toBeNull();
    }
  });

  it('declares and then removes the intermediary before issuance (FA-204, FA-209, CA-214)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-INT-1' });
    await openProposal(id);

    choose('#form-receipt', 'receiptKind', 'INTERMEDIARY');
    field('#form-receipt', 'intermediaryId').value = 'intermediary-1';
    field('#form-receipt', 'ctu').value = '50';
    submit('#form-receipt');

    await vi.waitFor(() => {
      expect(text('#expected')).toContain('R$ 10,00');
    });
    expect(text('[data-definition="receipt"]')).toContain('intermediary-1');

    choose('#form-receipt', 'receiptKind', 'DIRECT');
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

  it('recognises the issuance, signed, and the policy inherits the proposal (FP-01 steps 8-9, REQ-209, REQ-241)', async () => {
    const proposalId = await awaitingProposal({
      proposalNumber: 'PRP-ACCEPT-1',
      installments: [{ amount: '100.00', dueDate: null }],
    });
    await openProposal(proposalId);

    // The policy number is the proposal number (REQ-241): shown, not typed.
    const policyNumber = field('#form-issuance', 'policyNumber');
    expect(policyNumber.value).toBe('PRP-ACCEPT-1');
    expect(policyNumber.readOnly).toBe(true);
    expect(text('#form-issuance')).not.toContain('Pode coincidir');
    expect(text('#form-issuance')).toContain('É o número da proposta.');
    // REQ-242: nothing of the policy is typed again.
    for (const name of ['premium', 'coverageStart', 'coverageEnd', 'renewalDate', 'amount']) {
      expect(document.querySelector(`#form-issuance [name="${name}"]`)).toBeNull();
    }

    submit('#form-issuance');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Apólice registrada');
    });
    expect(requests).toContain('POST /policies');
    expect(hidden('[data-panel="outcome"]')).toBe(true);
    expect(hidden('[data-panel="corrections"]')).toBe(true);
    // CA-207: who identified the issuance, on the proposal.
    expect(text('#history')).toContain(`Emissão reconhecida · ${TEST_USER.name}`);

    const proposal = await callApi('GET', `/proposals/${proposalId}`);
    expect(proposal.status).toBe('ISSUED');
    expect(proposal.issuanceRecognizedBy).toBe(signedIn.user.id);
    const policy = await callApi('GET', `/proposals/${proposalId}/policy`);
    expect(policy).toMatchObject({
      policyNumber: 'PRP-ACCEPT-1',
      premium: '100.00',
      coverageEnd: '2027-10-01',
      renewalDate: '2027-10-01',
    });
    expect(policy.installments).toEqual([
      expect.objectContaining({ number: 1, amount: '100.00', dueDate: null }),
    ]);
  });

  it('sends the PDF of the policy with the recognition, signed by who recognised it (REQ-247, CA-243)', async () => {
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x41]);
    const proposalId = await awaitingProposal({ proposalNumber: 'PRP-ACCEPT-PDF' });
    await openProposal(proposalId);

    const input = field('#form-issuance', 'policyPdf');
    const file = new window.File([PDF], 'apolice.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    submit('#form-issuance');

    await vi.waitFor(() => {
      expect(text('#page')).toContain('Apólice registrada');
    });
    const policy = await callApi('GET', `/proposals/${proposalId}/policy`);
    expect(policy.document).toMatchObject({
      fileName: 'apolice.pdf',
      attachedBy: signedIn.user.id,
    });
    const download = await fetch(`${baseUrl}/policies/${policy.id}/document`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF);
  });

  it('asks nobody to type who recognised the issuance: it is the session user (REJ-205, REQ-216)', async () => {
    const proposalId = await awaitingProposal({ proposalNumber: 'PRP-ACCEPT-2' });
    await openProposal(proposalId);

    expect(document.querySelector('#form-issuance [name="userId"]')).toBeNull();
  });
});

/** REQ-218: the reference PDF holds personal data and is never versioned. */
const REFERENCE_PDF = path.resolve(import.meta.dirname, '../../proposta-exemplo.pdf');

/** Puts a file in the PDF input the way the browser does, and sends the form. */
function sendPdf(bytes: Uint8Array): void {
  const input = field('#form-pdf', 'pdf');
  const file = new window.File([bytes], 'proposta.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  submit('#form-pdf');
}

/** Answers the reading endpoint the way the reader would, to test the page alone. */
async function withReading<T>(reading: unknown, work: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Untyped, init: Untyped) =>
    String(input).endsWith('/proposals/pdf-reading')
      ? new Response(JSON.stringify(reading), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : realFetch(input, init)) as typeof globalThis.fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe('keeping the imported PDF with the proposal (REQ-219)', () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

  it('registers the proposal with the file it was read from, and opens it from the proposal (CA-223)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await withReading(
      { status: 'PARTIAL', fields: { proposalNumber: 'PRP-SRC-WEB' }, missing: ['netPremium'] },
      async () => {
        sendPdf(PDF_BYTES);
        await vi.waitFor(() => {
          expect(text('#pdf-result')).toContain('PDF lido parcialmente.');
        });
      },
    );

    await fillRegistration();
    field('#form-proposal', 'proposalNumber').value = 'PRP-SRC-WEB';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-SRC-WEB');
    });
    const listed = await callApi('GET', '/proposals');
    const stored = listed.find((proposal: Untyped) => proposal.proposalNumber === 'PRP-SRC-WEB');
    expect(stored.sourceDocument).toEqual({ fileName: 'proposta.pdf' });
    const download = await fetch(`${baseUrl}/proposals/${stored.id}/source-document`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF_BYTES);

    await openProposal(stored.id);
    const link: Untyped = document.querySelector('#source-document');
    expect(link.textContent).toContain('proposta.pdf');
    expect(link.getAttribute('href')).toBe(`/proposals/${stored.id}/source-document`);
  });

  it('opens the proposal PDF in the viewer on click, with the download in its actions menu', async () => {
    const blobs: Untyped[] = [];
    window.URL.createObjectURL = (blob: Untyped) => {
      blobs.push(blob);
      return 'blob:proposal-pdf';
    };
    window.URL.revokeObjectURL = () => {};
    // jsdom has the element but not the modal behaviour.
    window.HTMLDialogElement.prototype.showModal = function showModal(this: Untyped) {
      this.open = true;
    };
    const proposalId = await awaitingProposal({
      proposalNumber: 'PRP-SRC-VIEW',
      sourceDocument: {
        fileName: 'proposta.pdf',
        // Whatever type was informed, the viewer shows a PDF.
        contentType: 'text/html',
        content: Buffer.from(PDF_BYTES).toString('base64'),
      },
    });
    await openProposal(proposalId);

    (document.querySelector('#source-document') as Untyped).click();

    await vi.waitFor(() => {
      expect(document.querySelector('dialog.pdf-viewer')?.open).toBe(true);
    });
    const viewer: Untyped = document.querySelector('dialog.pdf-viewer');
    expect(viewer.querySelector('iframe').getAttribute('src')).toBe('blob:proposal-pdf');
    expect(blobs[0].type).toBe('application/pdf');
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(PDF_BYTES);
    const download = viewer.querySelector('.pdf-actions [data-action="download"]');
    expect(download.textContent).toContain('Baixar PDF');
    expect(download.getAttribute('href')).toBe(`/proposals/${proposalId}/source-document`);
  });

  it('keeps the file even when the reading failed (CA-223)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await withReading({ status: 'FAILED', reason: 'UNREADABLE' }, async () => {
      sendPdf(PDF_BYTES);
      await vi.waitFor(() => {
        expect(text('#pdf-result')).toContain('Não foi possível ler o PDF.');
      });
    });

    await fillRegistration();
    field('#form-proposal', 'proposalNumber').value = 'PRP-SRC-FAILED';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-SRC-FAILED');
    });
    const listed = await callApi('GET', '/proposals');
    const stored = listed.find((proposal: Untyped) => proposal.proposalNumber === 'PRP-SRC-FAILED');
    expect(stored.sourceDocument).toEqual({ fileName: 'proposta.pdf' });
    const download = await fetch(`${baseUrl}/proposals/${stored.id}/source-document`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('keeps only the last PDF sent before registering (CA-224)', async () => {
    const LAST = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x32]);
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    await withReading(
      { status: 'SUCCESS', fields: { proposalNumber: 'PRP-SRC-LAST' }, missing: [] },
      async () => {
        sendPdf(PDF_BYTES);
        await vi.waitFor(() => {
          expect(text('#pdf-result')).toContain('PDF lido.');
        });
      },
    );
    // The second one fails to read, and is still the one kept.
    await withReading({ status: 'FAILED', reason: 'UNREADABLE' }, async () => {
      sendPdf(LAST);
      await vi.waitFor(() => {
        expect(text('#pdf-result')).toContain('Não foi possível ler o PDF.');
      });
    });

    await fillRegistration();
    field('#form-proposal', 'proposalNumber').value = 'PRP-SRC-LAST';
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-SRC-LAST');
    });
    const listed = await callApi('GET', '/proposals');
    const stored = listed.find((proposal: Untyped) => proposal.proposalNumber === 'PRP-SRC-LAST');
    const download = await fetch(`${baseUrl}/proposals/${stored.id}/source-document`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(LAST);
  });
});

describe('filling the proposal from its PDF (REQ-218)', () => {
  it.skipIf(!existsSync(REFERENCE_PDF))(
    'fills what it read, overwriting what was typed, and registers nothing (CA-220)',
    async () => {
      openPage('proposals/new.html');
      await import('/app/proposals/new.js');
      // Typed before the reading: the PDF wins on the fields it brings.
      field('#form-proposal', 'proposalNumber').value = 'DIGITADO-ERRADO';

      sendPdf(new Uint8Array(readFileSync(REFERENCE_PDF)));

      await vi.waitFor(() => {
        expect(text('#pdf-result')).toContain('PDF lido.');
      });
      expect(requests).toContain('POST /proposals/pdf-reading');
      expect(requests).not.toContain('POST /proposals');

      expect(field('#form-proposal', 'proposalNumber').value).toBe('140839725');
      // REQ-321: the name and the CPF of the client, the CPF as its digits.
      expect(field('#form-proposal', 'clientName').value).toBe(
        'JOSE WENDSON GOMES DE QUEIROZ COSTA',
      );
      expect(field('#form-proposal', 'clientCpf').value).toMatch(/^\d{11}$/);
      expect(field('#form-proposal', 'insurerId').value).toBe('ALLIANZ');
      expect(field('#form-proposal', 'productId').value).toBe('Auto');
      expect(field('#form-proposal', 'netPremium').value).toBe('643.85');
      expect(field('#form-proposal', 'coverageStart').value).toBe('2026-09-17');
      expect(field('#form-proposal', 'coverageEnd').value).toBe('2027-09-17');
      expect(text('#renewal')).toBe('17/09/2027');
      const amounts: Untyped[] = [...document.querySelectorAll('#installments [name="amount"]')];
      expect(amounts).toHaveLength(10);
      expect(amounts[9].value).toBe('69.10');
      // What never comes from the document is said, for the user to inform.
      expect(text('#pdf-result')).toContain('comissão trabalhada');

      // REQ-310: the broker's name only fills the search; nothing is chosen.
      expect(field('#form-proposal', 'brokerSearch').value).toBe(
        'PAISSANDU CORRETORA DE SEGUROS LTDA',
      );
      expect(field('#form-proposal', 'brokerId').value).toBe('');

      // The user reviews, chooses the broker, completes what the PDF does not
      // carry, and registers.
      await registerBroker(baseUrl, 'PAISSANDU CORRETORA DE SEGUROS LTDA', 2);
      await chooseBroker(document, window, 'PAISSANDU', 'PAISSANDU CORRETORA DE SEGUROS LTDA');
      field('#form-proposal', 'workedCommission').value = '20';
      submit('#form-proposal');

      await vi.waitFor(() => {
        expect(text('#done-body')).toContain('140839725');
      });
      const [stored] = await callApi('GET', '/proposals?status=AWAITING_ISSUANCE');
      expect(stored).toMatchObject({
        proposalNumber: '140839725',
        netPremium: '643.85',
        expectedReceipt: { usina: '128.77' },
      });
      expect(stored.installments).toHaveLength(10);
    },
  );

  it('lists what was not found and leaves those fields as they were (CA-221)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');
    field('#form-proposal', 'netPremium').value = '100.00';

    // A partial answer, as the reader gives it for a document missing a field.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Untyped, init: Untyped) =>
      String(input).endsWith('/proposals/pdf-reading')
        ? new Response(
            JSON.stringify({
              status: 'PARTIAL',
              fields: { proposalNumber: '555', insurerId: 'ALLIANZ' },
              missing: ['netPremium', 'installments'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : realFetch(input, init)) as typeof globalThis.fetch;

    try {
      sendPdf(new Uint8Array([1, 2, 3]));
      await vi.waitFor(() => {
        expect(text('#pdf-result')).toContain('PDF lido parcialmente.');
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(text('#pdf-found')).toContain('Número da proposta');
    expect(text('#pdf-missing')).toContain('Prêmio líquido');
    expect(text('#pdf-missing')).toContain('Parcelas');
    expect(field('#form-proposal', 'proposalNumber').value).toBe('555');
    // Not found is not erased: what the user had stays for them to review.
    expect(field('#form-proposal', 'netPremium').value).toBe('100.00');
  });

  it('fills the client name and CPF read from the PDF, and lists a CPF not found (REQ-321)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    const realFetch = globalThis.fetch;
    const readings = [
      {
        status: 'PARTIAL',
        fields: { clientId: 'MARIA DA SILVA', clientCpf: '52998224725' },
        missing: ['netPremium'],
      },
      // A document whose CPF/CNPJ is not a valid CPF: the reader leaves it out.
      { status: 'PARTIAL', fields: { clientId: 'EMPRESA EXEMPLO' }, missing: ['clientCpf'] },
    ];
    globalThis.fetch = (async (input: Untyped, init: Untyped) =>
      String(input).endsWith('/proposals/pdf-reading')
        ? new Response(JSON.stringify(readings.shift()), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : realFetch(input, init)) as typeof globalThis.fetch;

    try {
      sendPdf(new Uint8Array([1, 2, 3]));
      await vi.waitFor(() => {
        expect(field('#form-proposal', 'clientCpf').value).toBe('52998224725');
      });
      expect(field('#form-proposal', 'clientName').value).toBe('MARIA DA SILVA');
      expect(text('#pdf-found')).toContain('CPF do cliente');

      sendPdf(new Uint8Array([4, 5, 6]));
      await vi.waitFor(() => {
        expect(field('#form-proposal', 'clientName').value).toBe('EMPRESA EXEMPLO');
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(text('#pdf-missing')).toContain('CPF do cliente');
    // Not found is not erased: the CPF stays for the user to review.
    expect(field('#form-proposal', 'clientCpf').value).toBe('52998224725');
    expect(requests).not.toContain('POST /proposals');
  });

  it('puts the broker read from the PDF in the search, and chooses nothing (REQ-310)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Untyped, init: Untyped) =>
      String(input).endsWith('/proposals/pdf-reading')
        ? new Response(
            JSON.stringify({
              status: 'PARTIAL',
              fields: { brokerId: 'Corretora Alfa' },
              missing: ['netPremium'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : realFetch(input, init)) as typeof globalThis.fetch;

    try {
      sendPdf(new Uint8Array([1, 2, 3]));
      await vi.waitFor(() => {
        expect(text('#pdf-result')).toContain('PDF lido parcialmente.');
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(field('#form-proposal', 'brokerSearch').value).toBe('Corretora Alfa');
    // The matching broker is offered to be chosen (REQ-306), never chosen for the user.
    await vi.waitFor(() => {
      expect(
        [...document.querySelectorAll('#broker-options option')].map(
          (option: Untyped) => option.value,
        ),
      ).toContain('Corretora Alfa · 100.000.001-08');
    });
    expect(field('#form-proposal', 'brokerId').value).toBe('');
  });

  it('says the reading failed and fills nothing (CA-222)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    sendPdf(new TextEncoder().encode('isto não é um pdf'));

    await vi.waitFor(() => {
      expect(text('#pdf-result')).toContain('Não foi possível ler o PDF.');
    });
    expect(field('#form-proposal', 'proposalNumber').value).toBe('');
    expect(requests).not.toContain('POST /proposals');
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
    const policy = await callApi('POST', '/policies', { proposalId });

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
