import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * The web interface is served by the same process and the same port as the
 * API (one command, one process, one port).
 *
 * What is worth asserting here is the contract between the two: the pages are
 * reachable, they are served as what they are, and adding them did not move
 * the API out from under its own routes. The content of a page is not tested
 * — it holds no rule, and the rules it calls are covered by the suites that
 * own them.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-web-'));
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
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

describe('web interface under /app', () => {
  it('serves the shell as HTML', async () => {
    const response = await fetch(`${baseUrl}/app/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Usina do Seguro');
  });

  it('sends the bare root to the interface', async () => {
    // Nobody types `/app/` to open a service they just started.
    const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app/');
  });

  it('resolves a directory to its index and a page to itself', async () => {
    const wizard = await fetch(`${baseUrl}/app/proposals/new.html`);
    const registries = await fetch(`${baseUrl}/app/settings/`);

    expect(wizard.status).toBe(200);
    expect(registries.status).toBe(200);
  });

  it('serves every page of the FP-01 flow', async () => {
    // What an operator walks through: register the proposal, follow the ones
    // awaiting issuance, record the outcome (REQ-209, REQ-253), open the policy.
    for (const page of [
      '/app/proposals/new.html',
      '/app/proposals/',
      '/app/proposals/detail.html',
      '/app/policies/detail.html',
    ]) {
      const response = await fetch(`${baseUrl}${page}`);

      expect(response.status, page).toBe(200);
      expect(response.headers.get('content-type'), page).toContain('text/html');
    }
  });

  it('serves the shared modules as JavaScript, so `import` works', async () => {
    const response = await fetch(`${baseUrl}/app/shared/api.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    // The pages import these names; renaming one silently would break them.
    expect(await response.text()).toContain('export const api');
  });

  it('serves the stylesheet as CSS', async () => {
    const response = await fetch(`${baseUrl}/app/shared/base.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });

  it('serves every asset the pages reference', async () => {
    // There is no bundler to catch a stale path: what is served is what is
    // written. A renamed or deleted stylesheet only shows up as a page that
    // silently loses its styles, or a module that never runs.
    const root = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');
    const pages = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((entry) =>
      entry.endsWith('.html'),
    );

    expect(pages.length).toBeGreaterThan(0);

    for (const page of pages) {
      const html = readFileSync(path.join(root, page), 'utf8');
      const referenced = [...html.matchAll(/(?:src|href)="(\/app\/[^"]+)"/g)].map(
        (match) => match[1],
      );

      for (const asset of referenced) {
        const response = await fetch(`${baseUrl}${asset}`);
        expect(response.status, `${page} -> ${asset}`).toBe(200);
      }
    }
  });

  it('does not serve anything outside the prefix', async () => {
    // A traversal attempt must not reach the source tree.
    const escaped = await fetch(`${baseUrl}/app/../../package.json`, { redirect: 'manual' });

    expect(escaped.status).not.toBe(200);
  });

  it('leaves the API where it was', async () => {
    const health = await fetch(`${baseUrl}/health`);
    const missing = await fetch(`${baseUrl}/policies/does-not-exist`);

    expect(await health.json()).toEqual({ status: 'ok' });
    // Still the API answering, not a page: the prefix keeps them apart.
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'not_found' });
  });
});
