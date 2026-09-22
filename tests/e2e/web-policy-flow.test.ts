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
 * The policy screen, driven the way an operator drives it.
 *
 * This is where FP-01 lands and where FP-02 and FP-03 are finished by hand:
 * the agreed and the real commission side by side (REQ-076), the manual
 * resolution of a divergence (REQ-085), the override of REQ-066, the receipt
 * confirmation of REQ-092 and the whole transfer of FP-03. Every one of those
 * acts was proven at the API and offered by this page, with no test loading the
 * page — this file closes that gap.
 *
 * Nothing here is a mock. The server is the real one over SQLite on disk, and
 * the module under test is the same file the browser downloads.
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

/** Every request the page made, in order, as `METHOD path`. */
const requests: string[] = [];

/**
 * jsdom implements `<dialog>` as an element and nothing else: `showModal` and
 * `close` are absent, and a `<form method="dialog">` does not close its dialog.
 * The page asks for a justification, a user or a proof through those dialogs,
 * so the three behaviours the standard defines are supplied here.
 *
 * This replaces nothing of the page: the dialog markup, the fields, the buttons
 * and the promise the page waits on are the real ones. It is the same kind of
 * gap as `window.scrollTo`, which the FP-01 journey already fills.
 */
function installDialogSupport(): void {
  const proto = window.HTMLDialogElement.prototype;

  proto.showModal = function showModal(this: Untyped) {
    this.open = true;
  };

  proto.close = function close(this: Untyped, value?: string) {
    if (value !== undefined) {
      this.returnValue = value;
    }
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };

  // A submit button inside `<form method="dialog">` closes the dialog with its
  // own value, which is how the page tells "confirm" from "cancel".
  document.addEventListener('click', (event: Untyped) => {
    const button = event.target?.closest?.('button[value]');
    const dialog = button?.closest('dialog');

    if (button !== null && dialog != null && button.form?.getAttribute('method') === 'dialog') {
      event.preventDefault();
      dialog.close(button.value);
    }
  });
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-policy-'));
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
  installDialogSupport();

  await callApi('POST', '/broker-commission-rates', { brokerId: 'broker-1', rate: '50' });

  // IN-06, REQ-090/REQ-091: configuration, never named in code. One method
  // releases on the spot, the other waits for the client to pay (EX-07).
  await callApi('POST', '/payment-method-release-rules', {
    paymentMethodId: 'credit',
    release: 'IMMEDIATE',
  });
  await callApi('POST', '/payment-method-release-rules', {
    paymentMethodId: 'bank-slip',
    release: 'REQUIRES_RECEIPT_CONFIRMATION',
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

/* ----------------------------------------------------------- the page -- */

function openPage(relativePath: string, search = ''): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath}${search}`);

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

function text(selector = '#page'): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

/** The newest message on screen: the previous ones linger for six seconds. */
function lastSnackbar(): string {
  return snackbars().at(-1) ?? '';
}

/** Opens the policy screen and waits for the first render to land. */
async function openPolicy(policyId: string): Promise<void> {
  openPage('policies/detail.html', `?id=${policyId}`);
  await import('/app/policies/detail.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#page .skeleton')).toBeNull();
  });
}

/** The card whose title is `title`, as the operator sees it on screen. */
function card(title: string): Untyped {
  const found = [...document.querySelectorAll('#page section.card')].find((section: Untyped) =>
    section.querySelector('.card__header .text-title')?.textContent?.includes(title),
  );

  if (found === undefined) {
    throw new Error(`No card titled ${title} on screen.`);
  }
  return found;
}

/**
 * The state chip of a card, read on its own.
 *
 * Not the card's text: 'Liberado em' is a label on a transfer that has not been
 * released, and matching it would assert a state the screen is not showing.
 */
function statusIn(title: string): string {
  return card(title).querySelector('.card__header-actions .chip')?.textContent ?? '';
}

/** Clicks the button labelled `label` inside a card, the way a user would. */
function clickIn(title: string, label: string): void {
  const button = [...card(title).querySelectorAll('button')].find((node: Untyped) =>
    node.textContent?.includes(label),
  );

  if (button === undefined) {
    throw new Error(`No button "${label}" in the card ${title}.`);
  }
  button.click();
}

/** Fills the dialog the page just opened and confirms it, or cancels it. */
/**
 * The labels a card offers, buttons and links alike.
 *
 * The icon of a button is a `<span>` inside it, so `textContent` reads
 * `tuneAjustar comissão`; what the operator sees is the tail.
 */
function offeredIn(title: string): string[] {
  return [...card(title).querySelectorAll('button, a')].map((node: Untyped) =>
    (node.textContent ?? '').replace(/^[a-z_]+/, '').trim(),
  );
}

function answerDialog(id: string, values: Record<string, string>): void {
  const dialog = document.querySelector(id);
  expect(dialog.open, `${id} should be open`).toBe(true);

  for (const [name, value] of Object.entries(values)) {
    dialog.querySelector(`[name="${name}"]`).value = value;
  }

  const confirm = [...dialog.querySelectorAll('button')].find(
    (node: Untyped) => node.value === 'confirm',
  );
  confirm.click();
}

/** A proof with a byte no text encoding survives, to prove the round-trip. */
const PROOF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

/**
 * Attaches a document to the file field of a dialog, the way a person picks
 * one in the file chooser.
 *
 * jsdom has `File` and `FileReader` but no way to fill an `<input type=file>`:
 * `files` is read-only and there is no `DataTransfer`. Defining the property
 * is the standard way around it, and it leaves the page code untouched — what
 * runs is the same `readProof` the browser runs.
 */
function attachProof(dialogId: string, fileName: string, contentType: string): void {
  const input = document.querySelector(`${dialogId} [name="proof"]`);
  const file = new window.File([PROOF_BYTES], fileName, { type: contentType });

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
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

/** A business the way FP-01 leaves it: policy registered, commission forecast. */
async function registeredPolicy(
  numbers: { proposalNumber: string; policyNumber: string },
  paymentMethodId = 'credit',
): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId,
    customerAccepted: true,
    proposalNumber: numbers.proposalNumber,
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    userId: 'operator',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    policyNumber: numbers.policyNumber,
    premium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [
      { number: 1, amount: '50.00', dueDate: '2026-10-10' },
      { number: 2, amount: '50.00', dueDate: '2026-11-10' },
    ],
  });

  return policy.id;
}

/** FP-02 as the import leaves it: the real value apurada for a competence. */
async function reconciled(
  numbers: { proposalNumber: string; policyNumber: string },
  producerCommission: string,
): Promise<void> {
  await callApi('POST', '/commission-reconciliations', {
    competence: '2026-10',
    lines: [{ ...numbers, producerCommission }],
  });
}

/* -------------------------------------------------------------- tests -- */

describe('the policy screen', () => {
  it('shows the schedule and the agreed commission calculated at registration (FP-01 step 7)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-VIEW-1',
      policyNumber: 'APL-VIEW-1',
    });

    await openPolicy(policyId);

    expect(requests).toContain(`GET /policies/${policyId}`);
    expect(requests).toContain(`GET /policies/${policyId}/commission`);
    expect(text()).toContain('APL-VIEW-1');
    expect(text()).toContain('PRP-VIEW-1');

    // REQ-021: the schedule the policy was registered with.
    expect(card('Parcelas').querySelectorAll('tbody tr')).toHaveLength(2);
    expect(card('Parcelas').textContent).toContain('Pendente');

    // CA-016: agreed and real side by side, with nothing apurado yet.
    const commission = card('Comissão');
    expect(commission.textContent).toContain('Prevista');
    expect(commission.textContent).toContain('R$ 40,00');
    expect(commission.textContent).toContain('Não apurado');
    // REQ-093: what the Usina expects to pay the broker.
    expect(commission.textContent).toContain('R$ 20,00');

    // FP-03 has nothing to show before the conciliation apurar the real value.
    expect(card('Repasse ao corretor').textContent).toContain('Repasse não aberto');
  });

  it('shows agreed and real side by side and flags the divergence (REQ-076, CA-016, CA-017)', async () => {
    const numbers = { proposalNumber: 'PRP-DIV-2', policyNumber: 'APL-DIV-2' };
    const policyId = await registeredPolicy(numbers);
    // FP-02 step 3: the report paid less than the agreement foresaw.
    await reconciled(numbers, '35.00');

    await openPolicy(policyId);

    const commission = card('Comissão');
    expect(commission.textContent).toContain('Divergente');
    expect(commission.textContent).toContain('Acordado ≠ real');
    expect(commission.textContent).toContain('R$ 40,00');
    expect(commission.textContent).toContain('R$ 35,00');
    // REQ-086: the competence the real value came from.
    expect(commission.textContent).toContain('2026-10');
  });

  it('refuses a resolution with no justification and records one with it (REQ-085, CA-026)', async () => {
    const numbers = { proposalNumber: 'PRP-RES-1', policyNumber: 'APL-RES-1' };
    const policyId = await registeredPolicy(numbers);
    await reconciled(numbers, '35.00');

    await openPolicy(policyId);

    // REQ-085: the justification is mandatory, and it is the domain that says so.
    const beforeRefusal = snackbars().length;
    clickIn('Comissão', 'Resolver divergência');
    answerDialog('#dialog-resolution', { justification: '', userId: 'fin-1' });

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(beforeRefusal);
    });
    expect(lastSnackbar()).toContain('Resolução de divergência exige justificativa.');
    expect(lastSnackbar()).toContain('REQ-085');
    expect((await callApi('GET', `/policies/${policyId}/commission`)).status).toBe('DIVERGENT');

    clickIn('Comissão', 'Resolver divergência');
    answerDialog('#dialog-resolution', {
      justification: 'seguradora confirmou 35,00',
      userId: 'fin-1',
    });

    await vi.waitFor(() => {
      expect(card('Comissão').textContent).toContain('Divergência resolvida');
    });

    // REQ-124, REJ-014: the resolution is added, the divergent values stay.
    const resolved = card('Comissão').textContent;
    expect(resolved).toContain('seguradora confirmou 35,00');
    expect(resolved).toContain('fin-1');
    expect(resolved).toContain('R$ 35,00');

    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.status).toBe('RESOLVED');
    expect(commission.resolution.userId).toBe('fin-1');
    expect(commission.realReceivable).toBe('35.00');
  });

  it('refuses an override with no justification and applies one with it (REQ-066, REQ-067, REJ-010)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-OVR-1',
      policyNumber: 'APL-OVR-1',
    });

    await openPolicy(policyId);

    const beforeRefusal = snackbars().length;
    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', { payable: '25.00', justification: '', userId: 'adm-1' });

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(beforeRefusal);
    });
    expect(lastSnackbar()).toContain('Ajuste de comissão por apólice exige justificativa.');
    expect(lastSnackbar()).toContain('REQ-067');

    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', {
      payable: '25.00',
      justification: 'acordo extraordinário com o corretor',
      userId: 'adm-1',
    });

    await vi.waitFor(() => {
      expect(card('Comissão').textContent).toContain('Ajuste aplicado');
    });

    // REQ-124: the calculated value is preserved next to the adjusted one.
    expect(card('Comissão').textContent).toContain('R$ 25,00');
    expect(card('Comissão').textContent).toContain('acordo extraordinário com o corretor');

    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.agreedPayable).toBe('20.00');
    expect(commission.effectivePayable).toBe('25.00');
    expect(commission.override.userId).toBe('adm-1');
  });

  it('holds the transfer until the receipt is confirmed, then releases and pays it (FP-03)', async () => {
    const numbers = { proposalNumber: 'PRP-REP-1', policyNumber: 'APL-REP-1' };
    // A payment method that waits for the client (REQ-091, EX-07).
    const policyId = await registeredPolicy(numbers, 'bank-slip');
    await reconciled(numbers, '40.00');

    await openPolicy(policyId);

    // FP-03 step 1: opened by the Financeiro, over the apurada commission.
    clickIn('Repasse ao corretor', 'Abrir repasse');
    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Aguardando confirmação');
    });
    // REQ-093: the broker's table over the base.
    expect(card('Repasse ao corretor').textContent).toContain('R$ 20,00');
    expect(card('Repasse ao corretor').textContent).toContain('Exige confirmação');

    // REJ-009: releasing without the confirmation is refused by the domain.
    const beforeRefusal = snackbars().length;
    clickIn('Repasse ao corretor', 'Liberar repasse');
    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(beforeRefusal);
    });
    expect(lastSnackbar()).toContain(
      'Repasse exige confirmação do pagamento da primeira parcela pelo cliente.',
    );
    expect(lastSnackbar()).toContain('REQ-091');

    // REQ-092, IN-13, REQ-123: the confirmation is manual and says who made it.
    clickIn('Parcelas', 'Confirmar recebimento');
    answerDialog('#dialog-installment', { userId: 'fin-2' });

    await vi.waitFor(() => {
      expect(card('Parcelas').textContent).toContain('Paga');
    });
    expect(card('Parcelas').textContent).toContain('fin-2');

    clickIn('Repasse ao corretor', 'Liberar repasse');
    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Liberado');
    });

    // FP-03 step 5, REQ-095: the payment sent, with proof and user.
    clickIn('Repasse ao corretor', 'Registrar pagamento');
    const dialog = document.querySelector('#dialog-payment');
    // The expected amount is offered, not imposed.
    expect(dialog.querySelector('[name="amount"]').value).toBe('20.00');
    // REQ-095, CA-028: the proof is the document, attached here.
    attachProof('#dialog-payment', 'comprovante.pdf', 'application/pdf');
    answerDialog('#dialog-payment', { amount: '20.00', userId: 'fin-2' });

    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Pago');
    });
    expect(card('Repasse ao corretor').textContent).toContain('Pagamento registrado');
    expect(card('Repasse ao corretor').textContent).toContain('comprovante.pdf');

    // The attachment is reachable from the screen: a proof nobody can open
    // again evidences nothing.
    const link = card('Repasse ao corretor').querySelector('a.proof-link');
    expect(link.getAttribute('href')).toBe(`/policies/${policyId}/settlement/payment/proof`);

    // Every act crossed as a request made by the page, not by this test.
    expect(requests).toContain(`POST /policies/${policyId}/settlement`);
    expect(requests).toContain(`POST /policies/${policyId}/installments/1/payment`);
    expect(requests).toContain(`POST /policies/${policyId}/settlement/release`);
    expect(requests).toContain(`POST /policies/${policyId}/settlement/payment`);

    const settlement = await callApi('GET', `/policies/${policyId}/settlement`);
    expect(settlement.status).toBe('PAID');
    expect(settlement.amount).toBe('20.00');
    expect(settlement.payment).toMatchObject({
      amount: '20.00',
      proof: {
        fileName: 'comprovante.pdf',
        contentType: 'application/pdf',
        byteSize: PROOF_BYTES.length,
      },
      userId: 'fin-2',
    });

    // REQ-095, CA-028: the bytes the page uploaded are the bytes served back.
    const served = await fetch(`${baseUrl}/policies/${policyId}/settlement/payment/proof`);
    expect([...new Uint8Array(await served.arrayBuffer())]).toEqual([...PROOF_BYTES]);

    // REQ-092: the first installment carries who confirmed it.
    const policy = await callApi('GET', `/policies/${policyId}`);
    expect(policy.installments[0]).toMatchObject({ status: 'PAID', confirmedBy: 'fin-2' });
  });

  it('opens the transfer already released for an immediate payment method (CA-022)', async () => {
    const numbers = { proposalNumber: 'PRP-REP-2', policyNumber: 'APL-REP-2' };
    const policyId = await registeredPolicy(numbers, 'credit');
    await reconciled(numbers, '40.00');

    await openPolicy(policyId);

    clickIn('Repasse ao corretor', 'Abrir repasse');
    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Liberado');
    });

    // Nothing was confirmed: the rule of the payment method is what released it.
    expect(card('Parcelas').textContent).toContain('Pendente');
    expect(card('Repasse ao corretor').textContent).toContain('Liberação imediata');
    expect((await callApi('GET', `/policies/${policyId}/settlement`)).status).toBe('RELEASED');
  });

  it('says so when the policy does not exist', async () => {
    await openPolicy('does-not-exist');

    expect(text()).toContain('Apólice não encontrada');
    // The sentence is the one src/i18n rendered for the 404.
    expect(text()).toContain('does-not-exist');
  });
});

/**
 * The state the product's own front door leads to: a policy registered before
 * anybody filled in the registries.
 *
 * It used to be terminal. The screen said the policy had no commission and
 * told the operator to register a new business — and REQ-124 forbids deleting
 * the one that is there. This group walks the way out, entirely through the
 * page: see what is missing, fix the registry, calculate, and carry on into
 * FP-03 on the same policy.
 */
describe('a policy that reached the screen without a commission', () => {
  const numbers = { proposalNumber: 'PRP-LATE-1', policyNumber: 'APL-LATE-1' };
  let policyId: string;

  it('shows the absence as a step of the flow, with the action to take', async () => {
    // A business whose broker has no commission table registered (IN-05).
    const proposal = await callApi('POST', '/proposals', {
      clientId: 'client-1',
      brokerId: 'broker-late',
      insurerId: 'insurer-late',
      productId: 'residencial',
      paymentMethodId: 'credit',
      customerAccepted: true,
      proposalNumber: numbers.proposalNumber,
      netPremium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      workedCommission: '40',
      workedCommissionMode: 'INTEGRAL',
      intermediary: null,
      userId: 'operator',
    });
    const policy = await callApi('POST', '/policies', {
      proposalId: proposal.id,
      policyNumber: numbers.policyNumber,
      premium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      installments: [{ number: 1, amount: '100.00', dueDate: '2026-10-10' }],
    });
    policyId = policy.id;

    await openPolicy(policyId);

    // Not an error and not corruption: a stage of the life of the policy.
    expect(card('Comissão').textContent).toContain('Comissão ainda não calculada');
    expect(card('Comissão').textContent).toContain('A apólice existe e continua válida');
    // And the way out is offered right there.
    expect(offeredIn('Comissão')).toContain('Calcular comissão');
    expect(offeredIn('Comissão')).toContain('Abrir cadastros');
  });

  it('refuses in Portuguese, naming the registry that is missing (IN-05)', async () => {
    await openPolicy(policyId);
    clickIn('Comissão', 'Calcular comissão');

    await vi.waitFor(() => {
      expect(lastSnackbar()).toContain('IN-05');
    });
    expect(lastSnackbar()).toContain('broker-late');

    // The refusal changed nothing: the policy is where it was.
    expect(card('Comissão').textContent).toContain('Comissão ainda não calculada');
  });

  it('calculates it from the screen once the registry exists, without recreating anything', async () => {
    await callApi('POST', '/broker-commission-rates', { brokerId: 'broker-late', rate: '50' });

    await openPolicy(policyId);
    clickIn('Comissão', 'Calcular comissão');

    await vi.waitFor(() => {
      expect(card('Comissão').textContent).toContain('R$ 40,00');
    });
    // REQ-093: what the Usina owes the broker came out with it.
    expect(card('Comissão').textContent).toContain('R$ 20,00');
    expect(statusIn('Comissão')).toBe('Prevista');
    expect(requests).toContain(`POST /policies/${policyId}/commission`);

    // Same policy, same number: nothing was recreated along the way.
    const policy = await callApi('GET', `/policies/${policyId}`);
    expect(policy.policyNumber).toBe(numbers.policyNumber);
  });

  it('carries the same policy through FP-03 to the payment', async () => {
    await reconciled(numbers, '40.00');
    await callApi('POST', '/payment-method-release-rules', {
      paymentMethodId: 'credit',
      release: 'IMMEDIATE',
    });

    await openPolicy(policyId);
    clickIn('Repasse ao corretor', 'Abrir repasse');

    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Liberado');
    });

    clickIn('Repasse ao corretor', 'Registrar pagamento');
    attachProof('#dialog-payment', 'comprovante-late.pdf', 'application/pdf');
    answerDialog('#dialog-payment', { amount: '20.00', userId: 'fin-3' });

    await vi.waitFor(() => {
      expect(statusIn('Repasse ao corretor')).toBe('Pago');
    });

    // The commission and the transfer coexist on the policy that started
    // without either of them.
    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    const settlement = await callApi('GET', `/policies/${policyId}/settlement`);
    expect(commission.policyId).toBe(policyId);
    expect(settlement.policyId).toBe(policyId);
    expect(settlement.payment).toMatchObject({ amount: '20.00', userId: 'fin-3' });
  });

  it('does not offer the calculation once the commission exists (REQ-124)', async () => {
    await openPolicy(policyId);

    expect(offeredIn('Comissão')).not.toContain('Calcular comissão');
    // What changes a calculated value is the override, which records why.
    expect(offeredIn('Comissão')).toContain('Ajustar comissão');
  });
});
