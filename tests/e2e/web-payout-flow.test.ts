// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { registerBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { TEST_USER, signIn } from './support/sign-in.ts';

/**
 * FP-02 of V2 driven through the pages: the CR informed on the policy, its
 * recalculation, the eligibility with its statement, and the lists of the
 * payouts page (REQ-270 to REQ-286).
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
/** REQ-307: the registered brokers the proposals name. */
const brokers = { alfa: '', beta: '' };

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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-payout-'));
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
  brokers.alfa = await registerBroker(baseUrl, 'Corretora Alfa', 1);
  brokers.beta = await registerBroker(baseUrl, 'Corretora Beta', 2);

  const nodeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Untyped, init: Untyped) => {
    const url = new URL(String(input), baseUrl);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return nodeFetch(url, init);
  }) as typeof globalThis.fetch;

  window.scrollTo = () => {};
  installDialogSupport();
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

async function rawApi(method: string, apiPath: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${apiPath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

/** FP-02 step 1: a policy exists (FP-01 step 9). Answers its id. */
async function issuedPolicy(options: {
  proposalNumber: string;
  clientName?: string;
  brokerId?: string;
  mode?: 'INTEGRAL' | 'PARCELLED';
  intermediary?: { intermediaryId: string; ctu: string } | null;
  workedCommission?: string;
}): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    client: clientNamed(options.clientName ?? 'Ana Lima'),
    brokerId: options.brokerId ?? brokers.alfa,
    insurerId: 'ALLIANZ',
    productId: 'Auto',
    paymentMethodId: 'credit',
    proposalNumber: options.proposalNumber,
    netPremium: '1000.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    // REQ-291, REQ-292: a parcelled CT has two CTs and at least two installments.
    installments: options.mode === 'PARCELLED' ? [{ amount: '500.00' }, { amount: '500.00' }] : [],
    workedCommission: options.workedCommission ?? '30',
    subsequentWorkedCommission: options.mode === 'PARCELLED' ? '10' : null,
    workedCommissionMode: options.mode ?? 'INTEGRAL',
    intermediary: options.intermediary ?? null,
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
  });
  return policy.id;
}

/** Opens the payouts page and waits for both lists to land. */
async function openPayouts(): Promise<void> {
  openPage('payouts/index.html');
  await import('/app/payouts/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#without-rate .skeleton')).toBeNull();
    expect(document.querySelector('#eligible .skeleton')).toBeNull();
  });
}

function rowsOf(selector: string): Untyped[] {
  return [...document.querySelectorAll(`${selector} tbody tr`)];
}

function rowWith(selector: string, content: string): Untyped {
  return rowsOf(selector).find((row: Untyped) => row.textContent.includes(content));
}

/** Waits for a new snackbar and answers it. */
async function nextSnackbar(before: number): Promise<string> {
  await vi.waitFor(() => {
    expect(snackbars().length).toBeGreaterThan(before);
  });
  return lastSnackbar();
}

function buttonsIn(title: string): string[] {
  return [...card(title).querySelectorAll('button')].map((node: Untyped) =>
    (node.textContent ?? '').replace(/^[a-z_]+/, '').trim(),
  );
}

const CR_CARD = 'Comissão de repasse';

/* -------------------------------------------------------------- tests -- */

describe('FP-02 on the policy page', () => {
  let policyId: string;

  it('shows a policy without CR, with the Usina value and nothing assumed (REQ-273, CA-236)', async () => {
    policyId = await issuedPolicy({ proposalNumber: 'APL-FP02-1' });

    await openPolicy(policyId);

    expect(requests).toContain(`GET /policies/${policyId}/payout`);
    const cr = card(CR_CARD);
    expect(cr.textContent).toContain('Sem CR');
    // CT 30% over 1,000.00: the base the CR will apply to (REQ-274).
    expect(cr.textContent).toContain('R$ 300,00');
    expect(buttonsIn(CR_CARD)).toEqual(['Informar CR']);
  });

  it('lists it among the policies without CR, leading to the policy (REQ-286, CA-238)', async () => {
    await openPayouts();

    const row = rowWith('#without-rate', 'APL-FP02-1');
    expect(row.textContent).toContain('Ana Lima');
    expect(row.textContent).toContain('Corretora Alfa');
    expect(row.querySelector('a').getAttribute('href')).toBe(
      `/app/policies/detail.html?id=${encodeURIComponent(policyId)}`,
    );
  });

  it('refuses a CR with three decimals, in Portuguese (REQ-272, REJ-219)', async () => {
    await openPolicy(policyId);

    const before = snackbars().length;
    clickIn(CR_CARD, 'Informar CR');
    answerDialog('#dialog-payout-rate', { rate: '70.555' });

    const message = await nextSnackbar(before);
    expect(message).toContain('no máximo duas casas decimais');
    expect(message).toContain('REQ-272');
    expect((await callApi('GET', `/policies/${policyId}/payout`)).situation).toBe('WITHOUT_CR');
  });

  it('informs the CR and always shows the resulting values (CA-225, CA-231)', async () => {
    await openPolicy(policyId);

    const before = snackbars().length;
    clickIn(CR_CARD, 'Informar CR');
    answerDialog('#dialog-payout-rate', { rate: '60' });

    const message = await nextSnackbar(before);
    expect(message).toContain('R$ 180,00 a repassar ao corretor');
    expect(message).toContain('R$ 120,00 ficam na Usina');

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('Calculada');
    });
    const cr = card(CR_CARD).textContent;
    expect(cr).toContain('R$ 180,00');
    expect(cr).toContain('R$ 120,00');
    // REQ-279, REQ-216: who informed it is on the record, by name.
    expect(cr).toContain(TEST_USER.name);
    expect(requests).toContain(`POST /policies/${policyId}/payout`);
  });

  it('drops out of the list of policies without CR once informed (CA-238)', async () => {
    await openPayouts();

    expect(rowWith('#without-rate', 'APL-FP02-1')).toBeUndefined();
  });

  it('refuses a recalculation without reason and records one with it (REQ-277, REQ-279, CA-230)', async () => {
    await openPolicy(policyId);
    expect(buttonsIn(CR_CARD)).toEqual(['Recalcular CR', 'Assinar elegibilidade']);

    const before = snackbars().length;
    clickIn(CR_CARD, 'Recalcular CR');
    answerDialog('#dialog-payout-revision', { rate: '70.55', reason: '  ' });
    const refusal = await nextSnackbar(before);
    expect(refusal).toContain('A alteração da CR exige um motivo.');
    expect(refusal).toContain('REQ-279');

    const beforeRevision = snackbars().length;
    clickIn(CR_CARD, 'Recalcular CR');
    answerDialog('#dialog-payout-revision', {
      rate: '70.55',
      reason: 'corretor renegociou',
    });
    // REQ-275: 300.00 x 70.55% = 211.65 exactly.
    expect(await nextSnackbar(beforeRevision)).toContain('R$ 211,65 a repassar');

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('corretor renegociou');
    });
    const history = card(CR_CARD).querySelectorAll('.payout-history tbody tr');
    expect(history).toHaveLength(2);
    // The earlier calculation stays as it was (REQ-279).
    expect(history[0].textContent).toContain('R$ 180,00');
    expect(history[1].textContent).toContain('60%');
    expect(history[1].textContent).toContain(TEST_USER.name);
  });

  it('signs the eligibility and shows the statement, then offers nothing else (REQ-281 to REQ-283)', async () => {
    await openPolicy(policyId);

    const before = snackbars().length;
    clickIn(CR_CARD, 'Assinar elegibilidade');
    answerDialog('#dialog-payout-eligibility', {});
    expect(await nextSnackbar(before)).toContain('Elegibilidade assinada');

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('Elegível');
    });

    const statement = card(CR_CARD).querySelector('.payout-statement').textContent;
    for (const expected of [
      'APL-FP02-1',
      'Corretora Alfa',
      'Ana Lima',
      'R$ 1.000,00',
      '30%',
      '70,55%',
      'R$ 300,00',
      'R$ 88,35',
      'R$ 211,65',
      TEST_USER.name,
    ]) {
      expect(statement).toContain(expected);
    }
    // No CTU: the receipt was direct.
    expect(statement).not.toContain('CTU');
    // REQ-282: definitive — nothing is offered any more.
    expect(buttonsIn(CR_CARD)).toEqual([]);
  });

  it('refuses any change to the eligible commission (EX-206, REJ-228)', async () => {
    const response = await rawApi('POST', `/policies/${policyId}/payout/revision`, {
      rate: '50',
      reason: 'ajuste',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-282' });
  });
});

describe('FP-02 edge cases', () => {
  it('bases the CR on the Usina value through the intermediary (CA-226, FA-213)', async () => {
    const policyId = await issuedPolicy({
      proposalNumber: 'APL-FP02-INT',
      workedCommission: '20',
      intermediary: { intermediaryId: 'Mega', ctu: '80' },
    });

    const view = await callApi('POST', `/policies/${policyId}/payout`, {
      rate: '70',
    });

    expect(view.usinaValue).toBe('160.00');
    expect(view.commission).toMatchObject({ payout: '112.00', retained: '48.00' });
  });

  it('keeps a policy with parcelled CT out of the CR (REQ-271, CA-240, FA-214)', async () => {
    const policyId = await issuedPolicy({ proposalNumber: 'APL-FP02-PARC', mode: 'PARCELLED' });

    await openPolicy(policyId);
    expect(card(CR_CARD).textContent).toContain('CT parcelada');
    // REQ-287: the parcelled CT has its own two CRs, not the single CR.
    expect(buttonsIn(CR_CARD)).toEqual(['Informar CRs']);

    await openPayouts();
    expect(rowWith('#without-rate', 'APL-FP02-PARC')).toBeUndefined();

    const refusal = await rawApi('POST', `/policies/${policyId}/payout`, {
      rate: '60',
    });
    expect(refusal.status).toBe(422);
    expect(await refusal.json()).toMatchObject({ rule: 'REQ-271' });
  });

  it('refuses the eligibility of a policy without CR (EX-205, REJ-226)', async () => {
    const policyId = await issuedPolicy({ proposalNumber: 'APL-FP02-NOCR' });

    const response = await rawApi('POST', `/policies/${policyId}/payout/eligibility`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-273',
      message: 'A apólice ainda não tem CR informada.',
    });
  });

  it('refuses a second CR on the same policy (REQ-271, REJ-217)', async () => {
    const policyId = await issuedPolicy({ proposalNumber: 'APL-FP02-TWICE' });
    await callApi('POST', `/policies/${policyId}/payout`, { rate: '60' });

    const response = await rawApi('POST', `/policies/${policyId}/payout`, {
      rate: '50',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-271' });
  });

  it('rejects a CR sent as a JSON number, and a malformed filter (REQ-120)', async () => {
    const policyId = await issuedPolicy({ proposalNumber: 'APL-FP02-NUM' });

    expect((await rawApi('POST', `/policies/${policyId}/payout`, { rate: 60 })).status).toBe(400);
    expect((await rawApi('GET', '/payouts/eligible?renewalFrom=2027-13')).status).toBe(400);
    expect((await rawApi('GET', '/payouts/eligible?eligibleFrom=ontem')).status).toBe(400);
  });
});

describe('the eligible commissions on the payouts page (REQ-284)', () => {
  it('filters by part of the broker and the client, and leads to the policy (CA-234, CA-235)', async () => {
    const beta = await issuedPolicy({
      proposalNumber: 'APL-BETA-1',
      clientName: 'Bruno Souza',
      brokerId: brokers.beta,
    });
    await callApi('POST', `/policies/${beta}/payout`, { rate: '50' });
    await callApi('POST', `/policies/${beta}/payout/eligibility`);

    await openPayouts();
    // The eligible commission of the journey above and this one.
    expect(rowWith('#eligible', 'APL-FP02-1')).toBeDefined();
    expect(rowWith('#eligible', 'APL-BETA-1')).toBeDefined();

    const form = document.querySelector('#eligible-filters');
    form.querySelector('[name="broker"]').value = 'beta';
    form.querySelector('[name="client"]').value = 'SOUZA';
    requests.length = 0;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(rowsOf('#eligible')).toHaveLength(1);
    });
    expect(requests).toContain('GET /payouts/eligible?broker=beta&client=SOUZA');

    const row = rowWith('#eligible', 'APL-BETA-1');
    expect(row.textContent).toContain('R$ 150,00');
    expect(row.querySelector('a').getAttribute('href')).toBe(
      `/app/policies/detail.html?id=${encodeURIComponent(beta)}`,
    );
  });

  it('filters by the renewal and the eligibility periods, both ends included (CA-234)', async () => {
    await openPayouts();

    const form = document.querySelector('#eligible-filters');
    form.querySelector('[name="renewalFrom"]').value = '2027-10';
    form.querySelector('[name="renewalUntil"]').value = '2027-10';
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    form.querySelector('[name="eligibleFrom"]').value = day;
    form.querySelector('[name="eligibleUntil"]').value = day;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(rowWith('#eligible', 'APL-BETA-1')).toBeDefined();
    });
    expect(rowWith('#eligible', 'APL-FP02-1')).toBeDefined();

    // A renewal period that does not reach October 2027 leaves nothing.
    form.querySelector('[name="renewalUntil"]').value = '2027-09';
    form.querySelector('[name="renewalFrom"]').value = '2027-01';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(text('#eligible')).toContain('Nenhuma comissão elegível');
    });
  });
});
