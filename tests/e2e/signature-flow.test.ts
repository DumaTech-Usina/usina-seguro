import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { recognitionBody } from '../support/policy-recognition.ts';
import { registerBroker } from './support/brokers.ts';
import { clientNamed } from './support/clients.ts';
import { registerIntermediary } from './support/intermediaries.ts';
import { type SignedIn, signIn } from './support/sign-in.ts';

/**
 * REQ-216 as changed on 2026-10-14: the author of a signed act is the user of
 * the session, referenced by id — never something the request carries.
 *
 * Every way an act is signed over HTTP is walked here once: the registration
 * of the proposal and its three corrections, the recognition of issuance, the
 * PDF of the policy, the installment payment, the agreed-commission override,
 * the CR, its revision and the eligibility, and the two CRs and the
 * installment eligibility of a parcelled policy.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
/** REQ-307: the registered broker the proposals of this journey name. */
let brokerId: string;
let signedIn: SignedIn;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-signature-'));
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

  signedIn = await signIn(application.useCases, baseUrl);

  brokerId = await registerBroker(baseUrl, 'Corretora Alfa', 1);
  // REQ-229: the intermediary the proposals are received through.
  await registerIntermediary(baseUrl, 'mega', 'Mega Intermediação');

  PROPOSAL.brokerId = brokerId;
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

const PDF = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

const PROPOSAL = {
  client: clientNamed('client-1'),
  brokerId: 'broker-1',
  insurerId: 'insurer-1',
  productId: 'product-1',
  paymentMethodId: 'bank-slip',
  proposalNumber: 'PRP-1',
  netPremium: '1000.00',
  coverageStart: '2026-10-01',
  coverageEnd: '2027-10-01',
  installments: [{ amount: '500.00' }, { amount: '500.00' }],
  workedCommission: '20',
  workedCommissionMode: 'INTEGRAL',
  intermediary: null,
};

async function call(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${url}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function ok<T = Record<string, unknown>>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await call(method, url, body);
  if (!response.ok) {
    throw new Error(`${method} ${url} answered ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

describe('the author of a signed act is the session user, by id (REQ-216, CA-415)', () => {
  it('signs the registration and every correction of the proposal', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', PROPOSAL);
    await ok('POST', `/proposals/${proposal.id}/worked-commission`, {
      workedCommission: '25',
      workedCommissionMode: 'INTEGRAL',
    });
    await ok('POST', `/proposals/${proposal.id}/receipt`, {
      intermediary: { intermediaryId: 'mega', ctu: '50' },
    });
    await ok('POST', `/proposals/${proposal.id}/installments`, {
      installments: [{ amount: '1000.00' }],
    });

    const stored = await ok<{
      workedCommissionHistory: { informedBy: string }[];
      receiptHistory: { declaredBy: string }[];
      installmentHistory: { informedBy: string }[];
    }>('GET', `/proposals/${proposal.id}`);

    const authors = [
      ...stored.workedCommissionHistory.map((entry) => entry.informedBy),
      ...stored.receiptHistory.map((entry) => entry.declaredBy),
      ...stored.installmentHistory.map((entry) => entry.informedBy),
    ];
    expect(authors.length).toBeGreaterThanOrEqual(6);
    expect(new Set(authors)).toEqual(new Set([signedIn.user.id]));
  });

  it('signs the recognition of issuance, the policy PDF, the payment and the override', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', {
      ...PROPOSAL,
      proposalNumber: 'PRP-2',
    });
    const policy = await ok<{ id: string }>('POST', '/policies', {
      proposalId: proposal.id,
      policyNumber: 'APL-2',
      document: { fileName: 'apolice.pdf', content: PDF },
    });
    await ok('POST', `/policies/${policy.id}/document`, { fileName: 'nova.pdf', content: PDF });
    await ok('POST', `/policies/${policy.id}/installments/1/payment`);
    await ok('POST', `/policies/${policy.id}/commission/override`, {
      receivable: '150.00',
      justification: 'acordo pontual',
    });

    const recognized = await ok<{ issuanceRecognizedBy: string }>(
      'GET',
      `/proposals/${proposal.id}`,
    );
    const stored = await ok<{
      document: { attachedBy: string };
      installments: { confirmedBy: string | null }[];
    }>('GET', `/policies/${policy.id}`);
    const commission = await ok<{ override: { userId: string } }>(
      'GET',
      `/policies/${policy.id}/commission`,
    );

    expect(recognized.issuanceRecognizedBy).toBe(signedIn.user.id);
    expect(stored.document.attachedBy).toBe(signedIn.user.id);
    expect(stored.installments[0]?.confirmedBy).toBe(signedIn.user.id);
    expect(commission.override.userId).toBe(signedIn.user.id);
  });

  it('signs the CR, its revision and the eligibility (REQ-279, REQ-281)', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', {
      ...PROPOSAL,
      proposalNumber: 'PRP-3',
    });
    const policy = await ok<{ id: string }>(
      'POST',
      '/policies',
      recognitionBody(proposal.id, 'APL-TESTE'),
    );
    await ok('POST', `/policies/${policy.id}/payout`, { rate: '60' });
    await ok('POST', `/policies/${policy.id}/payout/revision`, { rate: '70', reason: 'revisto' });
    await ok('POST', `/policies/${policy.id}/payout/eligibility`);

    const payout = JSON.stringify(await ok('GET', `/policies/${policy.id}/payout`));

    expect(payout).toContain(signedIn.user.id);
    expect(payout.match(new RegExp(signedIn.user.id, 'g'))?.length).toBeGreaterThanOrEqual(3);
  });

  it('signs the two CRs and the installment eligibility of a parcelled policy (REQ-265, REQ-288)', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', {
      ...PROPOSAL,
      proposalNumber: 'PRP-4',
      workedCommissionMode: 'PARCELLED',
      workedCommission: '100',
      subsequentWorkedCommission: '30',
    });
    const policy = await ok<{ id: string }>(
      'POST',
      '/policies',
      recognitionBody(proposal.id, 'APL-TESTE'),
    );
    await ok('POST', `/policies/${policy.id}/parcelled-payout`, {
      firstRate: '100',
      subsequentRate: '15',
    });
    await ok('POST', `/policies/${policy.id}/parcelled-payout/revision`, {
      firstRate: '90',
      subsequentRate: '10',
      reason: 'acordo revisto',
    });
    await ok('POST', `/policies/${policy.id}/installments/2/eligibility`);

    const payout = JSON.stringify(await ok('GET', `/policies/${policy.id}/parcelled-payout`));

    expect(payout.match(new RegExp(signedIn.user.id, 'g'))?.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Fastify drops a property the schema does not declare (`removeAdditional`),
 * so an author in the body is discarded before any handler sees it.
 */
describe('an author sent by the request never becomes the author (CA-416, REJ-404)', () => {
  it('discards it on the registration, the recognition and the override', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', {
      ...PROPOSAL,
      proposalNumber: 'PRP-5',
      userId: 'impostor',
    });
    const policy = await ok<{ id: string }>('POST', '/policies', {
      ...recognitionBody(proposal.id, 'APL-5'),
      userId: 'impostor',
    });
    await ok('POST', `/policies/${policy.id}/commission/override`, {
      receivable: '150.00',
      justification: 'acordo pontual',
      userId: 'impostor',
    });

    const everything =
      JSON.stringify(await ok('GET', `/proposals/${proposal.id}`)) +
      JSON.stringify(await ok('GET', `/policies/${policy.id}/commission`));
    expect(everything).not.toContain('impostor');
    expect(everything.match(new RegExp(signedIn.user.id, 'g'))?.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores it where the act takes no body, and signs with the session', async () => {
    const proposal = await ok<{ id: string }>('POST', '/proposals', {
      ...PROPOSAL,
      proposalNumber: 'PRP-7',
    });
    const policy = await ok<{ id: string }>(
      'POST',
      '/policies',
      recognitionBody(proposal.id, 'APL-TESTE'),
    );

    await ok('POST', `/policies/${policy.id}/installments/1/payment`, { userId: 'impostor' });
    await ok('POST', `/policies/${policy.id}/payout`, { rate: '60' });
    await ok('POST', `/policies/${policy.id}/payout/eligibility`, { userId: 'impostor' });

    const everything =
      JSON.stringify(await ok('GET', `/policies/${policy.id}`)) +
      JSON.stringify(await ok('GET', `/policies/${policy.id}/payout`));
    expect(everything).not.toContain('impostor');
    expect(everything).toContain(signedIn.user.id);
  });
});

describe('the user directory (REQ-400)', () => {
  it('answers every user by id with the name to show, to any logged-in user', async () => {
    const { token } = await application.useCases.issueFirstAdministratorInvitation.execute({
      email: 'sem.nome@usina.com.br',
    });
    const unnamed = await application.useCases.acceptInvitation.execute({
      token,
      password: 'correct horse battery',
    });

    const directory = await ok<{ id: string; displayName: string }[]>('GET', '/users/directory');

    expect(directory).toContainEqual({ id: signedIn.user.id, displayName: 'Operadora de Teste' });
    expect(directory).toContainEqual({ id: unnamed.id, displayName: 'sem.nome@usina.com.br' });
    for (const entry of directory) {
      expect(Object.keys(entry).sort()).toEqual(['displayName', 'id']);
    }
  });

  it('is closed to a visitor with no session', async () => {
    const response = await signedIn.anonymousFetch(`${baseUrl}/users/directory`);

    expect(response.status).toBe(401);
  });
});
