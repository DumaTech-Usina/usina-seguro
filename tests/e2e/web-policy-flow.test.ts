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
 * This is where FP-01 lands and where the V1 conciliation is finished by hand:
 * the agreed and the real commission side by side (REQ-076), the manual
 * resolution of a divergence (REQ-085), the override of REQ-066 and the
 * receipt confirmation of an installment (IN-13).
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

/** A business the way FP-01 leaves it: policy registered, commission forecast. */
async function registeredPolicy(numbers: {
  proposalNumber: string;
  policyNumber: string;
}): Promise<string> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber: numbers.proposalNumber,
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [
      { amount: '50.00', dueDate: '2026-10-10' },
      { amount: '50.00', dueDate: '2026-11-10' },
    ],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    userId: 'operator',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    userId: 'operator',
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
      policyNumber: 'PRP-VIEW-1',
    });

    await openPolicy(policyId);

    expect(requests).toContain(`GET /policies/${policyId}`);
    expect(requests).toContain(`GET /policies/${policyId}/commission`);
    expect(text()).toContain('PRP-VIEW-1');
    expect(text()).toContain('PRP-VIEW-1');

    // REQ-021: the schedule the policy was registered with.
    expect(card('Parcelas').querySelectorAll('tbody tr')).toHaveLength(2);
    expect(card('Parcelas').textContent).toContain('Pendente');

    // CA-016: agreed and real side by side, with nothing apurado yet.
    const commission = card('Comissão');
    expect(commission.textContent).toContain('Prevista');
    expect(commission.textContent).toContain('R$ 40,00');
    expect(commission.textContent).toContain('Não apurado');
  });

  it('shows agreed and real side by side and flags the divergence (REQ-076, CA-016, CA-017)', async () => {
    const numbers = { proposalNumber: 'PRP-DIV-2', policyNumber: 'PRP-DIV-2' };
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
    const numbers = { proposalNumber: 'PRP-RES-1', policyNumber: 'PRP-RES-1' };
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
      policyNumber: 'PRP-OVR-1',
    });

    await openPolicy(policyId);

    const beforeRefusal = snackbars().length;
    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', { receivable: '45.00', justification: '', userId: 'adm-1' });

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(beforeRefusal);
    });
    expect(lastSnackbar()).toContain('Ajuste de comissão por apólice exige justificativa.');
    expect(lastSnackbar()).toContain('REQ-067');

    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', {
      receivable: '45.00',
      justification: 'acordo extraordinário com a seguradora',
      userId: 'adm-1',
    });

    await vi.waitFor(() => {
      expect(card('Comissão').textContent).toContain('Ajuste aplicado');
    });

    // REQ-124: the calculated value is preserved next to the adjusted one.
    expect(card('Comissão').textContent).toContain('R$ 45,00');
    expect(card('Comissão').textContent).toContain('acordo extraordinário com a seguradora');

    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.effectiveReceivable).toBe('45.00');
    expect(commission.override.userId).toBe('adm-1');
  });

  it('confirms an installment paid by the client and says who did it (IN-13, REQ-123)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-PARC-1',
      policyNumber: 'PRP-PARC-1',
    });

    await openPolicy(policyId);

    clickIn('Parcelas', 'Confirmar recebimento');
    answerDialog('#dialog-installment', { userId: 'fin-2' });

    await vi.waitFor(() => {
      expect(card('Parcelas').textContent).toContain('Paga');
    });
    expect(card('Parcelas').textContent).toContain('fin-2');
    expect(requests).toContain(`POST /policies/${policyId}/installments/1/payment`);

    const policy = await callApi('GET', `/policies/${policyId}`);
    expect(policy.installments[0]).toMatchObject({ status: 'PAID', confirmedBy: 'fin-2' });
  });

  it('says so when the policy does not exist', async () => {
    await openPolicy('does-not-exist');

    expect(text()).toContain('Apólice não encontrada');
    // The sentence is the one src/i18n rendered for the 404.
    expect(text()).toContain('does-not-exist');
  });
});

describe('the PDF of the policy (REQ-247)', () => {
  const FIRST = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const SECOND = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);

  /** Opens the sending dialog from the policy card. */
  function openSending(): void {
    const button = [...document.querySelectorAll('#policy-document button')].find((node: Untyped) =>
      node.textContent?.includes('Enviar PDF'),
    );
    button.click();
  }

  /** Puts a file in the dialog's input the way the browser does. */
  function choosePdf(bytes: Uint8Array, name: string): void {
    const input = document.querySelector('#dialog-policy-document [name="pdf"]');
    const file = new window.File([bytes], name, { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
  }

  async function download(policyId: string): Promise<Response> {
    return fetch(`${baseUrl}/policies/${policyId}/document`);
  }

  it('sends the PDF from the policy page, signed, and keeps only the last one (CA-243, CA-244)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-1',
      policyNumber: 'PRP-DOC-1',
    });
    await openPolicy(policyId);
    expect(text('#policy-document')).toContain('Nenhum PDF enviado.');

    openSending();
    choosePdf(FIRST, 'apolice.pdf');
    answerDialog('#dialog-policy-document', { userId: 'ana.souza' });

    await vi.waitFor(() => {
      expect(text('#policy-document')).toContain('apolice.pdf');
    });
    expect(requests).toContain(`POST /policies/${policyId}/document`);
    expect(text('#policy-document')).toContain('Enviado por ana.souza');
    const link = document.querySelector('#policy-document a');
    expect(link.getAttribute('href')).toBe(`/policies/${policyId}/document`);
    const first = await download(policyId);
    // Treated as a PDF; its content is not read (DEC-213).
    expect(first.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(FIRST);

    openSending();
    choosePdf(SECOND, 'apolice-corrigida.pdf');
    answerDialog('#dialog-policy-document', { userId: 'bruno.lima' });

    await vi.waitFor(() => {
      expect(text('#policy-document')).toContain('apolice-corrigida.pdf');
    });
    expect(text('#policy-document')).toContain('Enviado por bruno.lima');
    expect(text('#policy-document')).not.toContain('apolice.pdf');
    expect(new Uint8Array(await (await download(policyId)).arrayBuffer())).toEqual(SECOND);
  });

  it('refuses a sending nobody signed with the sentence the server rendered (REQ-216)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-2',
      policyNumber: 'PRP-DOC-2',
    });
    await openPolicy(policyId);

    openSending();
    choosePdf(FIRST, 'apolice.pdf');
    answerDialog('#dialog-policy-document', { userId: '  ' });

    await vi.waitFor(() => {
      expect(lastSnackbar()).toContain('Informe quem está registrando esta informação.');
    });
    expect((await callApi('GET', `/policies/${policyId}`)).document).toBeNull();
    expect((await download(policyId)).status).toBe(404);
  });
});
