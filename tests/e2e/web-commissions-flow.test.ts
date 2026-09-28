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
 * OUT-05 driven the way the Financeiro drives it: the panel of every policy,
 * and the path from a divergence to the policy where it is closed.
 *
 * FP-02 step 5 is manual work, and manual work needs a worklist that survives
 * the import that produced it. This file walks that whole loop — find the
 * divergence on the panel, open the policy it belongs to, resolve it with a
 * justification (REQ-085) and see the panel agree.
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

/**
 * jsdom implements `<dialog>` as an element and nothing else. The policy screen
 * asks for the justification of REQ-085 through one, so the three behaviours
 * the standard defines are supplied here, exactly as `web-policy-flow.test.ts`
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
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-commissions-'));
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

  // The three states FP-02 can leave a policy in: reported short, reported as
  // agreed, and never reported at all.
  await reconciled(await registeredPolicy('PRP-PANEL-DIV', 'PRP-PANEL-DIV'), '31.00');
  await reconciled(await registeredPolicy('PRP-PANEL-OK', 'PRP-PANEL-OK'), '40.00');
  await registeredPolicy('PRP-PANEL-FORE', 'PRP-PANEL-FORE');
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
 * Opens the panel and waits for the first reading to land.
 *
 * The module registry is reset first because a page opened twice in one
 * journey is loaded twice by the browser, and a cached module would leave the
 * screen showing the skeleton of a page that never ran.
 */
async function openPanel(): Promise<void> {
  vi.resetModules();
  openPage('commissions/index.html');
  await import('/app/commissions/index.js');

  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

/** Clicks one of the filters, the way an operator switches worklists. */
async function filterBy(label: string): Promise<void> {
  const tab = [...document.querySelectorAll('.filters__option')].find(
    (option: Untyped) => option.textContent === label,
  );

  if (tab === undefined) {
    throw new Error(`No filter "${label}" on screen.`);
  }

  tab.click();
  await vi.waitFor(() => {
    expect(document.querySelector('#list .skeleton')).toBeNull();
  });
}

function rows(): Untyped[] {
  return [...document.querySelectorAll('#list tbody tr')];
}

/** The line of a policy, found by the number that identifies it (REQ-020). */
function rowOf(policyNumber: string): Untyped {
  const found = rows().find((row: Untyped) =>
    row.querySelector('.policy-number')?.textContent?.includes(policyNumber),
  );

  if (found === undefined) {
    throw new Error(`No line for ${policyNumber} on screen.`);
  }
  return found;
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** Opens the policy screen the way the panel hands it over: by its link. */
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
async function registeredPolicy(proposalNumber: string, policyNumber: string): Promise<Business> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    proposalNumber: proposalNumber,
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [{ amount: '100.00', dueDate: '2026-10-10' }],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    userId: 'operator',
  });

  const policy = await callApi('POST', '/policies', {
    proposalId: proposal.id,
    userId: 'operator',
  });

  return { policyId: policy.id, proposalNumber, policyNumber };
}

/** FP-02 step 3: a line of the report matched this policy. */
async function reconciled(business: Business, producerCommission: string): Promise<Business> {
  await callApi('POST', '/commission-reconciliations', {
    competence: '2026-10',
    lines: [
      {
        policyNumber: business.policyNumber,
        proposalNumber: business.proposalNumber,
        producerCommission,
      },
    ],
  });

  return business;
}

/* -------------------------------------------------------------- tests -- */

describe('the agreed versus real panel (OUT-05)', () => {
  it('shows every policy with both values side by side (REQ-076, CA-016)', async () => {
    await openPanel();

    expect(requests).toContain('GET /commissions');
    expect(rows()).toHaveLength(3);

    // The one the report paid short: both values, and the flag of CA-017.
    const divergent = rowOf('PRP-PANEL-DIV');
    expect(divergent.textContent).toContain('R$ 40,00');
    expect(divergent.textContent).toContain('R$ 31,00');
    expect(divergent.textContent).toContain('Acordado ≠ real');
    expect(divergent.textContent).toContain('Divergente');
    // REQ-086: the competence the real value came from.
    expect(divergent.textContent).toContain('2026-10');
    // REQ-050, REQ-022: what identifies the business to a human.
    expect(divergent.textContent).toContain('PRP-PANEL-DIV');
    expect(divergent.textContent).toContain('client-1');

    const agreed = rowOf('PRP-PANEL-OK');
    expect(agreed.textContent).toContain('Conciliada');
    expect(agreed.textContent).not.toContain('Acordado ≠ real');

    // REQ-075: no report ever matched this one, which is not the same as zero.
    const forecast = rowOf('PRP-PANEL-FORE');
    expect(forecast.textContent).toContain('Não apurado');
    expect(forecast.textContent).toContain('Prevista');

    expect(text('#summary')).toContain('3 apólices');
    expect(text('#summary')).toContain('1 com divergência');
  });

  it('narrows to the divergences with a new reading, not a local slice', async () => {
    await openPanel();

    await filterBy('Divergentes');

    // FP-02 step 5: the worklist is asked of the backend by state.
    expect(requests).toContain('GET /commissions?status=DIVERGENT');
    expect(rows()).toHaveLength(1);
    expect(rowOf('PRP-PANEL-DIV')).toBeDefined();

    // REQ-077: the divergence is signalled, and the other policies are still
    // there — nothing was blocked or hidden.
    await filterBy('Todas');
    expect(rows()).toHaveLength(3);
  });

  it('carries the operator from the divergence to the policy that holds it', async () => {
    await openPanel();
    await filterBy('Divergentes');

    const link = rowOf('PRP-PANEL-DIV').querySelector('a.btn');
    const [divergent] = await callApi('GET', '/commissions?status=DIVERGENT');

    // Where the line lands next: the policy is where REQ-085 closes it.
    expect(link.getAttribute('href')).toBe(`/app/policies/detail.html?id=${divergent.policyId}`);
  });

  it('closes the loop: the divergence resolved on the policy leaves the worklist', async () => {
    await openPanel();
    await filterBy('Divergentes');

    // The operator follows the line to the policy and closes the divergence
    // there, which is where REQ-085 records who did it and why.
    await followToPolicy(rowOf('PRP-PANEL-DIV'));
    clickIn('Comissão', 'Resolver divergência');
    answerDialog('#dialog-resolution', {
      justification: 'seguradora confirmou 31,00',
      userId: 'fin-1',
    });

    await vi.waitFor(() => {
      expect(card('Comissão').textContent).toContain('Divergência resolvida');
    });

    // Back to the panel: the worklist is empty and the record is not.
    await openPanel();
    await filterBy('Divergentes');
    expect(rows()).toHaveLength(0);
    expect(text('#list')).toContain('Nenhuma divergência a tratar');

    await filterBy('Resolvidas');
    const resolved = rowOf('PRP-PANEL-DIV');
    expect(resolved.textContent).toContain('Resolvida');
    // REQ-124, REJ-014: the values that disagreed are still side by side.
    expect(resolved.textContent).toContain('R$ 40,00');
    expect(resolved.textContent).toContain('R$ 31,00');
  });

  it('shows the adjusted value beside the calculated one (REQ-066, REQ-124)', async () => {
    const [forecast] = await callApi('GET', '/commissions?status=FORECAST');

    await callApi('POST', `/policies/${forecast.policyId}/commission/override`, {
      receivable: '45.00',
      justification: 'acordo extraordinario com a seguradora',
      userId: 'admin-1',
    });

    await openPanel();

    const adjusted = rowOf('PRP-PANEL-FORE');
    expect(adjusted.textContent).toContain('R$ 45,00');
    // The calculated value is not replaced by the adjustment, it is beside it.
    expect(adjusted.textContent).toContain('calculado R$ 40,00');
  });
});
