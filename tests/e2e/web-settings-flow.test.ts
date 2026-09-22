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
 * The registry screen driven the way the Administrator (ATR-003) drives it.
 *
 * IN-02, IN-05 and IN-06 are the parameters every calculation of this system
 * runs on, and REQ-061/REQ-125 make them data so they change without a deploy.
 * Until this slice the screen could only write them: a wrong percentage was
 * visible solely in the commission it had already produced, and a payment
 * method with no rule solely in the transfer it refused.
 *
 * This file walks the loop that closes it — open the screen, see what is
 * configured, register, see the record appear, correct it and see it replaced
 * rather than duplicated, and be refused in Portuguese when the chain is
 * incomplete.
 *
 * Nothing here is a mock. The server is the real one, listening on an ephemeral
 * port over SQLite on disk, and the module under test is the same file the
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

/** Every request the page made, in order, as `METHOD path`. */
const requests: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-settings-'));
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

function openPage(relativePath: string): void {
  const html = readFileSync(path.join(WEB_PUBLIC, relativePath), 'utf8');
  window.history.replaceState({}, '', `/app/${relativePath}`);

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

/**
 * Opens the screen and waits for the three registries to be read.
 *
 * The module registry is reset first because a page opened twice in one journey
 * is loaded twice by the browser, and a cached module would leave the screen
 * showing the skeleton of a page that never ran.
 */
async function openSettings(): Promise<void> {
  vi.resetModules();
  openPage('settings/index.html');
  await import('/app/settings/index.js');

  await vi.waitFor(() => {
    expect(document.querySelectorAll('.registry .skeleton')).toHaveLength(0);
  });
}

function field(form: string, name: string): Untyped {
  const input = document.querySelector(`${form} [name="${name}"]`);
  if (input === null) {
    throw new Error(`No field ${name} in ${form}.`);
  }
  return input;
}

function fill(form: string, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    field(form, name).value = value;
  }
}

/**
 * Submits and waits for the registry under that form to be read again.
 *
 * The wait is on the reading this submission caused, not on the page looking
 * settled: a snackbar from an earlier act is still on screen for six seconds,
 * and waiting for "a snackbar exists" would return before the new record was
 * fetched. The skeleton is rendered before the request goes out, so a request
 * recorded from here on with no skeleton left is this reading, finished.
 */
async function submit(form: string, region: string, route: string): Promise<void> {
  const from = requests.length;
  document.querySelector(form)?.dispatchEvent(new window.Event('submit', { cancelable: true }));

  await vi.waitFor(() => {
    expect(requests.slice(from)).toContain(`GET ${route}`);
    expect(document.querySelectorAll(`${region} .skeleton`)).toHaveLength(0);
  });
}

function rows(region: string): Untyped[] {
  return [...document.querySelectorAll(`${region} tbody tr`)];
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function snackbars(): string[] {
  return [...document.querySelectorAll('.snackbar')].map((node: Untyped) => node.textContent ?? '');
}

/* -------------------------------------------------------------- tests -- */

describe('the registry screen (IN-05, IN-06)', () => {
  it('says the registries are empty before anything is configured', async () => {
    await openSettings();

    // Each registry is read from the backend on its own, and the empty state
    // says what the absence costs, not just that there is nothing.
    expect(requests).not.toContain('GET /commission-agreements');
    expect(requests).toContain('GET /broker-commission-rates');
    expect(requests).toContain('GET /payment-method-release-rules');

    // REQ-236: there is no commercial agreement to register any more.
    expect(document.querySelector('#form-agreement')).toBeNull();
    expect(text('#list-broker-rates')).toContain('Nenhuma tabela registrada');
    expect(text('#list-release-rules')).toContain('Nenhuma regra registrada');
  });

  it('shows the broker table and corrects a rate in place (IN-05, REQ-093)', async () => {
    await openSettings();

    fill('#form-broker-rate', { brokerId: 'broker-1', rate: '50' });
    await submit('#form-broker-rate', '#list-broker-rates', '/broker-commission-rates');

    expect(rows('#list-broker-rates')[0].textContent).toContain('50%');

    fill('#form-broker-rate', { brokerId: 'broker-1', rate: '52.5' });
    await submit('#form-broker-rate', '#list-broker-rates', '/broker-commission-rates');

    // One rate per broker: the correction replaces it, and REQ-121 keeps the
    // scale the administrator typed.
    const broker = rows('#list-broker-rates').filter((row: Untyped) =>
      row.textContent.includes('broker-1'),
    );
    expect(broker).toHaveLength(1);
    expect(broker[0].textContent).toContain('52,5%');
  });

  it('shows the release rule of each payment method, and none it was not told (IN-06)', async () => {
    await openSettings();

    fill('#form-release-rule', { paymentMethodId: 'credit', release: 'IMMEDIATE' });
    await submit('#form-release-rule', '#list-release-rules', '/payment-method-release-rules');

    fill('#form-release-rule', {
      paymentMethodId: 'bank-slip',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
    });
    await submit('#form-release-rule', '#list-release-rules', '/payment-method-release-rules');

    const lines = rows('#list-release-rules');
    const bankSlip = lines.find((row: Untyped) => row.textContent.includes('bank-slip'));
    const credit = lines.find((row: Untyped) => row.textContent.includes('credit'));

    // REQ-091 as configuration, in the labels of section 10.6.
    expect(credit.textContent).toContain('Liberação imediata');
    expect(bankSlip.textContent).toContain('Exige confirmação');
    // DEC-002: Pix was never registered, and the screen does not invent it.
    expect(text('#list-release-rules')).not.toContain('pix');
  });

  it('changes the behaviour of a payment method without a code change (CA-024)', async () => {
    await openSettings();

    fill('#form-release-rule', {
      paymentMethodId: 'credit',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
    });
    await submit('#form-release-rule', '#list-release-rules', '/payment-method-release-rules');

    const credit = rows('#list-release-rules').filter((row: Untyped) =>
      row.textContent.includes('credit'),
    );

    expect(credit).toHaveLength(1);
    expect(credit[0].textContent).toContain('Exige confirmação');
  });

  it('carries what was configured into the reading a new visit makes', async () => {
    // A second visit reads the backend again, which is what proves the records
    // are in SQLite and not in the page that wrote them.
    await openSettings();

    expect(rows('#list-broker-rates').length).toBeGreaterThan(0);
    expect(rows('#list-release-rules').length).toBeGreaterThan(0);
    expect(text('#list-broker-rates')).toContain('registro');
  });
});
