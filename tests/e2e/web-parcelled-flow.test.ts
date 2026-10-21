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
import { chooseBroker, registerBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { registerIntermediary } from './support/intermediaries.ts';
import { TEST_USER, signIn } from './support/sign-in.ts';

/**
 * The flow of the parcelled CT (V2 sections 6A and 9B), driven through the
 * pages the way an operator drives it: the proposal with its two CTs and the
 * expected value of each installment, the corrections before issuance, and on
 * the policy the two CRs and the eligibility of each installment.
 *
 * Same harness as `web-fp01-flow.test.ts` and `web-payout-flow.test.ts`: the
 * real server over SQLite on disk, the pages as they are on disk, asserted on
 * both sides — the screen and what the backend stored.
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
/** REQ-307: the registered broker the proposals name. */
let brokerId: string;

const requests: string[] = [];

/** jsdom has `<dialog>` without its modal behaviour; this is the part the page uses. */
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-parcelled-'));
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
  // REQ-229: the intermediary an integral proposal is received through.
  await registerIntermediary(baseUrl, 'Mega', 'Mega Intermediação');

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

function text(selector = '#page'): string {
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

function choose(form: string, name: string, value: string): void {
  const select = field(form, name);
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function hidden(selector: string): boolean {
  return document.querySelector(selector)?.closest('.hidden') !== null;
}

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

async function nextSnackbar(before: number): Promise<string> {
  await vi.waitFor(() => {
    expect(snackbars().length).toBeGreaterThan(before);
  });
  return snackbars().at(-1) ?? '';
}

/** The card whose title is `title`, as the operator sees it. */
function card(title: string): Untyped {
  const found = [...document.querySelectorAll('#page section.card')].find((section: Untyped) =>
    section.querySelector('.card__header .text-title')?.textContent?.includes(title),
  );
  if (found === undefined) {
    throw new Error(`No card titled ${title} on screen.`);
  }
  return found;
}

function buttonsIn(title: string): string[] {
  return [...card(title).querySelectorAll('button')].map((node: Untyped) =>
    (node.textContent ?? '').replace(/^[a-z_]+/, '').trim(),
  );
}

function clickIn(title: string, label: string, within: Untyped = card(title)): void {
  const button = [...within.querySelectorAll('button')].find((node: Untyped) =>
    node.textContent?.includes(label),
  );
  if (button === undefined) {
    throw new Error(`No button "${label}" in ${title}.`);
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

async function rawApi(method: string, apiPath: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${apiPath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function callApi(method: string, apiPath: string, body?: unknown): Promise<Untyped> {
  return (await rawApi(method, apiPath, body)).json();
}

const THREE_OF_100 = [{ amount: '100.00' }, { amount: '100.00' }, { amount: '100.00' }];

async function awaitingProposal(overrides: Record<string, unknown> = {}): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    client: clientNamed('Ana Lima'),
    brokerId,
    insurerId: 'ALLIANZ',
    productId: 'Auto',
    paymentMethodId: 'credit',
    proposalNumber: 'PRP-PARC',
    netPremium: '300.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: THREE_OF_100,
    workedCommission: '100',
    subsequentWorkedCommission: '30',
    workedCommissionMode: 'PARCELLED',
    intermediary: null,
    ...overrides,
  });
  return proposal.id;
}

async function parcelledPolicy(proposalNumber: string): Promise<string> {
  const proposalId = await awaitingProposal({ proposalNumber });
  // These journeys find the policy by the number they gave the business.
  return (await callApi('POST', '/policies', recognitionBody(proposalId, proposalNumber))).id;
}

async function openProposal(id: string): Promise<void> {
  vi.resetModules();
  openPage('proposals/detail.html', `?id=${id}`);
  await import('/app/proposals/detail.js');
  await vi.waitFor(() => {
    expect(document.querySelector('.stage-strip')).not.toBeNull();
  });
}

async function openPolicy(policyId: string): Promise<void> {
  vi.resetModules();
  openPage('policies/detail.html', `?id=${policyId}`);
  await import('/app/policies/detail.js');
  await vi.waitFor(() => {
    expect(document.querySelector('#page .skeleton')).toBeNull();
  });
}

async function openPayouts(): Promise<void> {
  vi.resetModules();
  openPage('payouts/index.html');
  await import('/app/payouts/index.js');
  await vi.waitFor(() => {
    expect(document.querySelector('#parcelled .skeleton')).toBeNull();
    expect(document.querySelector('#without-rate .skeleton')).toBeNull();
  });
}

function rowWith(selector: string, content: string): Untyped {
  return [...document.querySelectorAll(`${selector} tbody tr`)].find((row: Untyped) =>
    row.textContent.includes(content),
  );
}

const CR_CARD = 'Comissão de repasse';
const INSTALLMENTS_CARD = 'Parcelas';

/* ------------------------------------------- the proposal (section 6A) -- */

describe('registering a parcelled proposal (REQ-290 to REQ-296)', () => {
  it('asks for the CT of the subsequent installments only with a parcelled CT (REQ-291, CA-245)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    expect(hidden('#form-proposal [name="subsequentWorkedCommission"]')).toBe(true);

    choose('#form-proposal', 'workedCommissionMode', 'PARCELLED');
    expect(hidden('#form-proposal [name="subsequentWorkedCommission"]')).toBe(false);
    expect(text('#form-proposal')).toContain('CT da primeira parcela');
    expect(text('#form-proposal')).toContain('CT das parcelas subsequentes');

    choose('#form-proposal', 'workedCommissionMode', 'INTEGRAL');
    expect(hidden('#form-proposal [name="subsequentWorkedCommission"]')).toBe(true);
  });

  it('registers it and shows only the expected value of each installment (REQ-293, CA-246)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    for (const [name, value] of Object.entries({
      clientName: 'Ana Lima',
      clientCpf: clientNamed('Ana Lima').cpf,
      insurerId: 'ALLIANZ',
      productId: 'Auto',
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-WEB-PARC',
      netPremium: '300.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
    })) {
      field('#form-proposal', name).value = value;
    }
    await chooseBroker(document, window, 'alfa', 'Corretora Alfa');
    choose('#form-proposal', 'workedCommissionMode', 'PARCELLED');
    field('#form-proposal', 'workedCommission').value = '100';
    field('#form-proposal', 'subsequentWorkedCommission').value = '30';
    for (let index = 0; index < 3; index++) {
      click('#add-installment');
    }
    for (const input of document.querySelectorAll('#installments [name="amount"]')) {
      input.value = '100.00';
    }
    submit('#form-proposal');

    await vi.waitFor(() => {
      expect(text('#done-body')).toContain('PRP-WEB-PARC');
    });
    const done = text('#done-body');
    expect(done).toContain('Parcela 1');
    expect(done).toContain('R$ 100,00');
    expect(done).toContain('R$ 30,00');
    // REJ-232: no total.
    expect(done).not.toContain('R$ 160,00');

    const listed = await callApi('GET', '/proposals');
    const stored = listed.find((proposal: Untyped) => proposal.proposalNumber === 'PRP-WEB-PARC');
    expect(stored).toMatchObject({
      workedCommissionMode: 'PARCELLED',
      workedCommission: '100',
      subsequentWorkedCommission: '30',
      expectedReceipt: null,
    });
  });

  it('shows the refusal of an intermediary with a parcelled CT, in Portuguese (REQ-296, EX-207)', async () => {
    openPage('proposals/new.html');
    await import('/app/proposals/new.js');

    for (const [name, value] of Object.entries({
      clientName: 'Ana Lima',
      clientCpf: clientNamed('Ana Lima').cpf,
      insurerId: 'ALLIANZ',
      productId: 'Auto',
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-WEB-PARC-INT',
      netPremium: '300.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
    })) {
      field('#form-proposal', name).value = value;
    }
    await chooseBroker(document, window, 'alfa', 'Corretora Alfa');
    choose('#form-proposal', 'workedCommissionMode', 'PARCELLED');
    field('#form-proposal', 'workedCommission').value = '100';
    field('#form-proposal', 'subsequentWorkedCommission').value = '30';
    click('#add-installment');
    click('#add-installment');
    for (const input of document.querySelectorAll('#installments [name="amount"]')) {
      input.value = '100.00';
    }
    choose('#form-proposal', 'receiptKind', 'INTERMEDIARY');
    // REQ-229: the dropdown starts at the first registered intermediary.
    await vi.waitFor(() => {
      expect(field('#form-proposal', 'intermediaryId').value).toBe('Mega');
    });
    field('#form-proposal', 'ctu').value = '50';
    submit('#form-proposal');

    const message = await nextSnackbar(0);
    expect(message).toContain('não pode ser recebida através de intermediária');
    expect(message).toContain('REQ-296');
    expect(hidden('[data-panel="done"]')).toBe(true);
  });
});

describe('a parcelled proposal awaiting issuance (REQ-254, REQ-297, REQ-299)', () => {
  it('shows both CTs and the expected value of each installment (REQ-291, REQ-293)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-SHOW-PARC' });
    await openProposal(id);

    const ct = text('[data-definition="workedCommission"]');
    expect(ct).toContain('100%');
    expect(ct).toContain('30%');
    expect(ct).toContain('Parcelada');
    const expected = text('#expected');
    expect(expected).toContain('Parcela 1');
    expect(expected).toContain('R$ 100,00');
    expect(expected).toContain('Parcela 3');
    expect(expected).toContain('R$ 30,00');
  });

  it('lists it beside an integral proposal, with both CTs and no total (REQ-232, REQ-293, REJ-232)', async () => {
    await awaitingProposal({ proposalNumber: 'PRP-LIST-PARC' });
    await awaitingProposal({
      proposalNumber: 'PRP-LIST-INT',
      workedCommission: '20',
      subsequentWorkedCommission: null,
      workedCommissionMode: 'INTEGRAL',
    });

    vi.resetModules();
    openPage('proposals/index.html');
    await import('/app/proposals/index.js');
    await vi.waitFor(() => {
      expect(document.querySelector('#list .skeleton')).toBeNull();
    });

    const parcelled = rowWith('#list', 'PRP-LIST-PARC');
    expect(parcelled.textContent).toContain('100% · demais 30%');
    expect(parcelled.textContent).toContain('Por parcela');
    // The integral one keeps its single expected value: 300.00 × 20%.
    expect(rowWith('#list', 'PRP-LIST-INT').textContent).toContain('R$ 60,00');
  });

  it('corrects both CTs, signed (REQ-297)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-CT-PARC' });
    await openProposal(id);

    field('#form-worked-commission', 'workedCommission').value = '90';
    field('#form-worked-commission', 'subsequentWorkedCommission').value = '25';
    submit('#form-worked-commission');

    await vi.waitFor(() => {
      expect(text('#expected')).toContain('R$ 90,00');
    });
    expect(text('#expected')).toContain('R$ 25,00');
    expect(text('#history')).toContain(TEST_USER.name);
    const stored = await callApi('GET', `/proposals/${id}`);
    expect(stored.subsequentWorkedCommission).toBe('25');
  });

  it('corrects the installments, signed, and keeps who did it (REQ-254, CA-261)', async () => {
    const id = await awaitingProposal({ proposalNumber: 'PRP-INST-PARC' });
    await openProposal(id);

    const amounts = document.querySelectorAll('#form-installments [name="amount"]');
    expect(amounts).toHaveLength(3);
    amounts[0].value = '200.00';
    click('#form-installments .installment-row:last-child .installment-row__remove');
    submit('#form-installments');

    await vi.waitFor(() => {
      expect(text('#expected')).toContain('R$ 200,00');
    });
    expect(text('#expected')).not.toContain('Parcela 3');
    expect(text('#history')).toContain(`Parcelas · ${TEST_USER.name}`);
    expect(requests).toContain(`POST /proposals/${id}/installments`);
  });

  it('refuses leaving a parcelled proposal with one installment, in Portuguese (REQ-292, CA-268)', async () => {
    const id = await awaitingProposal({
      proposalNumber: 'PRP-INST-ONE',
      installments: [{ amount: '100.00' }, { amount: '100.00' }],
    });
    await openProposal(id);

    click('#form-installments .installment-row:last-child .installment-row__remove');
    submit('#form-installments');

    const message = await nextSnackbar(0);
    expect(message).toContain('ao menos duas parcelas');
    expect(message).toContain('REQ-292');
    expect((await callApi('GET', `/proposals/${id}`)).installments).toHaveLength(2);
  });

  it('refuses switching to parcelled while an intermediary is declared (REQ-299, EX-210)', async () => {
    const id = await awaitingProposal({
      proposalNumber: 'PRP-SWITCH-INT',
      workedCommissionMode: 'INTEGRAL',
      workedCommission: '20',
      subsequentWorkedCommission: null,
      intermediary: { intermediaryId: 'Mega', ctu: '50' },
    });
    await openProposal(id);

    choose('#form-worked-commission', 'workedCommissionMode', 'PARCELLED');
    field('#form-worked-commission', 'workedCommission').value = '100';
    field('#form-worked-commission', 'subsequentWorkedCommission').value = '30';
    submit('#form-worked-commission');

    const message = await nextSnackbar(0);
    expect(message).toContain('REQ-296');
    expect((await callApi('GET', `/proposals/${id}`)).workedCommissionMode).toBe('INTEGRAL');
  });

  it('lets an integral proposal gain installments and switch to parcelled (REQ-254, REQ-299, FA-219)', async () => {
    const id = await awaitingProposal({
      proposalNumber: 'PRP-SWITCH-OK',
      workedCommissionMode: 'INTEGRAL',
      workedCommission: '20',
      subsequentWorkedCommission: null,
      installments: [],
    });
    await openProposal(id);

    click('#add-installment-correction');
    click('#add-installment-correction');
    for (const input of document.querySelectorAll('#form-installments [name="amount"]')) {
      input.value = '150.00';
    }
    submit('#form-installments');
    await vi.waitFor(() => {
      expect(text('#history')).toContain(`Parcelas · ${TEST_USER.name}`);
    });

    choose('#form-worked-commission', 'workedCommissionMode', 'PARCELLED');
    field('#form-worked-commission', 'workedCommission').value = '100';
    field('#form-worked-commission', 'subsequentWorkedCommission').value = '30';
    submit('#form-worked-commission');

    await vi.waitFor(() => {
      expect(text('[data-definition="workedCommission"]')).toContain('Parcelada');
    });
    expect(text('#expected')).toContain('R$ 150,00');
    expect(text('#expected')).toContain('R$ 45,00');
  });
});

/* -------------------------------------------- the policy (section 9B) -- */

describe('a parcelled policy (V2 section 9B)', () => {
  let policyId: string;

  it('shows each installment with its CT and Usina value, and no confirmation of payment (REQ-269, REQ-293)', async () => {
    policyId = await parcelledPolicy('APL-PARC-1');

    await openPolicy(policyId);

    expect(requests).toContain(`GET /policies/${policyId}/parcelled-payout`);
    const installments = card(INSTALLMENTS_CARD).textContent;
    expect(installments).toContain('100%');
    expect(installments).toContain('30%');
    expect(installments).toContain('R$ 30,00');
    expect(installments).not.toContain('Pendente');
    expect(buttonsIn(INSTALLMENTS_CARD)).toEqual([]);
    // REQ-227: no agreed commission for a parcelled CT.
    expect(card('Comissão').textContent).toContain('não se aplica a CT parcelada');
    expect(card(CR_CARD).textContent).toContain('Sem CR');
    expect(buttonsIn(CR_CARD)).toEqual(['Informar CRs']);
  });

  it('lists it among the parcelled policies as without CR, and not among the integral ones (REQ-268, CA-265)', async () => {
    await openPayouts();

    const row = rowWith('#parcelled', 'APL-PARC-1');
    expect(row.textContent).toContain('Sem CR');
    expect(row.textContent).toContain('Ana Lima');
    expect(row.querySelector('a').getAttribute('href')).toBe(
      `/app/policies/detail.html?id=${encodeURIComponent(policyId)}`,
    );
    expect(rowWith('#without-rate', 'APL-PARC-1')).toBeUndefined();
  });

  it('refuses a CR above its CT, in Portuguese (REQ-263, EX-213)', async () => {
    await openPolicy(policyId);

    const before = snackbars().length;
    clickIn(CR_CARD, 'Informar CRs');
    answerDialog('#dialog-parcelled-rates', {
      firstRate: '100',
      subsequentRate: '31',
    });

    const message = await nextSnackbar(before);
    expect(message).toContain('CT das parcelas subsequentes');
    expect(message).toContain('REQ-263');
  });

  it('informs both CRs and shows the payout of each installment (REQ-287, REQ-264, CA-254)', async () => {
    await openPolicy(policyId);

    clickIn(CR_CARD, 'Informar CRs');
    answerDialog('#dialog-parcelled-rates', {
      firstRate: '100',
      subsequentRate: '15',
    });

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('Nenhuma parcela elegida');
    });
    const installments = card(INSTALLMENTS_CARD).textContent;
    expect(installments).toContain('15%');
    expect(installments).toContain('R$ 15,00');
    expect(card(CR_CARD).textContent).toContain(TEST_USER.name);
    expect(buttonsIn(CR_CARD)).toEqual(['Alterar CRs']);
  });

  it('changes both CRs with a reason and shows both in the history (REQ-265, CA-255)', async () => {
    await openPolicy(policyId);

    clickIn(CR_CARD, 'Alterar CRs');
    answerDialog('#dialog-parcelled-revision', {
      firstRate: '90',
      subsequentRate: '20',
      reason: 'acordo revisto',
    });

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('acordo revisto');
    });
    const history = card(CR_CARD).querySelectorAll('.payout-history tbody tr');
    expect(history).toHaveLength(2);
    expect(history[1].textContent).toContain('90%');
    expect(history[1].textContent).toContain('20%');
    expect(history[1].textContent).toContain(TEST_USER.name);
  });

  it('signs the eligibility of one installment and shows its statement; the CRs freeze (REQ-288, REQ-266, REQ-289)', async () => {
    await openPolicy(policyId);

    const row = [...card(INSTALLMENTS_CARD).querySelectorAll('tbody tr')][1];
    clickIn(INSTALLMENTS_CARD, 'Assinar elegibilidade', row);
    answerDialog('#dialog-installment-eligibility', {});

    await vi.waitFor(() => {
      expect(card(CR_CARD).textContent).toContain('Parcialmente elegida');
    });
    const statement = card(CR_CARD).querySelector('.payout-statement').textContent;
    for (const expected of [
      'APL-PARC-1',
      'Corretora Alfa',
      'ALLIANZ',
      'Ana Lima',
      'Parcela 2',
      'R$ 100,00',
      '30%',
      '20%',
      'R$ 10,00',
      'R$ 20,00',
      TEST_USER.name,
    ]) {
      expect(statement).toContain(expected);
    }
    // REQ-289: no change of the CRs any more.
    expect(buttonsIn(CR_CARD)).toEqual([]);
  });

  it('shows the new situation on the list of parcelled policies (REQ-268, CA-267)', async () => {
    await openPayouts();

    expect(rowWith('#parcelled', 'APL-PARC-1').textContent).toContain('Parcialmente elegida');
  });

  it('refuses the eligibility of an installment without CR, and the confirmation of payment (REQ-288, REQ-269)', async () => {
    const other = await parcelledPolicy('APL-PARC-2');

    const eligibility = await rawApi('POST', `/policies/${other}/installments/1/eligibility`);
    expect(eligibility.status).toBe(422);
    expect(await eligibility.json()).toMatchObject({ rule: 'REQ-288' });

    const payment = await rawApi('POST', `/policies/${other}/installments/1/payment`);
    expect(payment.status).toBe(422);
    expect(await payment.json()).toMatchObject({ rule: 'REQ-269' });
  });
});
