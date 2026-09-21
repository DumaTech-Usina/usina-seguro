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

function policyBody(proposalId: string, policyNumber: string, renewalDate = '2027-09-30'): unknown {
  return {
    proposalId,
    policyNumber,
    premium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate,
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

  it('does not let two policies share the conciliation key (REQ-082, CA-018)', async () => {
    const first = await registerProposal();
    await transmit(first, 'PRP-8000');
    await post('/policies', policyBody(first, 'APL-8001'));

    const second = await registerProposal();
    await transmit(second, 'PRP-8001');
    const response = await post('/policies', policyBody(second, 'APL-8001'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-082',
      message: "Número de apólice 'APL-8001' já registrado em outra apólice.",
    });
  });

  it('does not let two proposals share the number the report matches (REQ-082, CA-019)', async () => {
    const first = await registerProposal();
    await transmit(first, 'PRP-8200');

    const second = await registerProposal();
    const response = await transmit(second, 'PRP-8200');

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-082' });
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

/**
 * OUT-03 and OUT-04 over HTTP. Every other policy of this file renews on
 * 2027-09-30, so the two registered here — with their own renewal days — are
 * the ones a window that stops before that can contain.
 */
describe('the policy listing (OUT-03, OUT-04)', () => {
  interface PolicyLine {
    id: string;
    policyNumber: string;
    proposalNumber: string | null;
    clientId: string;
    status: string;
    premium: string;
    coverageStart: string;
    coverageEnd: string;
    renewalDate: string;
  }

  async function registerRenewingOn(number: string, renewalDate: string): Promise<string> {
    const proposalId = await registerProposal();
    await transmit(proposalId, `PRP-${number}`);
    const created = (await (
      await post('/policies', policyBody(proposalId, `APL-${number}`, renewalDate))
    ).json()) as PolicyBody;

    return created.id;
  }

  async function listPolicies(query = ''): Promise<PolicyLine[]> {
    const response = await fetch(`${baseUrl}/policies${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as PolicyLine[];
  }

  it('lists the policies sold, nearest renewal first (REQ-055)', async () => {
    const early = await registerRenewingOn('LIST-EARLY', '2026-12-31');
    const later = await registerRenewingOn('LIST-LATER', '2027-03-31');

    const listing = await listPolicies();
    const numbers = listing.map((line) => line.policyNumber);

    // REQ-020: coverage, premium and state, with both numbers of REQ-050.
    expect(listing[0]).toMatchObject({
      id: early,
      policyNumber: 'APL-LIST-EARLY',
      proposalNumber: 'PRP-LIST-EARLY',
      clientId: 'client-1',
      status: 'ACTIVE',
      premium: '1200.00',
      coverageStart: '2026-10-01',
      renewalDate: '2026-12-31',
    });
    expect(numbers.indexOf('APL-LIST-EARLY')).toBeLessThan(numbers.indexOf('APL-LIST-LATER'));
    expect(listing[1]?.id).toBe(later);
    // The policies the other tests registered are here too: no filter, no cut.
    expect(numbers).toContain('APL-4711');
  });

  it('answers only what renews up to the informed day (CA-032, OUT-04)', async () => {
    await registerRenewingOn('WINDOW-IN', '2027-02-28');
    await registerRenewingOn('WINDOW-OUT', '2027-04-30');

    const expiring = await listPolicies('?renewalUntil=2027-03-31');
    const numbers = expiring.map((line) => line.policyNumber);

    expect(numbers).toContain('APL-WINDOW-IN');
    // The day informed is inside the window; what renews after it is not.
    expect(numbers).toContain('APL-LIST-LATER');
    expect(numbers).not.toContain('APL-WINDOW-OUT');
    expect(numbers).not.toContain('APL-4711');
    expect(expiring.every((line) => line.renewalDate <= '2027-03-31')).toBe(true);
  });

  it('answers an empty listing when nothing renews until then', async () => {
    expect(await listPolicies('?renewalUntil=2020-01-01')).toEqual([]);
  });

  it('refuses a malformed day with 422, in Portuguese (REQ-020)', async () => {
    const response = await fetch(`${baseUrl}/policies?renewalUntil=31%2F03%2F2027`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-020',
      message: "Data inválida: '31/03/2027'. Use o formato AAAA-MM-DD.",
    });
  });
});

/**
 * FP-01 step 7, the notification half (REQ-100, REQ-105, OUT-10).
 *
 * The other half — the agreed commission — is covered above and in the
 * commission suite. What this group asserts is the one thing only the whole
 * stack can show: registering the policy *produces* a notification, over real
 * HTTP and real SQLite, with the five fields CA-029 requires.
 */
describe('the notification of an effectuated emission (OUT-10)', () => {
  async function listNotifications(query = ''): Promise<
    Array<{
      recipientId: string;
      policyId: string;
      policyNumber: string;
      client: { id: string; name: string | null };
      broker: { id: string; name: string | null };
      product: { id: string; name: string | null };
      workedCommission: string | null;
      netPremium: string;
      occurredAt: string;
    }>
  > {
    const response = await fetch(`${baseUrl}/notifications${query}`);
    expect(response.status).toBe(200);
    return response.json() as never;
  }

  it('notifies the broker with the five fields when the policy is registered (CA-029)', async () => {
    // IN-01 gives the three references a name; the other two fields are the
    // worked percentage of REQ-041 and the net premium of REQ-022.
    for (const reference of [
      { kind: 'CLIENT', id: 'client-notified', name: 'Maria Souza' },
      { kind: 'BROKER', id: 'broker-notified', name: 'Corretora Alfa' },
      { kind: 'PRODUCT', id: 'auto', name: 'Automovel' },
    ]) {
      expect((await post('/references', reference)).status).toBe(201);
    }

    const proposal = await post('/proposals', {
      clientId: 'client-notified',
      brokerId: 'broker-notified',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: '1200.00',
    });
    const { id: proposalId } = (await proposal.json()) as { id: string };
    await transmit(proposalId, 'PRP-NOTIFY-1');

    const policy = await post('/policies', policyBody(proposalId, 'APL-NOTIFY-1'));
    const { id: policyId } = (await policy.json()) as { id: string };

    const [notified] = await listNotifications('?recipientId=broker-notified');
    expect(notified).toMatchObject({
      recipientId: 'broker-notified',
      policyId,
      policyNumber: 'APL-NOTIFY-1',
      client: { id: 'client-notified', name: 'Maria Souza' },
      broker: { id: 'broker-notified', name: 'Corretora Alfa' },
      product: { id: 'auto', name: 'Automovel' },
      workedCommission: '32.5',
      netPremium: '1200.00',
    });
  });

  it('notifies even when IN-01 has no name for the references (REQ-002)', async () => {
    const proposal = await post('/proposals', {
      clientId: 'client-unnamed',
      brokerId: 'broker-unnamed',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: '1200.00',
    });
    const { id: proposalId } = (await proposal.json()) as { id: string };
    await transmit(proposalId, 'PRP-NOTIFY-2');
    await post('/policies', policyBody(proposalId, 'APL-NOTIFY-2'));

    const [notified] = await listNotifications('?recipientId=broker-unnamed');
    expect(notified?.client).toEqual({ id: 'client-unnamed', name: null });
  });

  it('produces nothing for a policy that was refused (REQ-070, CA-009)', async () => {
    const proposal = await post('/proposals', {
      clientId: 'client-1',
      brokerId: 'broker-nothing',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: '1200.00',
    });
    const { id: proposalId } = (await proposal.json()) as { id: string };
    await transmit(proposalId, 'PRP-NOTIFY-3');

    // No schedule: REQ-021 refuses the policy, so FP-01 step 7 never happens.
    const refused = await post('/policies', {
      ...(policyBody(proposalId, 'APL-NOTIFY-3') as Record<string, unknown>),
      installments: [],
    });

    expect(refused.status).toBe(422);
    expect(await listNotifications('?recipientId=broker-nothing')).toEqual([]);
  });

  it('answers every recipient, most recent first (OUT-10, REQ-105)', async () => {
    const every = await listNotifications();
    const recipients = every.map((notification) => notification.recipientId);

    expect(recipients).toContain('broker-notified');
    expect(recipients).toContain('broker-unnamed');

    const instants = every.map((notification) => Date.parse(notification.occurredAt));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  it('reads a recipient that notified nobody as an empty list, not an error', async () => {
    expect(await listNotifications('?recipientId=broker-ghost')).toEqual([]);
  });
});
