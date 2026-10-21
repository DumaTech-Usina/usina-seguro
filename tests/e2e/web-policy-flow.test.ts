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
import { type SignedIn, TEST_USER, signIn } from './support/sign-in.ts';

/**
 * The policy screen, driven the way an operator drives it.
 *
 * This is where FP-01 lands: the agreed commission (REQ-236), the override of
 * REQ-066 and the receipt confirmation of an installment (IN-13).
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
/** REQ-307: the registered broker the proposals of this journey name. */
let brokerId: string;
let signedIn: SignedIn;

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

  // REQ-410: every journey starts logged in, as the test user.
  signedIn = await signIn(application.useCases, baseUrl);
  brokerId = await registerBroker(baseUrl, 'Corretora Alfa', 1);

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
    client: clientNamed('client-1'),
    brokerId,
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
  });

  const policy = await callApi(
    'POST',
    '/policies',
    recognitionBody(proposal.id, numbers.policyNumber),
  );

  return policy.id;
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

    // REQ-236: the agreed commission, calculated from the CT of the proposal.
    const commission = card('Comissão');
    expect(commission.textContent).toContain('Prevista');
    expect(commission.textContent).toContain('R$ 40,00');
  });

  it('refuses an override with no justification and applies one with it (REQ-066, REQ-067, REJ-010)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-OVR-1',
      policyNumber: 'PRP-OVR-1',
    });

    await openPolicy(policyId);

    const beforeRefusal = snackbars().length;
    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', { receivable: '45.00', justification: '' });

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(beforeRefusal);
    });
    expect(lastSnackbar()).toContain('Ajuste de comissão por apólice exige justificativa.');
    expect(lastSnackbar()).toContain('REQ-067');

    clickIn('Comissão', 'Ajustar comissão');
    answerDialog('#dialog-override', {
      receivable: '45.00',
      justification: 'acordo extraordinário com a seguradora',
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
    expect(commission.override.userId).toBe(signedIn.user.id);
  });

  it('confirms an installment paid by the client and says who did it (IN-13, REQ-123)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-PARC-1',
      policyNumber: 'PRP-PARC-1',
    });

    await openPolicy(policyId);

    clickIn('Parcelas', 'Confirmar recebimento');
    answerDialog('#dialog-installment', {});

    await vi.waitFor(() => {
      expect(card('Parcelas').textContent).toContain('Paga');
    });
    // REQ-123, REQ-216: who confirmed it is the session user, shown by name.
    expect(card('Parcelas').textContent).toContain(TEST_USER.name);
    expect(requests).toContain(`POST /policies/${policyId}/installments/1/payment`);

    const policy = await callApi('GET', `/policies/${policyId}`);
    expect(policy.installments[0]).toMatchObject({ status: 'PAID', confirmedBy: signedIn.user.id });
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

  it('sends a new PDF from the policy page, signed, and keeps only the last one (CA-243, CA-244)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-1',
      policyNumber: 'APL-DOC-1',
    });
    await openPolicy(policyId);
    // REQ-247: the PDF sent with the recognition, which is required.
    expect(text('#policy-document')).toContain('apolice.pdf');

    openSending();
    choosePdf(FIRST, 'apolice-nova.pdf');
    answerDialog('#dialog-policy-document', {});

    await vi.waitFor(() => {
      expect(text('#policy-document')).toContain('apolice-nova.pdf');
    });
    expect(requests).toContain(`POST /policies/${policyId}/document`);
    expect(text('#policy-document')).toContain(`Enviado por ${TEST_USER.name}`);
    const link = document.querySelector('#policy-document a');
    expect(link.getAttribute('href')).toBe(`/policies/${policyId}/document`);
    const first = await download(policyId);
    // Treated as a PDF; its content is not read (DEC-213).
    expect(first.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(FIRST);

    openSending();
    choosePdf(SECOND, 'apolice-corrigida.pdf');
    answerDialog('#dialog-policy-document', {});

    await vi.waitFor(() => {
      expect(text('#policy-document')).toContain('apolice-corrigida.pdf');
    });
    expect(text('#policy-document')).toContain(`Enviado por ${TEST_USER.name}`);
    expect(text('#policy-document')).not.toContain('apolice-nova.pdf');
    expect(new Uint8Array(await (await download(policyId)).arrayBuffer())).toEqual(SECOND);
  });

  it('opens the PDF in the viewer on click, and downloads it from its actions menu', async () => {
    const blobs: Untyped[] = [];
    const revoked: string[] = [];
    window.URL.createObjectURL = (blob: Untyped) => {
      blobs.push(blob);
      return `blob:pdf-${blobs.length}`;
    };
    window.URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-VIEW',
      policyNumber: 'PRP-DOC-VIEW',
    });
    await callApi('POST', `/policies/${policyId}/document`, {
      fileName: 'apolice.pdf',
      content: Buffer.from(FIRST).toString('base64'),
    });
    await openPolicy(policyId);

    const link = document.querySelector('#policy-document a');
    // The link still points at the download, for a new tab or "save as".
    expect(link.getAttribute('href')).toBe(`/policies/${policyId}/document`);
    link.click();

    await vi.waitFor(() => {
      expect(document.querySelector('dialog.pdf-viewer')?.open).toBe(true);
    });
    const viewer = document.querySelector('dialog.pdf-viewer');
    expect(viewer.textContent).toContain('apolice.pdf');
    expect(viewer.querySelector('iframe').getAttribute('src')).toBe('blob:pdf-1');
    // Always shown as a PDF, whatever type the upload carried.
    expect(blobs[0].type).toBe('application/pdf');
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(FIRST);

    const download = viewer.querySelector('.pdf-actions [data-action="download"]');
    expect(download.textContent).toContain('Baixar PDF');
    expect(download.getAttribute('href')).toBe(`/policies/${policyId}/document`);
    expect(download.getAttribute('download')).toBe('apolice.pdf');

    [...viewer.querySelectorAll('button')]
      .find((node: Untyped) => node.textContent === 'Fechar')
      .click();
    expect(document.querySelector('dialog.pdf-viewer')).toBeNull();
    expect(revoked).toEqual(['blob:pdf-1']);
  });

  it('closes the modal on a backdrop click, with the fields still empty, and sends nothing', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-BACKDROP',
      policyNumber: 'PRP-DOC-BACKDROP',
    });
    await openPolicy(policyId);
    const dialog = document.querySelector('#dialog-policy-document');

    openSending();
    expect(dialog.open).toBe(true);

    // A click on the content keeps it open.
    dialog.querySelector('[name="pdf"]').click();
    expect(dialog.open).toBe(true);

    // The backdrop is the dialog itself as the target.
    dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe('cancel');

    // Dismissed, not confirmed: nothing was sent.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).not.toContain(`POST /policies/${policyId}/document`);
  });

  it('closes the PDF viewer on a backdrop click', async () => {
    window.URL.createObjectURL = () => 'blob:pdf-backdrop';
    window.URL.revokeObjectURL = () => {};
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-VIEW-BACKDROP',
      policyNumber: 'PRP-DOC-VIEW-BACKDROP',
    });
    await callApi('POST', `/policies/${policyId}/document`, {
      fileName: 'apolice.pdf',
      content: Buffer.from(FIRST).toString('base64'),
    });
    await openPolicy(policyId);

    document.querySelector('#policy-document a').click();
    await vi.waitFor(() => {
      expect(document.querySelector('dialog.pdf-viewer')?.open).toBe(true);
    });
    const viewer = document.querySelector('dialog.pdf-viewer');

    viewer.querySelector('.pdf-viewer__title').click();
    expect(viewer.open).toBe(true);

    viewer.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('dialog.pdf-viewer')).toBeNull();
  });

  it('asks nobody to type who signs: every dialog of the policy is signed by the session (REQ-216)', async () => {
    const policyId = await registeredPolicy({
      proposalNumber: 'PRP-DOC-2',
      policyNumber: 'PRP-DOC-2',
    });
    await openPolicy(policyId);

    expect(document.querySelectorAll('dialog [name="userId"]')).toHaveLength(0);
  });
});
