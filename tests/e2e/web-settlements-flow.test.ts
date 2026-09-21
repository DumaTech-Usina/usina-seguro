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
 * OUT-07 driven the way the Financeiro drives it: the statement of a broker,
 * and the path from a released transfer to the payment registered on the
 * policy.
 *
 * FP-03 is executed policy by policy, and until now it was only reachable from
 * the policy screen. This file walks the other half of the journey — open the
 * statement, pick the broker, see what is forecast, held, released and paid,
 * follow a line to the policy, pay it there and see the statement move the
 * amount from *liberado* to *pago*.
 *
 * Nothing here is a mock. The server is the real one over SQLite on disk, and
 * the modules under test are the same files the browser downloads.
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

/**
 * jsdom implements `<dialog>` as an element and nothing else. The policy screen
 * asks for the payment of REQ-095 through one, so the three behaviours the
 * standard defines are supplied here, exactly as `web-policy-flow.test.ts`
 * does. Nothing of the page is replaced.
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-settlements-'));
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

  // IN-02 and IN-05: premium 100.00 at 40% makes 40.00 for the Usina, and the
  // broker table decides what goes out — half for one broker, a quarter for
  // the other (REQ-093).
  await callApi('POST', '/commission-agreements', {
    insurerId: 'insurer-1',
    productId: 'auto',
    effectiveFrom: '2026-01-01',
    insurerRate: '40',
  });
  await callApi('POST', '/broker-commission-rates', { brokerId: 'broker-1', rate: '50' });
  await callApi('POST', '/broker-commission-rates', { brokerId: 'broker-2', rate: '25' });

  // IN-06, REQ-090/REQ-091: one method releases at once, the other waits for
  // the client to pay the first installment (EX-07).
  await callApi('POST', '/payment-method-release-rules', {
    paymentMethodId: 'credit',
    release: 'IMMEDIATE',
  });
  await callApi('POST', '/payment-method-release-rules', {
    paymentMethodId: 'bank-slip',
    release: 'REQUIRES_RECEIPT_CONFIRMATION',
  });

  // The four situations OUT-07 names, for one broker, plus a business of
  // another broker so the filter has something to leave out.
  await registeredPolicy('PRP-EXT-PREV', 'APL-EXT-PREV', 'broker-1');
  const held = await reconciledPolicy('PRP-EXT-RET', 'APL-EXT-RET', 'broker-1', 'bank-slip');
  await callApi('POST', `/policies/${held.policyId}/settlement`);
  const released = await reconciledPolicy('PRP-EXT-LIB', 'APL-EXT-LIB', 'broker-1');
  await callApi('POST', `/policies/${released.policyId}/settlement`);
  const other = await reconciledPolicy('PRP-EXT-OUTRO', 'APL-EXT-OUTRO', 'broker-2');
  await callApi('POST', `/policies/${other.policyId}/settlement`);
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
 * Opens the statement and waits for the first reading to land.
 *
 * The module registry is reset first because a page opened twice in one
 * journey is loaded twice by the browser.
 */
async function openStatement(): Promise<void> {
  vi.resetModules();
  openPage('settlements/index.html');
  await import('/app/settlements/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

/** Picks a broker in the filter, the way an operator does. */
async function chooseBroker(brokerId: string): Promise<void> {
  const select = document.querySelector('#broker');
  select.value = brokerId;
  select.dispatchEvent(new window.Event('change'));

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

function rows(): Untyped[] {
  return [...document.querySelectorAll('#list tbody tr')];
}

function rowOf(policyNumber: string): Untyped {
  const found = rows().find((row: Untyped) =>
    row.querySelector('.policy-number')?.textContent?.includes(policyNumber),
  );

  if (found === undefined) {
    throw new Error(`No line for ${policyNumber} on screen.`);
  }
  return found;
}

/** The value of one of the four totals of OUT-07, read by its label. */
function total(label: string): string {
  const found = [...document.querySelectorAll('#totals .metric')].find((metric: Untyped) =>
    metric.querySelector('.text-label')?.textContent?.includes(label),
  );

  if (found === undefined) {
    throw new Error(`No total "${label}" on screen.`);
  }
  return found.querySelector('.metric__value')?.textContent ?? '';
}

function brokerOptions(): string[] {
  return [...document.querySelectorAll('#broker option')].map(
    (option: Untyped) => option.textContent ?? '',
  );
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** Opens the policy screen the way the statement hands it over: by its link. */
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

function card(title: string): Untyped {
  const found = [...document.querySelectorAll('#page section.card')].find((section: Untyped) =>
    section.querySelector('.card__header .text-title')?.textContent?.includes(title),
  );

  if (found === undefined) {
    throw new Error(`No card titled ${title} on screen.`);
  }
  return found;
}

function clickIn(title: string, label: string): void {
  const button = [...card(title).querySelectorAll('button')].find((node: Untyped) =>
    node.textContent?.includes(label),
  );

  if (button === undefined) {
    throw new Error(`No button "${label}" in the card ${title}.`);
  }
  button.click();
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
async function registeredPolicy(
  proposalNumber: string,
  policyNumber: string,
  brokerId: string,
  paymentMethodId = 'credit',
): Promise<Business> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId,
    customerAccepted: true,
    netPremium: '100.00',
  });

  await callApi('POST', `/proposals/${proposal.id}/transmission`, {
    proposalNumber,
    workedCommission: '40',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    policyNumber,
    premium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [{ number: 1, amount: '100.00', dueDate: '2026-10-10' }],
  });

  return { policyId: policy.id, proposalNumber, policyNumber };
}

/** The same business with the report already matched to it (FP-02 step 3). */
async function reconciledPolicy(
  proposalNumber: string,
  policyNumber: string,
  brokerId: string,
  paymentMethodId = 'credit',
): Promise<Business> {
  const business = await registeredPolicy(proposalNumber, policyNumber, brokerId, paymentMethodId);

  await callApi('POST', '/commission-reconciliations', {
    competence: '2026-10',
    lines: [{ policyNumber, proposalNumber, producerCommission: '40.00' }],
  });

  return business;
}

/* -------------------------------------------------------------- tests -- */

describe('the broker statement (OUT-07)', () => {
  it('opens on every broker and shows each situation of FP-03', async () => {
    await openStatement();

    expect(requests).toContain('GET /broker-commission-statements');
    expect(rows()).toHaveLength(4);

    // The *prevista* of OUT-07: the commission exists, the transfer does not.
    const forecast = rowOf('APL-EXT-PREV');
    expect(forecast.textContent).toContain('Repasse não aberto');
    expect(forecast.textContent).toContain('R$ 20,00');

    // EX-07: held until the client's first installment is confirmed.
    expect(rowOf('APL-EXT-RET').textContent).toContain('Aguardando confirmação');
    expect(rowOf('APL-EXT-RET').textContent).toContain('Exige confirmação');
    expect(rowOf('APL-EXT-LIB').textContent).toContain('Liberado');

    // IN-05: the other broker's table pays a quarter of the 40,00, not half.
    expect(rowOf('APL-EXT-OUTRO').textContent).toContain('R$ 10,00');
    expect(rowOf('APL-EXT-OUTRO').textContent).toContain('broker-2');

    // The four totals of OUT-07, summed by the backend on exact cents.
    expect(total('Previsto')).toBe('R$ 70,00');
    expect(total('Aguardando confirmação')).toBe('R$ 20,00');
    expect(total('Liberado a pagar')).toBe('R$ 30,00');
    expect(total('Pago')).toBe('R$ 0,00');
  });

  it('narrows to one broker with a new reading, not a local slice', async () => {
    await openStatement();

    // There is no broker registry (IN-01): the options are the brokers the
    // registered business brought.
    expect(brokerOptions()).toEqual(['Todos os corretores', 'broker-1', 'broker-2']);

    await chooseBroker('broker-1');

    expect(requests).toContain('GET /broker-commission-statements?brokerId=broker-1');
    expect(rows()).toHaveLength(3);
    expect(rows().every((row: Untyped) => row.textContent.includes('broker-1'))).toBe(true);
    // Only this broker's money is counted now.
    expect(total('Previsto')).toBe('R$ 60,00');
    expect(total('Liberado a pagar')).toBe('R$ 20,00');
  });

  it('carries the payment through the policy and back into the statement', async () => {
    await openStatement();
    await chooseBroker('broker-1');

    // FP-03 step 5 happens on the policy, which is where REQ-095 records the
    // amount, the proof and the user.
    await followToPolicy(rowOf('APL-EXT-LIB'));
    clickIn('Repasse ao corretor', 'Registrar pagamento');
    answerDialog('#dialog-payment', {
      amount: '19.50',
      proofReference: 'comprovante-EXT-LIB.pdf',
      userId: 'fin-1',
    });

    await vi.waitFor(() => {
      expect(card('Repasse ao corretor').textContent).toContain('Pagamento registrado');
    });

    await openStatement();
    await chooseBroker('broker-1');

    const paid = rowOf('APL-EXT-LIB');
    expect(paid.textContent).toContain('Pago');
    // REQ-095: what was sent, with its proof, not what was expected.
    expect(paid.textContent).toContain('R$ 19,50');
    expect(paid.textContent).toContain('comprovante-EXT-LIB.pdf');
    expect(paid.textContent).toContain('fin-1');

    // The amount left "liberado a pagar" and became "pago".
    expect(total('Liberado a pagar')).toBe('R$ 0,00');
    expect(total('Pago')).toBe('R$ 19,50');
    // REQ-093: what the Usina expected to pay is untouched by what it sent.
    expect(total('Previsto')).toBe('R$ 60,00');
  });

  it('hands the held transfer to the policy where it can be released (EX-07)', async () => {
    await openStatement();
    await chooseBroker('broker-1');

    // The statement does not offer a release it could not do: it says the
    // transfer is waiting and takes the operator where the act belongs.
    const held = rowOf('APL-EXT-RET');
    expect(held.textContent).toContain('Aguardando confirmação');

    await followToPolicy(held);

    const transfer = card('Repasse ao corretor');
    expect(transfer.textContent).toContain('Aguardando confirmação');
    expect(transfer.textContent).toContain('Liberar repasse');
    // REJ-009: paying it is not on offer while the receipt is unconfirmed.
    expect(transfer.textContent).not.toContain('Registrar pagamento');
  });
});
