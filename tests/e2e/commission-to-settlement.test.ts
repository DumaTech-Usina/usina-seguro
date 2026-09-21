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

/** The statement of OUT-07, as `GET /broker-commission-statements` answers it. */
interface BrokerStatementBody {
  brokerId: string | null;
  lines: readonly {
    policyId: string;
    policyNumber: string;
    proposalNumber: string | null;
    clientId: string;
    clientName: string | null;
    brokerId: string;
    brokerName: string | null;
    productName: string | null;
    payable: string;
    commissionStatus: string;
    divergent: boolean;
    settlement: { status: string; amount: string; payment: { amount: string } | null } | null;
  }[];
  totals: { payable: string; awaitingConfirmation: string; released: string; paid: string };
}

/** A proof with bytes no text encoding survives, to prove the round-trip. */
const PROOF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

interface SettlementBody {
  status: string;
  amount: string;
  brokerId: string;
  payment: {
    amount: string;
    proof: { fileName: string; contentType: string; byteSize: number };
    userId: string;
  } | null;
}

/** One agreement, as `GET /commission-agreements` answers it (IN-02). */
interface AgreementBody {
  id: string;
  insurerId: string;
  productId: string;
  effectiveFrom: string;
  insurerRate: string;
  chain: string;
  intermediaryId: string | null;
  intermediaryRate: string | null;
  brokerBase: string;
  registeredAt: string;
}

interface BrokerRateBody {
  brokerId: string;
  rate: string;
  registeredAt: string;
}

interface ReleaseRuleBody {
  paymentMethodId: string;
  release: string;
  registeredAt: string;
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

  it('refuses a payment with no proof attached (REQ-095, CA-028)', async () => {
    // Shape, not rule: the document is part of what a payment *is*, so the
    // request without it never reaches the domain.
    const response = await post(`/policies/${policy.id}/settlement/payment`, {
      amount: '20.00',
      userId: 'financeiro-1',
    });

    expect(response.status).toBe(400);
  });

  it('registers the payment sent to the broker (FP-03 step 5, CA-028)', async () => {
    const settlement = await json<SettlementBody>(
      await post(`/policies/${policy.id}/settlement/payment`, {
        amount: '20.00',
        proof: {
          fileName: 'comprovante-100.pdf',
          contentType: 'application/pdf',
          content: Buffer.from(PROOF_BYTES).toString('base64'),
        },
        userId: 'financeiro-1',
      }),
    );

    expect(settlement.status).toBe('PAID');
    expect(settlement.payment?.amount).toBe('20.00');
    expect(settlement.payment?.userId).toBe('financeiro-1');
    expect(settlement.payment?.proof).toEqual({
      fileName: 'comprovante-100.pdf',
      contentType: 'application/pdf',
      byteSize: PROOF_BYTES.length,
    });

    const reread = await json<SettlementBody>(
      await fetch(`${baseUrl}/policies/${policy.id}/settlement`),
    );
    expect(reread.status).toBe('PAID');
  });

  it('serves the attached proof back, byte for byte (REQ-095, CA-028)', async () => {
    const response = await fetch(`${baseUrl}/policies/${policy.id}/settlement/payment/proof`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PROOF_BYTES]);
  });

  it('hands the proof over as a download, never as a page of this app', async () => {
    // A proof uploaded as HTML or SVG must not run in the origin that serves
    // the application. `attachment` plus `nosniff` is what prevents it.
    const response = await fetch(`${baseUrl}/policies/${policy.id}/settlement/payment/proof`);

    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('comprovante-100.pdf');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers 404 for the proof of a policy with no payment (REQ-095)', async () => {
    const response = await fetch(`${baseUrl}/policies/ghost/settlement/payment/proof`);

    expect(response.status).toBe(404);
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

  it('lists the panel of every policy and narrows it by state (OUT-05)', async () => {
    await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-400',
      policyNumber: 'APL-400',
    });
    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-400', proposalNumber: 'PRP-400', producerCommission: '33.00' }],
    });

    const panel = await json<readonly CommissionPanelLine[]>(await fetch(`${baseUrl}/commissions`));
    const line = panel.find((entry) => entry.policyNumber === 'APL-400');

    // CA-016: the pair and the flag, with what identifies the business.
    expect(line?.effectiveReceivable).toBe('40.00');
    expect(line?.realReceivable).toBe('33.00');
    expect(line?.divergent).toBe(true);
    expect(line?.proposalNumber).toBe('PRP-400');
    expect(line?.insurerId).toBe('insurer-1');

    const divergent = await json<readonly CommissionPanelLine[]>(
      await fetch(`${baseUrl}/commissions?status=DIVERGENT`),
    );
    expect(divergent.map((entry) => entry.policyNumber)).toContain('APL-400');
    expect(divergent.every((entry) => entry.status === 'DIVERGENT')).toBe(true);
  });

  it('refuses a state the machine of section 10.5 does not have', async () => {
    // Shape validation: an unknown state is a 400, never an empty panel that
    // reads as "nothing diverges".
    const response = await fetch(`${baseUrl}/commissions?status=WHATEVER`);

    expect(response.status).toBe(400);
  });

  it('answers the statement of a broker with its totals (OUT-07)', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-500',
      policyNumber: 'APL-500',
    });
    await post('/commission-reconciliations', {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-500', proposalNumber: 'PRP-500', producerCommission: '40.00' }],
    });
    await post(`/policies/${policy.id}/settlement`);

    const statement = await json<BrokerStatementBody>(
      await fetch(`${baseUrl}/broker-commission-statements?brokerId=broker-1`),
    );
    const line = statement.lines.find((entry) => entry.policyId === policy.id);

    expect(statement.brokerId).toBe('broker-1');
    // REQ-093 on the line, and the transfer of FP-03 beside it.
    expect(line?.payable).toBe('20.00');
    expect(line?.settlement?.status).toBe('RELEASED');
    expect(line?.proposalNumber).toBe('PRP-500');
    // REQ-120: the totals travel as decimal strings, like every amount.
    expect(statement.totals.payable).toMatch(/^\d+\.\d{2}$/);
  });

  it('answers an empty statement for a broker with no business, not a 404', async () => {
    const statement = await json<BrokerStatementBody>(
      await fetch(`${baseUrl}/broker-commission-statements?brokerId=corretor-inexistente`),
    );

    expect(statement.lines).toEqual([]);
    expect(statement.totals.payable).toBe('0.00');
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
 * IN-02, IN-05 and IN-06 read back over HTTP.
 *
 * `seedRegistries` above registered them; these are the parameters every
 * calculation in this file ran on, and REQ-061/REQ-125 make them data rather
 * than code. Until these routes existed nothing could read them back, so a
 * wrong percentage was only visible in the commission it had already produced.
 */
describe('the registries the Administrator maintains', () => {
  it('answers the agreements registered, by insurer and product (IN-02)', async () => {
    const listed = await json<AgreementBody[]>(await fetch(`${baseUrl}/commission-agreements`));

    const auto = listed.find(
      (agreement) => agreement.insurerId === 'insurer-1' && agreement.productId === 'auto',
    );

    expect(auto?.insurerRate).toBe('40');
    // REQ-060, REQ-062: no intermediary was registered for this relation.
    expect(auto?.chain).toBe('DIRECT');
    expect(auto?.intermediaryId).toBeNull();
    expect(auto?.brokerBase).toBe('USINA');
    expect(auto?.effectiveFrom).toBe('2026-01-01');
    expect(auto?.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('answers a registration and a reading in the same shape', async () => {
    const registered = await json<AgreementBody>(
      await post('/commission-agreements', {
        insurerId: 'insurer-shape',
        productId: 'vida',
        effectiveFrom: '2026-03-01',
        insurerRate: '37.25',
        intermediary: { intermediaryId: 'mega', intermediaryRate: '80', brokerBase: 'USINA' },
      }),
    );

    const listed = await json<AgreementBody[]>(await fetch(`${baseUrl}/commission-agreements`));
    const found = listed.find((agreement) => agreement.insurerId === 'insurer-shape');

    expect(found).toEqual(registered);
    // REQ-121: the scale the administrator informed survives the round trip.
    expect(found?.insurerRate).toBe('37.25');
    expect(found?.chain).toBe('INTERMEDIARY');
    expect(found?.brokerBase).toBe('USINA');
  });

  it('does not list a corrected validity twice (REQ-065, REQ-124)', async () => {
    await post('/commission-agreements', {
      insurerId: 'insurer-fix',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '40',
    });
    await post('/commission-agreements', {
      insurerId: 'insurer-fix',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '42',
    });

    const listed = await json<AgreementBody[]>(await fetch(`${baseUrl}/commission-agreements`));
    const fixed = listed.filter((agreement) => agreement.insurerId === 'insurer-fix');

    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.insurerRate).toBe('42');
  });

  it('answers the broker commission table (IN-05, REQ-093)', async () => {
    const listed = await json<BrokerRateBody[]>(await fetch(`${baseUrl}/broker-commission-rates`));

    expect(listed.find((rate) => rate.brokerId === 'broker-1')?.rate).toBe('50');
    // One rate per broker: the table has no second dimension.
    expect(listed.filter((rate) => rate.brokerId === 'broker-1')).toHaveLength(1);
  });

  it('answers the release rule of each payment method, and no other (IN-06)', async () => {
    const listed = await json<ReleaseRuleBody[]>(
      await fetch(`${baseUrl}/payment-method-release-rules`),
    );

    expect(listed.find((rule) => rule.paymentMethodId === 'credit')?.release).toBe('IMMEDIATE');
    expect(listed.find((rule) => rule.paymentMethodId === 'bank-slip')?.release).toBe(
      'REQUIRES_RECEIPT_CONFIRMATION',
    );
    // DEC-002: Pix has no rule, and the listing does not invent one to show.
    expect(listed.some((rule) => rule.paymentMethodId === 'pix')).toBe(false);
  });

  it('shows a release rule changed by configuration, not by code (CA-024)', async () => {
    await post('/payment-method-release-rules', {
      paymentMethodId: 'pagamento-novo',
      release: 'IMMEDIATE',
    });
    await post('/payment-method-release-rules', {
      paymentMethodId: 'pagamento-novo',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
    });

    const listed = await json<ReleaseRuleBody[]>(
      await fetch(`${baseUrl}/payment-method-release-rules`),
    );
    const changed = listed.filter((rule) => rule.paymentMethodId === 'pagamento-novo');

    expect(changed).toHaveLength(1);
    expect(changed[0]?.release).toBe('REQUIRES_RECEIPT_CONFIRMATION');
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
    const line = panel.find((entry) => entry.policyNumber === 'APL-100');

    expect(line?.clientName).toBe('Ana Lima');
    expect(line?.insurerName).toBe('Seguradora Norte');
    // REQ-022 names the field "produto/ramo": the product's name is the ramo.
    expect(line?.productName).toBe('Automovel');
    // The identifier travels beside the name and still matches the record.
    expect(line?.clientId).toBe('client-1');
  });

  it('names the businesses on the statement of OUT-07 (REQ-096)', async () => {
    const statement = await json<BrokerStatementBody>(
      await fetch(`${baseUrl}/broker-commission-statements?brokerId=broker-1`),
    );
    const [line] = statement.lines;

    expect(line?.clientName).toBe('Ana Lima');
    expect(line?.brokerName).toBe('Corretora Alfa');
    expect(line?.productName).toBe('Automovel');
  });

  it('answers no name for a reference nobody registered, and lists the business', async () => {
    const policy = await sellPolicy({
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-IN01',
      policyNumber: 'APL-IN01',
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
