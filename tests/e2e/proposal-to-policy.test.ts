import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * FP-01 through the real external interface: a listening server, real HTTP,
 * SQLite on disk.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

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
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function registerProposal(paymentMethodId = 'bank-slip'): Promise<string> {
  const response = await post('/proposals', {
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId,
    customerAccepted: true,
    netPremium: '1200.00',
  });

  return ((await response.json()) as { id: string }).id;
}

async function transmit(proposalId: string, proposalNumber = 'PRP-9001'): Promise<Response> {
  return post(`/proposals/${proposalId}/transmission`, {
    proposalNumber,
    workedCommission: '32.5',
  });
}

function policyBody(proposalId: string, policyNumber: string): unknown {
  return {
    proposalId,
    policyNumber,
    premium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [
      { number: 1, amount: '600.00', dueDate: '2026-10-10' },
      { number: 2, amount: '600.00', dueDate: '2026-11-10' },
    ],
  };
}

interface PolicyBody {
  id: string;
  policyNumber: string;
  proposalNumber: string;
  status: string;
  premium: string;
  installments: Array<{ number: number; amount: string; dueDate: string; status: string }>;
}

describe('FP-01 over HTTP: proposal, transmission, policy, installments', () => {
  it('transmits a registered proposal (REQ-041)', async () => {
    const proposalId = await registerProposal();

    const response = await transmit(proposalId);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'TRANSMITTED',
      proposalNumber: 'PRP-9001',
      workedCommission: '32.5',
    });
  });

  it('registers the policy of an accepted proposal with its schedule (REQ-048, REQ-020)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-1000');

    const response = await post('/policies', policyBody(proposalId, 'APL-4711'));

    expect(response.status).toBe(201);
    const body = (await response.json()) as PolicyBody;
    expect(body).toMatchObject({
      policyNumber: 'APL-4711',
      proposalNumber: 'PRP-1000',
      status: 'ACTIVE',
      premium: '1200.00',
    });
    expect(body.installments).toEqual([
      expect.objectContaining({
        number: 1,
        amount: '600.00',
        dueDate: '2026-10-10',
        status: 'PENDING',
      }),
      expect.objectContaining({
        number: 2,
        amount: '600.00',
        dueDate: '2026-11-10',
        status: 'PENDING',
      }),
    ]);
  });

  it('keeps both numbers consultable when they differ (CA-008)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-2000');
    const created = (await (
      await post('/policies', policyBody(proposalId, 'APL-0001'))
    ).json()) as PolicyBody;

    const response = await fetch(`${baseUrl}/policies/${created.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      policyNumber: 'APL-0001',
      proposalNumber: 'PRP-2000',
      proposalId,
    });
  });

  it('refuses a proposal with a mandatory reason (REQ-045)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-3000');

    const response = await post(`/proposals/${proposalId}/rejection`, {
      reason: 'perfil de risco',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'perfil de risco',
    });
  });

  it('rejects a refusal without a reason with 422 (CA-004, REJ-003)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-3100');

    const response = await post(`/proposals/${proposalId}/rejection`, { reason: '   ' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-045',
      message: 'Recusa de proposta exige motivo.',
    });
  });

  it('does not let a refused proposal originate a policy (CA-006)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-4000');
    await post(`/proposals/${proposalId}/rejection`, { reason: 'perfil de risco' });

    const response = await post('/policies', policyBody(proposalId, 'APL-4712'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-047',
      message: 'Proposta recusada não origina apólice.',
    });
  });

  it('does not let the same proposal originate a second policy (CA-007, REJ-005)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-5000');
    await post('/policies', policyBody(proposalId, 'APL-5001'));

    const response = await post('/policies', policyBody(proposalId, 'APL-5002'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-049' });
  });

  it('does not let a proposal that was never transmitted originate a policy', async () => {
    const proposalId = await registerProposal();

    const response = await post('/policies', policyBody(proposalId, 'APL-6001'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-111' });
  });

  it('rejects a policy without installments with 422 (REQ-021)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-7000');

    const response = await post('/policies', {
      ...(policyBody(proposalId, 'APL-7001') as Record<string, unknown>),
      installments: [],
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-021' });
  });

  it('rejects an installment amount sent as a number (REQ-120)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId, 'PRP-7100');

    const response = await post('/policies', {
      ...(policyBody(proposalId, 'APL-7101') as Record<string, unknown>),
      installments: [{ number: 1, amount: 1200.0, dueDate: '2026-10-10' }],
    });

    expect(response.status).toBe(400);
  });

  it('answers 404 for a proposal that does not exist', async () => {
    const response = await transmit('does-not-exist');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });

  it('answers 404 for a policy that does not exist', async () => {
    const response = await fetch(`${baseUrl}/policies/does-not-exist`);

    expect(response.status).toBe(404);
  });
});
