import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * The financial journey of the MVP through the real external interface: a
 * server listening on a port, real HTTP requests, SQLite on disk.
 *
 * ```
 * Proposal -> Policy -> Installment -> agreed Commission -> Reconciliation
 * ```
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-financial-e2e-'));
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

async function post(route: string, body?: unknown): Promise<Response> {
  // A transition with no payload sends no body and no content type.
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface PolicyBody {
  id: string;
  policyNumber: string;
  installments: readonly {
    number: number;
    status: string;
    confirmedBy: string | null;
    confirmedAt: string | null;
  }[];
}

interface CommissionBody {
  status: string;
  agreedReceivable: string;
  realReceivable: string | null;
  divergent: boolean;
}

/** One line of the panel of OUT-05, as `GET /commissions` answers it. */
interface CommissionPanelLine {
  policyId: string;
  policyNumber: string;
  proposalNumber: string | null;
  clientId: string;
  clientName: string | null;
  insurerId: string;
  insurerName: string | null;
  productName: string | null;
  status: string;
  effectiveReceivable: string;
  realReceivable: string | null;
  divergent: boolean;
}

/** One reference record, as `GET /references` answers it (IN-01). */
interface ReferenceBody {
  kind: string;
  id: string;
  name: string;
  registeredAt: string;
}

interface ReportBody {
  reconciled: number;
  divergent: number;
  duplicated: number;
  pending: number;
}

async function sellPolicy(options: {
  paymentMethodId: string;
  proposalNumber: string;
  policyNumber: string;
  /** IN-01: defaults to the client the registry names in the block below. */
  clientId?: string;
}): Promise<PolicyBody> {
  const proposal = await json<{ id: string }>(
    await post('/proposals', {
      clientId: options.clientId ?? 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: options.paymentMethodId,
      proposalNumber: options.proposalNumber,
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
      userId: 'operator',
    }),
  );

  return json<PolicyBody>(await post('/policies', { proposalId: proposal.id, userId: 'operator' }));
}

describe('policy to reconciled commission', () => {
  let policy: PolicyBody;

  it('registers the policy and, with it, the agreed commission (FP-01 step 7)', async () => {
    policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-100',
      policyNumber: 'PRP-100',
    });

    const commission = await json<CommissionBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/commission`),
    );

    // REQ-236: premium 100.00 x CT 40% -> 40.00 to the Usina.
    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.realReceivable).toBeNull();
  });

  it('conciliates the commission report by the policy number (FP-02, CA-018)', async () => {
    const response = await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'PRP-100', proposalNumber: 'PRP-100', producerCommission: '40.00' }],
    });

    expect(response.status).toBe(201);
    expect((await json<ReportBody>(response)).reconciled).toBe(1);

    const commission = await json<CommissionBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/commission`),
    );
    expect(commission.status).toBe('RECONCILED');
    expect(commission.realReceivable).toBe('40.00');
    expect(commission.divergent).toBe(false);
  });
});

describe('confirmation of an installment paid by the client (IN-13)', () => {
  let policy: PolicyBody;

  it('refuses a receipt confirmation that does not say who made it (REQ-123)', async () => {
    policy = await sellPolicy({
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-200',
      policyNumber: 'PRP-200',
    });

    const response = await post(`/policies/${policy.id}/installments/1/payment`, { userId: '  ' });

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ rule: 'REQ-123' });
  });

  it('records who confirmed the installment and when (IN-13, REQ-123)', async () => {
    const paid = await json<PolicyBody>(
      await post(`/policies/${policy.id}/installments/1/payment`, { userId: 'financeiro-1' }),
    );
    expect(paid.installments[0]?.status).toBe('PAID');
    expect(paid.installments[1]?.status).toBe('PENDING');
    expect(paid.installments[0]?.confirmedBy).toBe('financeiro-1');
    expect(paid.installments[0]?.confirmedAt).not.toBeNull();
  });
});

describe('divergences and pendencies', () => {
  it('flags a divergence and lets it be resolved by hand (CA-017, CA-026)', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-300',
      policyNumber: 'PRP-300',
    });

    // The insurer paid less than the agreement says (EX-02).
    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'PRP-300', proposalNumber: 'PRP-300', producerCommission: '31.00' }],
    });

    const divergent = await json<CommissionBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/commission`),
    );
    expect(divergent.divergent).toBe(true);
    expect(divergent.agreedReceivable).toBe('40.00');
    expect(divergent.realReceivable).toBe('31.00');

    const resolved = await json<CommissionBody>(
      await post(`/policies/${policy.id}/commission/divergence-resolution`, {
        justification: 'seguradora confirmou o valor menor',
        userId: 'financeiro-1',
      }),
    );
    expect(resolved.status).toBe('RESOLVED');
  });

  it('turns a line with no policy into a pendency (CA-020, OUT-06)', async () => {
    const report = await json<ReportBody>(
      await post('/commission-reconciliations', {
        competence: '2026-11',
        lines: [{ proposalNumber: 'PRP-INEXISTENTE', producerCommission: '9.99' }],
      }),
    );

    expect(report.pending).toBe(1);

    const pendencies = await json<readonly { proposalNumber: string }[]>(
      await fetch(`${baseUrl}/commission-reconciliations/pendencies`),
    );
    expect(pendencies.map((pendency) => pendency.proposalNumber)).toContain('PRP-INEXISTENTE');
  });

  it('does not duplicate entries when the same report comes back (CA-021)', async () => {
    const report = await json<ReportBody>(
      await post('/commission-reconciliations', {
        competence: '2026-10',
        lines: [
          { policyNumber: 'PRP-100', proposalNumber: 'PRP-100', producerCommission: '40.00' },
        ],
      }),
    );

    expect(report.duplicated).toBe(1);
    expect(report.reconciled).toBe(0);
  });

  it('refuses an override without a justification (CA-015, REJ-010)', async () => {
    const response = await post('/policies/any/commission/override', {
      receivable: '45.00',
      userId: 'admin-1',
    });

    // The schema requires the justification, so the request never reaches the
    // domain: a missing field is a malformed request (400), not a rule broken.
    expect(response.status).toBe(400);
  });

  it('refuses an override with a blank justification, in Portuguese (REQ-067)', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-400',
      policyNumber: 'PRP-400',
    });

    const response = await post(`/policies/${policy.id}/commission/override`, {
      receivable: '45.00',
      justification: '   ',
      userId: 'admin-1',
    });

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      rule: 'REQ-067',
      message: 'Ajuste de comissão por apólice exige justificativa.',
    });
  });

  it('lists the panel of every policy and narrows it by state (OUT-05)', async () => {
    await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-410',
      policyNumber: 'PRP-410',
    });
    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'PRP-410', proposalNumber: 'PRP-410', producerCommission: '33.00' }],
    });

    const panel = await json<readonly CommissionPanelLine[]>(await fetch(`${baseUrl}/commissions`));
    const line = panel.find((entry) => entry.policyNumber === 'PRP-410');

    // CA-016: the pair and the flag, with what identifies the business.
    expect(line?.effectiveReceivable).toBe('40.00');
    expect(line?.realReceivable).toBe('33.00');
    expect(line?.divergent).toBe(true);
    expect(line?.proposalNumber).toBe('PRP-410');
    expect(line?.insurerId).toBe('insurer-1');

    const divergent = await json<readonly CommissionPanelLine[]>(
      await fetch(`${baseUrl}/commissions?status=DIVERGENT`),
    );
    expect(divergent.map((entry) => entry.policyNumber)).toContain('PRP-410');
    expect(divergent.every((entry) => entry.status === 'DIVERGENT')).toBe(true);
  });

  it('refuses a state the machine of section 10.5 does not have', async () => {
    // Shape validation: an unknown state is a 400, never an empty panel that
    // reads as "nothing diverges".
    const response = await fetch(`${baseUrl}/commissions?status=WHATEVER`);

    expect(response.status).toBe(400);
  });

  it('answers 404 for a policy with no commission (REQ-070)', async () => {
    const response = await fetch(`${baseUrl}/policies/ghost/commission`);

    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: 'not_found' });
  });

  it('rejects a monetary value sent as a JSON number (REQ-120)', async () => {
    const response = await post('/commission-reconciliations', {
      competence: '2026-12',
      lines: [{ proposalNumber: 'PRP-100', producerCommission: 40.0 }],
    });

    expect(response.status).toBe(400);
  });
});

/**
 * IN-01 over HTTP, and the names it gives the readings that were already here.
 *
 * REQ-096 identifies a business by the name of the client, the broker and the
 * ramo — not by the identifier the proposal stores (REQ-022). This block
 * registers those names after the businesses above already exist, which is the
 * order the registry is really maintained in, and checks that the listings
 * start answering them without anything else changing.
 */
describe('the reference registry (IN-01)', () => {
  it('registers a reference and answers it in the shape the listing answers', async () => {
    const registered = await json<ReferenceBody>(
      await post('/references', { kind: 'CLIENT', id: 'client-1', name: 'Ana Lima' }),
    );

    const listed = await json<ReferenceBody[]>(await fetch(`${baseUrl}/references`));

    expect(registered).toMatchObject({ kind: 'CLIENT', id: 'client-1', name: 'Ana Lima' });
    expect(listed).toContainEqual(registered);
  });

  it('answers one kind at a time when asked', async () => {
    await post('/references', { kind: 'BROKER', id: 'broker-1', name: 'Corretora Alfa' });
    await post('/references', { kind: 'PRODUCT', id: 'auto', name: 'Automovel' });
    await post('/references', { kind: 'INSURER', id: 'insurer-1', name: 'Seguradora Norte' });

    const brokers = await json<ReferenceBody[]>(await fetch(`${baseUrl}/references?kind=BROKER`));

    expect(brokers.every((reference) => reference.kind === 'BROKER')).toBe(true);
    expect(brokers.map((reference) => reference.name)).toContain('Corretora Alfa');
  });

  it('refuses a kind IN-01 does not name', async () => {
    // Shape validation: an unknown kind is a 400, never an empty listing that
    // reads as "nothing is registered".
    expect((await fetch(`${baseUrl}/references?kind=COVERAGE`)).status).toBe(400);
    expect((await post('/references', { kind: 'COVERAGE', id: 'x', name: 'y' })).status).toBe(400);
  });

  it('refuses a reference with no name, in Portuguese', async () => {
    const response = await post('/references', { kind: 'CLIENT', id: 'client-9', name: '  ' });

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      rule: 'IN-01',
      message: expect.stringContaining('Cadastro de referência'),
    });
  });

  it('names the businesses on the panel of OUT-05 (REQ-096)', async () => {
    const panel = await json<CommissionPanelLine[]>(await fetch(`${baseUrl}/commissions`));
    const line = panel.find((entry) => entry.policyNumber === 'PRP-100');

    expect(line?.clientName).toBe('Ana Lima');
    expect(line?.insurerName).toBe('Seguradora Norte');
    // REQ-022 names the field "produto/ramo": the product's name is the ramo.
    expect(line?.productName).toBe('Automovel');
    // The identifier travels beside the name and still matches the record.
    expect(line?.clientId).toBe('client-1');
  });

  it('answers no name for a reference nobody registered, and lists the business', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-IN01',
      policyNumber: 'PRP-IN01',
      clientId: 'cliente-sem-cadastro',
    });

    const panel = await json<CommissionPanelLine[]>(await fetch(`${baseUrl}/commissions`));
    const line = panel.find((entry) => entry.policyId === policy.id);

    // REQ-002: the system reflects a control that happens outside it. A client
    // nobody registered is a missing name, never a business to hide or refuse.
    expect(line?.clientId).toBe('cliente-sem-cadastro');
    expect(line?.clientName).toBeNull();
    // The references that *are* registered still resolve on the same line.
    expect(line?.insurerName).toBe('Seguradora Norte');
  });

  it('replaces the name of a reference registered again', async () => {
    await post('/references', { kind: 'CLIENT', id: 'client-1', name: 'Ana Lima Souza' });

    const clients = await json<ReferenceBody[]>(await fetch(`${baseUrl}/references?kind=CLIENT`));
    const client = clients.filter((reference) => reference.id === 'client-1');

    expect(client).toHaveLength(1);
    expect(client[0]?.name).toBe('Ana Lima Souza');

    // Put it back, so a later reading of this file is not surprised by it.
    await post('/references', { kind: 'CLIENT', id: 'client-1', name: 'Ana Lima' });
  });
});
