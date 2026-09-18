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
 * Proposal -> Policy -> Installment -> Commission -> Reconciliation -> Settlement
 * ```
 *
 * Two journeys are exercised, because REQ-091 makes the payment method decide
 * where the broker transfer stops: one paid by credit, released at once, and
 * one paid by bank slip, held until the client's first installment is
 * confirmed.
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

  await seedRegistries();
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

async function post(route: string, body?: unknown): Promise<Response> {
  // A transition with no payload sends no body and no content type: several
  // operations of FP-03 are a state change, not a document.
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

/** IN-02 to IN-06: what the Administrator maintains (REQ-061, REQ-125). */
async function seedRegistries(): Promise<void> {
  await post('/commission-agreements', {
    insurerId: 'insurer-1',
    productId: 'auto',
    effectiveFrom: '2026-01-01',
    insurerRate: '40',
  });
  await post('/broker-commission-rates', { brokerId: 'broker-1', rate: '50' });
  await post('/payment-method-release-rules', {
    paymentMethodId: 'credit',
    release: 'IMMEDIATE',
  });
  await post('/payment-method-release-rules', {
    paymentMethodId: 'bank-slip',
    release: 'REQUIRES_RECEIPT_CONFIRMATION',
  });
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
  agreedPayable: string;
  realReceivable: string | null;
  divergent: boolean;
}

interface SettlementBody {
  status: string;
  amount: string;
  brokerId: string;
  payment: { amount: string; proofReference: string; userId: string } | null;
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
}): Promise<PolicyBody> {
  const proposal = await json<{ id: string }>(
    await post('/proposals', {
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: options.paymentMethodId,
      customerAccepted: true,
      netPremium: '100.00',
    }),
  );

  await post(`/proposals/${proposal.id}/transmission`, {
    proposalNumber: options.proposalNumber,
    workedCommission: '40',
  });

  return json<PolicyBody>(
    await post('/policies', {
      proposalId: proposal.id,
      policyNumber: options.policyNumber,
      premium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      installments: [
        { number: 1, amount: '50.00', dueDate: '2026-10-10' },
        { number: 2, amount: '50.00', dueDate: '2026-11-10' },
      ],
    }),
  );
}

describe('financial journey with immediate release (credit)', () => {
  let policy: PolicyBody;

  it('registers the policy and, with it, the agreed commission (FP-01 step 7)', async () => {
    policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-100',
      policyNumber: 'APL-100',
    });

    const commission = await json<CommissionBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/commission`),
    );

    // REQ-068: premium 100.00 -> 40.00 to the Usina -> 20.00 to the broker.
    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.agreedPayable).toBe('20.00');
    expect(commission.realReceivable).toBeNull();
  });

  it('conciliates the commission report by the policy number (FP-02, CA-018)', async () => {
    const response = await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-100', proposalNumber: 'PRP-100', producerCommission: '40.00' }],
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

  it('opens the transfer already released (FP-03 steps 1 and 2, CA-022)', async () => {
    const response = await post(`/policies/${policy.id}/settlement`);

    expect(response.status).toBe(201);
    const settlement = await json<SettlementBody>(response);
    expect(settlement.status).toBe('RELEASED');
    expect(settlement.amount).toBe('20.00');
    expect(settlement.brokerId).toBe('broker-1');
  });

  it('registers the payment sent to the broker (FP-03 step 5, CA-028)', async () => {
    const settlement = await json<SettlementBody>(
      await post(`/policies/${policy.id}/settlement/payment`, {
        amount: '20.00',
        proofReference: 'comprovante-100.pdf',
        userId: 'financeiro-1',
      }),
    );

    expect(settlement.status).toBe('PAID');
    expect(settlement.payment?.amount).toBe('20.00');
    expect(settlement.payment?.userId).toBe('financeiro-1');

    const reread = await json<SettlementBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/settlement`),
    );
    expect(reread.status).toBe('PAID');
  });
});

describe('financial journey held by a bank slip', () => {
  let policy: PolicyBody;

  it('holds the transfer until the first installment is confirmed (CA-023, EX-07)', async () => {
    policy = await sellPolicy({
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-200',
      policyNumber: 'APL-200',
    });

    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-200', proposalNumber: 'PRP-200', producerCommission: '40.00' }],
    });

    const settlement = await json<SettlementBody>(await post(`/policies/${policy.id}/settlement`));
    expect(settlement.status).toBe('AWAITING_CONFIRMATION');
  });

  it('refuses to release without the confirmation (REJ-009), in Portuguese', async () => {
    const response = await post(`/policies/${policy.id}/settlement/release`);

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      error: 'business_rule_violation',
      rule: 'REQ-091',
      message: 'Repasse exige confirmação do pagamento da primeira parcela pelo cliente.',
    });
  });

  it('refuses a receipt confirmation that does not say who made it (REQ-123)', async () => {
    const response = await post(`/policies/${policy.id}/installments/1/payment`, { userId: '  ' });

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ rule: 'REQ-123' });
  });

  it('releases once the client pays the first installment (IN-13, REQ-092)', async () => {
    const paid = await json<PolicyBody>(
      await post(`/policies/${policy.id}/installments/1/payment`, { userId: 'financeiro-1' }),
    );
    expect(paid.installments[0]?.status).toBe('PAID');
    expect(paid.installments[1]?.status).toBe('PENDING');
    // REQ-123: the confirmation that releases the transfer says who and when.
    expect(paid.installments[0]?.confirmedBy).toBe('financeiro-1');
    expect(paid.installments[0]?.confirmedAt).not.toBeNull();

    const settlement = await json<SettlementBody>(
      await post(`/policies/${policy.id}/settlement/release`),
    );
    expect(settlement.status).toBe('RELEASED');
  });
});

describe('divergences and pendencies', () => {
  it('flags a divergence and lets it be resolved by hand (CA-017, CA-026)', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-300',
      policyNumber: 'APL-300',
    });

    // The insurer paid less than the agreement says (EX-02).
    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-300', proposalNumber: 'PRP-300', producerCommission: '31.00' }],
    });

    const divergent = await json<CommissionBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/commission`),
    );
    expect(divergent.divergent).toBe(true);
    expect(divergent.agreedReceivable).toBe('40.00');
    expect(divergent.realReceivable).toBe('31.00');

    // REQ-077: the divergence does not block the transfer.
    const settlement = await json<SettlementBody>(await post(`/policies/${policy.id}/settlement`));
    expect(settlement.status).toBe('RELEASED');

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
          { policyNumber: 'APL-100', proposalNumber: 'PRP-100', producerCommission: '40.00' },
        ],
      }),
    );

    expect(report.duplicated).toBe(1);
    expect(report.reconciled).toBe(0);
  });

  it('refuses an override without a justification (CA-015, REJ-010)', async () => {
    const response = await post('/policies/any/commission/override', {
      payable: '25.00',
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
      policyNumber: 'APL-400',
    });

    const response = await post(`/policies/${policy.id}/commission/override`, {
      payable: '25.00',
      justification: '   ',
      userId: 'admin-1',
    });

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      rule: 'REQ-067',
      message: 'Ajuste de comissão por apólice exige justificativa.',
    });
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
