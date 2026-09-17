import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * E2E exercises the system through the real external interface: a server
 * listening on a port, real HTTP requests, SQLite persistence on disk.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0', // ephemeral port: never conflicts
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

const validProposal = {
  clientId: 'client-1',
  brokerId: 'broker-1',
  insurerId: 'insurer-1',
  productId: 'product-1',
  paymentMethodId: 'bank-slip',
  customerAccepted: true,
  netPremium: '1234.56',
};

interface ErrorBody {
  error: string;
  rule?: string;
  messageKey?: string;
  message?: string;
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HTTP application', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('registers a proposal and returns 201 (FP-01 step 3)', async () => {
    const response = await post(validProposal);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'DRAFT', netPremium: '1234.56' });
  });

  it('rejects a proposal without the customer acceptance with 422 (CA-001)', async () => {
    const response = await post({ ...validProposal, customerAccepted: false });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'business_rule_violation',
      rule: 'REQ-040',
      messageKey: 'proposal.customer_acceptance_required',
    });
  });

  it('renders the message in Portuguese through the i18n dictionary', async () => {
    const response = await post({ ...validProposal, customerAccepted: false });

    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe('Proposta exige aceite do cliente registrado.');
  });

  it('interpolates message parameters in the rendered text', async () => {
    const response = await post({ ...validProposal, clientId: '   ' });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe('Proposta exige o campo clientId.');
  });

  it('rejects a malformed body with 400 before reaching the domain', async () => {
    const response = await post({ clientId: 'client-1' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a net premium sent as a number (REQ-120)', async () => {
    const response = await post({ ...validProposal, netPremium: 1234.56 });

    expect(response.status).toBe(400);
  });
});
