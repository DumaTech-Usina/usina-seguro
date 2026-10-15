import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';
import { registerBroker } from './support/brokers.ts';
import { type SignedIn, signIn } from './support/sign-in.ts';

/**
 * FP-01 through the real external interface: a listening server, real HTTP,
 * SQLite on disk.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;
/** REQ-307: the registered broker the proposals of this journey name. */
let brokerId: string;
let signedIn: SignedIn;

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

/** A V2 proposal awaiting issuance, carrying the number from registration (REQ-206). */
function proposalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 'client-1',
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-9001',
    netPremium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    workedCommission: '32.5',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    ...overrides,
  };
}

async function registerProposal(
  paymentMethodId = 'bank-slip',
  proposalNumber = 'PRP-9001',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await post(
    '/proposals',
    proposalBody({ paymentMethodId, proposalNumber, ...overrides }),
  );

  return ((await response.json()) as { id: string }).id;
}

/** REQ-209, REQ-242: the recognition carries only the proposal; who identified it is the session (REQ-216). */
function recognition(proposalId: string): unknown {
  return { proposalId };
}

interface PolicyBody {
  id: string;
  policyNumber: string;
  proposalNumber: string;
  status: string;
  premium: string;
  coverageEnd: string;
  renewalDate: string;
  installments: Array<{ number: number; amount: string; dueDate: string | null; status: string }>;
}

describe('FP-01 over HTTP: recognition of issuance, policy, installments', () => {
  it('creates the policy inheriting every datum of the proposal (REQ-240, REQ-241, CA-205)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-1000', {
      installments: [
        { amount: '600.00', dueDate: '2026-10-10' },
        { amount: '600.00', dueDate: null },
      ],
    });

    const response = await post('/policies', recognition(proposalId));

    expect(response.status).toBe(201);
    const body = (await response.json()) as PolicyBody;
    expect(body).toMatchObject({
      policyNumber: 'PRP-1000',
      proposalNumber: 'PRP-1000',
      status: 'ACTIVE',
      premium: '1200.00',
      coverageEnd: '2027-10-01',
      // REQ-203, CA-206
      renewalDate: '2027-10-01',
    });
    expect(body.installments).toEqual([
      expect.objectContaining({
        number: 1,
        amount: '600.00',
        dueDate: '2026-10-10',
        status: 'PENDING',
      }),
      expect.objectContaining({ number: 2, amount: '600.00', dueDate: null, status: 'PENDING' }),
    ]);
  });

  it('records on the proposal who recognised the issuance and when (REQ-209, CA-207)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-1100');
    const before = Date.now();

    await post('/policies', recognition(proposalId));

    const proposal = (await (await fetch(`${baseUrl}/proposals/${proposalId}`)).json()) as {
      status: string;
      issuanceRecognizedBy: string;
      issuanceRecognizedAt: string;
    };
    expect(proposal.status).toBe('ISSUED');
    expect(proposal.issuanceRecognizedBy).toBe(signedIn.user.id);
    // The moment it was recorded, not an informed one.
    expect(Date.parse(proposal.issuanceRecognizedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(proposal.issuanceRecognizedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('keeps both numbers consultable, the policy one being the proposal one (REQ-050, REQ-241)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-2000');
    const created = (await (await post('/policies', recognition(proposalId))).json()) as PolicyBody;

    const response = await fetch(`${baseUrl}/policies/${created.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      policyNumber: 'PRP-2000',
      proposalNumber: 'PRP-2000',
      proposalId,
    });
  });

  it('refuses a proposal with a mandatory reason (REQ-045)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-3000');

    const response = await post(`/proposals/${proposalId}/rejection`, {
      reason: 'perfil de risco',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'perfil de risco',
    });
  });

  it('rejects a refusal without a reason with 422 (REJ-208)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-3100');

    const response = await post(`/proposals/${proposalId}/rejection`, { reason: '   ' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-253',
      message: 'Recusa de proposta exige motivo.',
    });
  });

  it('does not let a refused proposal originate a policy (REJ-210)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-4000');
    await post(`/proposals/${proposalId}/rejection`, { reason: 'perfil de risco' });

    const response = await post('/policies', recognition(proposalId));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-253',
      message: 'Proposta recusada não origina apólice.',
    });
  });

  it('does not let the same proposal originate a second policy (REQ-049)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-5000');
    await post('/policies', recognition(proposalId));

    const response = await post('/policies', recognition(proposalId));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-049' });
  });

  it('never takes the author of the recognition from the request (REJ-205, REQ-216, CA-416)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-7000');

    const response = await post('/policies', { proposalId, userId: 'carla.dias' });

    expect(response.status).toBe(201);
    const proposal = (await (await fetch(`${baseUrl}/proposals/${proposalId}`)).json()) as {
      issuanceRecognizedBy: string;
    };
    expect(proposal.issuanceRecognizedBy).toBe(signedIn.user.id);
  });

  it('never takes policy data typed again: the policy only inherits (REQ-242, REJ-204)', async () => {
    const proposalId = await registerProposal('bank-slip', 'PRP-7100');

    const response = await post('/policies', {
      ...(recognition(proposalId) as Record<string, unknown>),
      policyNumber: 'APL-OTHER',
      premium: '999.00',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ policyNumber: 'PRP-7100', premium: '1200.00' });
  });

  it('accepts two policies with the same number, as proposal numbers may repeat (DEC-207)', async () => {
    const first = await registerProposal('bank-slip', 'PRP-8000');
    const second = await registerProposal('bank-slip', 'PRP-8000');

    expect((await post('/policies', recognition(first))).status).toBe(201);
    const response = await post('/policies', recognition(second));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ policyNumber: 'PRP-8000' });
  });

  it('answers 404 for a proposal that does not exist', async () => {
    const response = await post('/proposals/does-not-exist/rejection', { reason: 'motivo' });

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
 * 2027-10-01, so the two registered here — with their own renewal days — are
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

  /** REQ-203: the renewal is the end of coverage the proposal was registered with. */
  async function registerRenewingOn(number: string, renewalDate: string): Promise<string> {
    const proposalId = await registerProposal('bank-slip', `PRP-${number}`, {
      coverageEnd: renewalDate,
    });
    const created = (await (await post('/policies', recognition(proposalId))).json()) as PolicyBody;

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
      policyNumber: 'PRP-LIST-EARLY',
      proposalNumber: 'PRP-LIST-EARLY',
      clientId: 'client-1',
      status: 'ACTIVE',
      premium: '1200.00',
      coverageStart: '2026-10-01',
      renewalDate: '2026-12-31',
    });
    expect(numbers.indexOf('PRP-LIST-EARLY')).toBeLessThan(numbers.indexOf('PRP-LIST-LATER'));
    expect(listing[1]?.id).toBe(later);
    // The policies the other tests registered are here too: no filter, no cut.
    expect(numbers).toContain('PRP-1000');
  });

  it('answers only what renews up to the informed day (CA-032, OUT-04)', async () => {
    await registerRenewingOn('WINDOW-IN', '2027-02-28');
    await registerRenewingOn('WINDOW-OUT', '2027-04-30');

    const expiring = await listPolicies('?renewalUntil=2027-03-31');
    const numbers = expiring.map((line) => line.policyNumber);

    expect(numbers).toContain('PRP-WINDOW-IN');
    // The day informed is inside the window; what renews after it is not.
    expect(numbers).toContain('PRP-LIST-LATER');
    expect(numbers).not.toContain('PRP-WINDOW-OUT');
    expect(numbers).not.toContain('PRP-1000');
    expect(expiring.every((line) => line.renewalDate <= '2027-03-31')).toBe(true);
  });

  it('answers an empty listing when nothing renews until then', async () => {
    expect(await listPolicies('?renewalUntil=2020-01-01')).toEqual([]);
  });

  it('refuses a malformed day with 422, in Portuguese (REQ-202)', async () => {
    const response = await fetch(`${baseUrl}/policies?renewalUntil=31%2F03%2F2027`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-202',
      message: "Data inválida: '31/03/2027'. Use o formato AAAA-MM-DD.",
    });
  });
});

/**
 * FP-01 step 7, the notification half (REQ-100, REQ-105, OUT-10).
 *
 * The other half — the agreed commission — is covered above and in the
 * commission suite. What this group asserts is the one thing only the whole
 * stack can show: recognising the issuance *produces* a notification, over real
 * HTTP and real SQLite, with the five fields CA-029 requires.
 */
describe('the notification of an effectuated emission (OUT-10)', () => {
  // REQ-307: each emission names a registered broker; the notification goes to
  // the broker's id and carries the broker's name (REQ-308).
  const brokers = { notified: '', unnamed: '', nothing: '' };

  beforeAll(async () => {
    brokers.notified = await registerBroker(baseUrl, 'Corretora Notificada', 11);
    brokers.unnamed = await registerBroker(baseUrl, 'Corretora Sem Cliente', 12);
    brokers.nothing = await registerBroker(baseUrl, 'Corretora Recusada', 13);
  });

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

  it('notifies the broker with the five fields when the issuance is recognised (CA-029)', async () => {
    // IN-01 gives the client and the product a name, the broker registry the
    // broker (REQ-308); the other two fields are the worked percentage of
    // REQ-212 and the net premium of REQ-202.
    for (const reference of [
      { kind: 'CLIENT', id: 'client-notified', name: 'Maria Souza' },
      { kind: 'PRODUCT', id: 'auto', name: 'Automovel' },
    ]) {
      expect((await post('/references', reference)).status).toBe(201);
    }

    const proposal = await post(
      '/proposals',
      proposalBody({
        clientId: 'client-notified',
        brokerId: brokers.notified,
        productId: 'auto',
        paymentMethodId: 'credit',
        proposalNumber: 'PRP-NOTIFY-1',
      }),
    );
    const { id: proposalId } = (await proposal.json()) as { id: string };

    const policy = await post('/policies', recognition(proposalId));
    const { id: policyId } = (await policy.json()) as { id: string };

    const [notified] = await listNotifications(`?recipientId=${brokers.notified}`);
    expect(notified).toMatchObject({
      recipientId: brokers.notified,
      policyId,
      policyNumber: 'PRP-NOTIFY-1',
      client: { id: 'client-notified', name: 'Maria Souza' },
      broker: { id: brokers.notified, name: 'Corretora Notificada' },
      product: { id: 'auto', name: 'Automovel' },
      workedCommission: '32.5',
      netPremium: '1200.00',
    });
  });

  it('notifies even when IN-01 has no name for the references (REQ-002)', async () => {
    const proposal = await post(
      '/proposals',
      proposalBody({
        clientId: 'client-unnamed',
        brokerId: brokers.unnamed,
        productId: 'auto',
        paymentMethodId: 'credit',
        proposalNumber: 'PRP-NOTIFY-2',
      }),
    );
    const { id: proposalId } = (await proposal.json()) as { id: string };
    await post('/policies', recognition(proposalId));

    const [notified] = await listNotifications(`?recipientId=${brokers.unnamed}`);
    expect(notified?.client).toEqual({ id: 'client-unnamed', name: null });
  });

  it('produces nothing for a recognition that was refused', async () => {
    const proposal = await post(
      '/proposals',
      proposalBody({
        clientId: 'client-1',
        brokerId: brokers.nothing,
        productId: 'auto',
        paymentMethodId: 'credit',
        proposalNumber: 'PRP-NOTIFY-3',
      }),
    );
    const { id: proposalId } = (await proposal.json()) as { id: string };

    // A refused proposal cannot originate a policy (REJ-210), so the
    // recognition is refused and no policy is created.
    await post(`/proposals/${proposalId}/rejection`, { reason: 'seguradora recusou' });
    const refused = await post('/policies', recognition(proposalId));

    expect(refused.status).toBe(422);
    expect(await listNotifications(`?recipientId=${brokers.nothing}`)).toEqual([]);
  });

  it('answers every recipient, most recent first (OUT-10, REQ-105)', async () => {
    const every = await listNotifications();
    const recipients = every.map((notification) => notification.recipientId);

    expect(recipients).toContain(brokers.notified);
    expect(recipients).toContain(brokers.unnamed);

    const instants = every.map((notification) => Date.parse(notification.occurredAt));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  it('reads a recipient that notified nobody as an empty list, not an error', async () => {
    expect(await listNotifications('?recipientId=broker-ghost')).toEqual([]);
  });
});
