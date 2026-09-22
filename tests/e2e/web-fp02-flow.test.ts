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
 * FP-02 driven the way the Financeiro drives it: through the page.
 *
 * Nothing here is a mock. The server is the real one, listening on an ephemeral
 * port over SQLite on disk; the module under test is the same file the browser
 * downloads. What is asserted is behaviour on both sides — what the screen
 * shows, and what the backend stored because of it.
 *
 * The entry is the one the confirmed rules take: lines already structured. The
 * file itself is DEC-001, so no parser is exercised here and none exists.
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

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-fp02-'));
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

  await callApi('POST', '/broker-commission-rates', { brokerId: 'broker-1', rate: '50' });
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

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function submit(form: string): void {
  document.querySelector(form)?.dispatchEvent(new Event('submit', { cancelable: true }));
}

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

/** Opens the page and fills the report with one line, as an operator would. */
async function openReport(
  competence: string,
  line: { policyNumber?: string; proposalNumber: string; producerCommission: string },
): Promise<void> {
  openPage('reconciliations/index.html');
  await import('/app/reconciliations/index.js');

  // The pendencies of OUT-06 are read as soon as the page opens.
  await vi.waitFor(() => {
    expect(document.querySelector('#pendencies .skeleton')).toBeNull();
  });

  document.querySelector('#competence').value = competence;
  const row = document.querySelector('#lines .line-row');
  row.querySelector('[name="policyNumber"]').value = line.policyNumber ?? '';
  row.querySelector('[name="proposalNumber"]').value = line.proposalNumber;
  row.querySelector('[name="producerCommission"]').value = line.producerCommission;
}

function resultRows(): Untyped[] {
  return [...document.querySelectorAll('#result tbody tr')];
}

/** The outcome of the single line on screen, as the chip renders it. */
function outcomeChip(): string {
  return resultRows()[0]?.querySelector('.chip')?.textContent ?? '';
}

function pendencyRows(): Untyped[] {
  return [...document.querySelectorAll('#pendencies tbody tr')];
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

/**
 * A business the way FP-01 leaves it: proposal transmitted, policy registered,
 * agreed commission calculated. Premium 100.00 with the rates above makes the
 * agreed receivable 40.00.
 */
async function registeredPolicy(
  proposalNumber: string,
  policyNumber: string,
): Promise<{ policyId: string }> {
  const proposal = await callApi('POST', '/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    customerAccepted: true,
    proposalNumber: proposalNumber,
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
    policyNumber,
    premium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [{ number: 1, amount: '100.00', dueDate: '2026-10-10' }],
  });

  return { policyId: policy.id };
}

/* -------------------------------------------------------------- tests -- */

describe('FP-02 through the web interface', () => {
  it('conciliates a line by the policy number and records the real value (steps 2 and 3a)', async () => {
    const { policyId } = await registeredPolicy('PRP-CONC-1', 'APL-CONC-1');

    await openReport('2026-10', {
      policyNumber: 'APL-CONC-1',
      proposalNumber: 'PRP-CONC-1',
      producerCommission: '40.00',
    });
    submit('#form-report');

    await vi.waitFor(() => {
      expect(resultRows().length).toBe(1);
    });

    expect(requests).toContain('POST /commission-reconciliations');
    expect(resultRows()[0].textContent).toContain('APL-CONC-1');
    expect(resultRows()[0].textContent).toContain('Conciliada');
    expect(text('#result')).toContain('Competência 2026-10');

    // The screen says it was conciliated; the backend has to agree (REQ-075).
    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.status).toBe('RECONCILED');
    expect(commission.realReceivable).toBe('40.00');
    expect(commission.reconciledCompetence).toBe('2026-10');
    expect(commission.divergent).toBe(false);
  });

  it('matches a line that brings only the proposal number (REQ-082, CA-019)', async () => {
    const { policyId } = await registeredPolicy('PRP-CONC-2', 'APL-CONC-2');

    await openReport('2026-10', { proposalNumber: 'PRP-CONC-2', producerCommission: '40.00' });
    submit('#form-report');

    await vi.waitFor(() => {
      expect(resultRows().length).toBe(1);
    });

    // The answer names the policy the line reached through the link of REQ-050.
    expect(resultRows()[0].textContent).toContain('APL-CONC-2');
    expect(resultRows()[0].textContent).toContain('Conciliada');
    expect((await callApi('GET', `/policies/${policyId}/commission`)).status).toBe('RECONCILED');
  });

  it('flags a divergence and hands over the policy where it is resolved (step 4)', async () => {
    const { policyId } = await registeredPolicy('PRP-DIV-1', 'APL-DIV-1');

    await openReport('2026-10', {
      policyNumber: 'APL-DIV-1',
      proposalNumber: 'PRP-DIV-1',
      // REQ-076: the report pays less than the agreement foresaw.
      producerCommission: '35.00',
    });
    submit('#form-report');

    await vi.waitFor(() => {
      expect(resultRows().length).toBe(1);
    });

    expect(resultRows()[0].textContent).toContain('Divergente');
    expect(text('#result')).toContain('Divergentes');

    // REQ-077: nothing was blocked — the import reported success.
    expect(snackbars().some((message) => message.includes('2026-10'))).toBe(true);

    // The line ends where the divergence is worked: the policy (REQ-085).
    const link = resultRows()[0].querySelector('a.btn');
    expect(link?.href).toContain(`/app/policies/detail.html?id=${policyId}`);

    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.status).toBe('DIVERGENT');
    expect(commission.divergent).toBe(true);
    expect(commission.effectiveReceivable).toBe('40.00');
    expect(commission.realReceivable).toBe('35.00');
  });

  it('turns a line with no policy into a pendency and lists it (step 3b, OUT-06)', async () => {
    await openReport('2026-11', {
      policyNumber: 'APL-NAO-EXISTE',
      proposalNumber: 'PRP-NAO-EXISTE',
      producerCommission: '12.34',
    });
    submit('#form-report');

    await vi.waitFor(() => {
      expect(resultRows().length).toBe(1);
    });

    expect(resultRows()[0].textContent).toContain('Pendência');
    // REQ-083, REJ-013: no policy, so no entry and nowhere to go.
    expect(resultRows()[0].querySelector('a.btn')).toBeNull();

    // OUT-06 is read again from the backend, not patched from the answer.
    await vi.waitFor(() => {
      expect(pendencyRows().length).toBeGreaterThan(0);
    });
    expect(requests.filter((entry) => entry.includes('pendencies')).length).toBe(2);

    const listed = pendencyRows().filter((row: Untyped) =>
      row.textContent?.includes('PRP-NAO-EXISTE'),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].textContent).toContain('R$ 12,34');
    expect(listed[0].textContent).toContain('2026-11');

    // CA-021, EX-05: importing the same report again does not duplicate the
    // pendency, and the line is still pending.
    submit('#form-report');
    await vi.waitFor(() => {
      expect(requests.filter((entry) => entry.includes('pendencies')).length).toBe(3);
    });
    expect(resultRows()[0].textContent).toContain('Pendência');
    expect(
      pendencyRows().filter((row: Untyped) => row.textContent?.includes('PRP-NAO-EXISTE')),
    ).toHaveLength(1);
  });

  it('does not conciliate the same competence twice (REQ-086, CA-021)', async () => {
    const { policyId } = await registeredPolicy('PRP-DUP-1', 'APL-DUP-1');

    await openReport('2026-10', {
      policyNumber: 'APL-DUP-1',
      proposalNumber: 'PRP-DUP-1',
      producerCommission: '40.00',
    });
    submit('#form-report');

    // The chip is read on its own: 'Ja conciliada' contains 'Conciliada'.
    await vi.waitFor(() => {
      expect(outcomeChip()).toBe('Conciliada');
    });

    submit('#form-report');
    await vi.waitFor(() => {
      expect(outcomeChip()).toBe('Já conciliada');
    });

    // Nothing was written a second time: the record is the one of the first import.
    const commission = await callApi('GET', `/policies/${policyId}/commission`);
    expect(commission.status).toBe('RECONCILED');
    expect(commission.realReceivable).toBe('40.00');
  });

  it('shows the refusal the server rendered when a rule is broken (REQ-086, REQ-120)', async () => {
    await registeredPolicy('PRP-ERR-1', 'APL-ERR-1');

    await openReport('   ', {
      policyNumber: 'APL-ERR-1',
      proposalNumber: 'PRP-ERR-1',
      producerCommission: '40.00',
    });
    submit('#form-report');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(0);
    });

    // The sentence is the one src/i18n rendered, with the rule beside it.
    expect(snackbars()[0]).toContain(
      'Importação do arquivo de comissionamento exige a competência.',
    );
    expect(snackbars()[0]).toContain('REQ-086');
    expect(document.querySelector('#result tbody')).toBeNull();

    // REQ-120: a comma is not a decimal string, and the domain is what says so.
    document.querySelector('#competence').value = '2026-12';
    document.querySelector('#lines [name="producerCommission"]').value = '40,00';
    submit('#form-report');

    await vi.waitFor(() => {
      expect(snackbars().length).toBeGreaterThan(1);
    });
    expect(snackbars()[1]).toContain('Valor monetário inválido');
    expect(document.querySelector('#result tbody')).toBeNull();
  });
});
