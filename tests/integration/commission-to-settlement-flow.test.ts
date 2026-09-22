import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';

/**
 * The financial chain against the real SQLite driver: use cases, repositories
 * and the unit of work wired the way the process wires them.
 *
 * `Installment -> Commission -> Reconciliation -> Settlement`, with the
 * registries the Administrator maintains (IN-02 to IN-06) filled first,
 * because without them there is nothing to calculate.
 */
let directory: string;
/**
 * A proof with a byte no text encoding survives (0x00) and one above ASCII
 * (0xFF): if the driver ever stored the document as text, this is what would
 * come back changed.
 */
const PROOF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);

let file: string;
let application: Application;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-financial-'));
  file = path.join(directory, 'usina.sqlite');
  application = open();
  await registries();
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function open(): Application {
  return composeApplication(loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }));
}

/**
 * IN-05 and IN-06: the cadastral data the calculation reads. The Usina side is
 * the CT of 40% the proposal carries (REQ-236).
 */
async function registries(): Promise<void> {
  const { useCases } = application;

  // IN-05: the broker gets half of what the Usina received.
  await useCases.registerBrokerCommissionRate.execute({ brokerId: 'broker-1', rate: '50' });
  // REQ-091: credit releases at once, bank slip waits for the first installment.
  await useCases.registerPaymentMethodReleaseRule.execute({
    paymentMethodId: 'credit',
    release: 'IMMEDIATE',
  });
  await useCases.registerPaymentMethodReleaseRule.execute({
    paymentMethodId: 'bank-slip',
    release: 'REQUIRES_RECEIPT_CONFIRMATION',
  });
}

interface PolicyOptions {
  readonly paymentMethodId?: string;
  readonly proposalNumber?: string;
  readonly policyNumber?: string;
  readonly premium?: string;
  /** IN-05: the broker the business belongs to, for the statement of OUT-07. */
  readonly brokerId?: string;
}

async function registerPolicy(options: PolicyOptions = {}) {
  const { useCases } = application;
  const premium = options.premium ?? '100.00';

  const proposal = await useCases.registerProposal.execute({
    clientId: 'client-1',
    brokerId: options.brokerId ?? 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: options.paymentMethodId ?? 'credit',
    customerAccepted: true,
    proposalNumber: options.proposalNumber ?? 'PRP-9001',
    netPremium: premium,
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
  });

  return useCases.registerPolicy.execute({
    proposalId: proposal.id,
    policyNumber: options.policyNumber ?? 'APL-4711',
    premium,
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [
      { number: 1, amount: '50.00', dueDate: '2026-10-10' },
      { number: 2, amount: '50.00', dueDate: '2026-11-10' },
    ],
  });
}

describe('policy to agreed commission (FP-01 step 7)', () => {
  it('calculates and persists the agreed commission when the policy is registered', async () => {
    const policy = await registerPolicy();

    const commission = await application.useCases.getCommission.execute(policy.id);

    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.agreedPayable).toBe('20.00');
    expect(commission.realReceivable).toBeNull();
    expect(commission.divergent).toBe(false);
  });

  it('survives a reopening of the database (REQ-124)', async () => {
    const policy = await registerPolicy();

    await application.shutdown();
    application = open();

    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.basis.insurerRate).toBe('40');
  });

  it('stores monetary values as exact decimal text, never as a float (REQ-120)', async () => {
    const policy = await registerPolicy();
    await application.shutdown();

    const db = new DatabaseSync(file);
    const row = db.prepare('SELECT * FROM commission WHERE policy_id = ?').get(policy.id) as {
      agreed_receivable: string;
    };
    const types = db
      .prepare(
        `SELECT typeof(agreed_receivable) AS amount, typeof(insurer_rate) AS rate
         FROM commission WHERE policy_id = ?`,
      )
      .get(policy.id) as { amount: string; rate: string };
    db.close();

    expect(row.agreed_receivable).toBe('40.00');
    expect(types.amount).toBe('text');
    expect(types.rate).toBe('text');

    application = open();
  });

  it('registers the policy even when the broker has no commission table (IN-05)', async () => {
    const { useCases } = application;
    const proposal = await useCases.registerProposal.execute({
      clientId: 'client-1',
      // No commission table was registered for this broker.
      brokerId: 'broker-unknown',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      proposalNumber: 'PRP-2',
      netPremium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      installments: [],
      workedCommission: '40',
      workedCommissionMode: 'INTEGRAL',
      intermediary: null,
      author: 'operator',
    });

    const policy = await useCases.registerPolicy.execute({
      proposalId: proposal.id,
      policyNumber: 'APL-2',
      premium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      installments: [{ number: 1, amount: '100.00', dueDate: '2026-10-10' }],
    });

    expect(policy.status).toBe('ACTIVE');
    await expect(useCases.getCommission.execute(policy.id)).rejects.toThrow();
  });
});

describe('commission to reconciliation (FP-02)', () => {
  it('matches by the policy number and records the real value (REQ-082, CA-018)', async () => {
    const policy = await registerPolicy();

    const report = await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
      ],
    });

    expect(report.reconciled).toBe(1);

    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.status).toBe('RECONCILED');
    expect(commission.realReceivable).toBe('40.00');
  });

  it('matches a line that brings only the proposal number (CA-019)', async () => {
    const policy = await registerPolicy();

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [{ proposalNumber: 'PRP-9001', producerCommission: '40.00' }],
    });

    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.status).toBe('RECONCILED');
  });

  it('shows agreed and real side by side with the divergence flagged (CA-016, CA-017)', async () => {
    const policy = await registerPolicy();

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
      ],
    });

    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.agreedReceivable).toBe('40.00');
    expect(commission.realReceivable).toBe('31.00');
    expect(commission.divergent).toBe(true);
    expect(commission.status).toBe('DIVERGENT');
  });

  it('records the manual resolution of a divergence (REQ-085, CA-026)', async () => {
    const policy = await registerPolicy();
    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
      ],
    });

    const resolved = await application.useCases.resolveCommissionDivergence.execute({
      policyId: policy.id,
      justification: 'seguradora confirmou o valor menor',
      userId: 'financeiro-1',
    });

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution?.userId).toBe('financeiro-1');
    // REJ-014: the divergent values are still there after the resolution.
    expect(resolved.agreedReceivable).toBe('40.00');
    expect(resolved.realReceivable).toBe('31.00');
  });

  it('opens a pendency for a line with no policy and generates no entry (REQ-083, CA-020)', async () => {
    const policy = await registerPolicy();

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [{ proposalNumber: 'PRP-DESCONHECIDA', producerCommission: '12.34' }],
    });

    const pendencies = await application.useCases.listReconciliationPendencies.execute();
    expect(pendencies).toHaveLength(1);
    expect(pendencies[0]?.proposalNumber).toBe('PRP-DESCONHECIDA');
    expect(pendencies[0]?.reportedCommission).toBe('12.34');

    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.status).toBe('FORECAST');
  });

  it('does not duplicate the pendency when the same report is imported again (CA-021, EX-05)', async () => {
    const report = {
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-GHOST', proposalNumber: 'PRP-GHOST', producerCommission: '12.34' },
      ],
    };

    await application.useCases.reconcileCommissionReport.execute(report);
    await application.useCases.reconcileCommissionReport.execute(report);

    // OUT-06 is a list a human works through: the same unmatched line coming
    // back is the same pendency, not a new one.
    expect(await application.useCases.listReconciliationPendencies.execute()).toHaveLength(1);

    await application.shutdown();
    const db = new DatabaseSync(file);
    const count = db.prepare('SELECT COUNT(*) AS total FROM reconciliation_pendency').get() as {
      total: number;
    };
    db.close();
    expect(count.total).toBe(1);

    application = open();
  });

  it('does not duplicate entries when the same report is imported again (CA-021, EX-05)', async () => {
    const policy = await registerPolicy();
    const report = {
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
      ],
    };

    await application.useCases.reconcileCommissionReport.execute(report);
    const second = await application.useCases.reconcileCommissionReport.execute(report);

    expect(second.duplicated).toBe(1);

    // The UNIQUE constraint of the schema is what guarantees a single row
    // survives, on top of the domain rule.
    await application.shutdown();
    const db = new DatabaseSync(file);
    const count = db
      .prepare('SELECT COUNT(*) AS total FROM commission WHERE policy_id = ?')
      .get(policy.id) as { total: number };
    db.close();
    expect(count.total).toBe(1);

    application = open();
  });

  it('applies the whole report or none of it', async () => {
    const policy = await registerPolicy();

    // The second line carries a malformed amount (REQ-120), which fails after
    // the first line was already written inside the unit of work.
    await expect(
      application.useCases.reconcileCommissionReport.execute({
        competence: '2026-10',
        lines: [
          { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
          { proposalNumber: 'PRP-DESCONHECIDA', producerCommission: 'nao-e-um-valor' },
        ],
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    // The savepoint rolled the first line back: nothing was apurado, and a
    // re-import is not going to be refused by REQ-086 for half the file.
    const commission = await application.useCases.getCommission.execute(policy.id);
    expect(commission.status).toBe('FORECAST');
    expect(commission.realReceivable).toBeNull();
    expect(await application.useCases.listReconciliationPendencies.execute()).toHaveLength(0);
  });
});

describe('agreed versus real panel (OUT-05, REQ-076)', () => {
  /** Two businesses, so a listing has something to order and to filter. */
  async function twoPolicies() {
    const first = await registerPolicy({ proposalNumber: 'PRP-9001', policyNumber: 'APL-4711' });
    const second = await registerPolicy({ proposalNumber: 'PRP-9002', policyNumber: 'APL-4712' });
    return { first, second };
  }

  it('lists every policy with both values (CA-016)', async () => {
    const { first, second } = await twoPolicies();

    const panel = await application.useCases.listCommissions.execute();

    // The order between two registrations of the same instant is the driver's
    // tie-break, not a rule; what the panel promises is that both are on it.
    expect(panel.map((line) => line.policyId).sort()).toEqual([first.id, second.id].sort());

    const line = panel.find((entry) => entry.policyNumber === 'APL-4712');
    expect(line?.proposalNumber).toBe('PRP-9002');
    expect(line?.clientId).toBe('client-1');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.effectiveReceivable).toBe('40.00');
    expect(line?.effectivePayable).toBe('20.00');
    // REQ-075: nothing is apurado before a report matches the policy.
    expect(line?.realReceivable).toBeNull();
  });

  it('survives a reopening of the database', async () => {
    await twoPolicies();

    await application.shutdown();
    application = open();

    const panel = await application.useCases.listCommissions.execute();
    expect(panel.map((line) => line.policyNumber).sort()).toEqual(['APL-4711', 'APL-4712']);
  });

  it('narrows to the divergences the Financeiro has to treat (FP-02 step 5)', async () => {
    const { first } = await twoPolicies();

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
        { policyNumber: 'APL-4712', proposalNumber: 'PRP-9002', producerCommission: '40.00' },
      ],
    });

    const divergent = await application.useCases.listCommissions.execute({ status: 'DIVERGENT' });

    expect(divergent).toHaveLength(1);
    expect(divergent[0]?.policyId).toBe(first.id);
    expect(divergent[0]?.effectiveReceivable).toBe('40.00');
    expect(divergent[0]?.realReceivable).toBe('31.00');
    expect(divergent[0]?.divergent).toBe(true);
    expect(divergent[0]?.reconciledCompetence).toBe('2026-10');

    // REQ-085: once a human closes it, it leaves the worklist and stays on the
    // panel with the values that disagreed (REQ-124, REJ-014).
    await application.useCases.resolveCommissionDivergence.execute({
      policyId: first.id,
      justification: 'seguradora confirmou o valor menor',
      userId: 'financeiro-1',
    });

    await expect(
      application.useCases.listCommissions.execute({ status: 'DIVERGENT' }),
    ).resolves.toEqual([]);

    const [resolved] = await application.useCases.listCommissions.execute({ status: 'RESOLVED' });
    expect(resolved?.policyId).toBe(first.id);
    expect(resolved?.realReceivable).toBe('31.00');
  });

  it('carries the override of REQ-066 into the panel', async () => {
    const { first } = await twoPolicies();

    await application.useCases.overrideCommission.execute({
      policyId: first.id,
      receivable: '45.00',
      justification: 'acordo extraordinario com a seguradora',
      userId: 'admin-1',
    });

    const panel = await application.useCases.listCommissions.execute();
    const adjusted = panel.find((line) => line.policyId === first.id);

    expect(adjusted).toBeDefined();
    // The calculated value stays next to the one in force (REQ-124).
    expect(adjusted?.agreedReceivable).toBe('40.00');
    expect(adjusted?.effectiveReceivable).toBe('45.00');
  });
});

describe('reconciliation to settlement (FP-03)', () => {
  it('releases the transfer at once for an immediate payment method (CA-022)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'credit' });
    await reconcile();

    const settlement = await application.useCases.openSettlement.execute({ policyId: policy.id });

    expect(settlement.status).toBe('RELEASED');
    // REQ-093: the broker table over the base of REQ-062.
    expect(settlement.amount).toBe('20.00');
    expect(settlement.brokerId).toBe('broker-1');
  });

  it('holds the transfer for a bank slip until the first installment is confirmed (CA-023, EX-07)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'bank-slip' });
    await reconcile();

    const opened = await application.useCases.openSettlement.execute({ policyId: policy.id });
    expect(opened.status).toBe('AWAITING_CONFIRMATION');

    // REJ-009: no release without the confirmation registered.
    await expect(
      application.useCases.releaseSettlement.execute({ policyId: policy.id }),
    ).rejects.toThrow(BusinessRuleViolation);

    await application.useCases.payInstallment.execute({
      policyId: policy.id,
      number: 1,
      userId: 'financeiro-1',
    });
    const released = await application.useCases.releaseSettlement.execute({
      policyId: policy.id,
    });

    expect(released.status).toBe('RELEASED');
  });

  it('records the payment sent to the broker (REQ-095, CA-028)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'credit' });
    await reconcile();
    await application.useCases.openSettlement.execute({ policyId: policy.id });

    const paid = await application.useCases.registerSettlementPayment.execute({
      policyId: policy.id,
      amount: '20.00',
      proof: {
        fileName: 'comprovante-2026-10-09.pdf',
        contentType: 'application/pdf',
        content: PROOF_BYTES,
      },
      userId: 'financeiro-1',
    });

    expect(paid.status).toBe('PAID');
    expect(paid.payment?.amount).toBe('20.00');
    expect(paid.payment?.proof).toEqual({
      fileName: 'comprovante-2026-10-09.pdf',
      contentType: 'application/pdf',
      byteSize: PROOF_BYTES.length,
    });

    await application.shutdown();
    application = open();

    const reloaded = await application.useCases.getSettlement.execute(policy.id);
    expect(reloaded.status).toBe('PAID');
    expect(reloaded.payment?.userId).toBe('financeiro-1');

    // REQ-095, CA-028: the document survives the restart byte for byte. An
    // attachment nobody can open again evidences nothing.
    const proof = await application.useCases.getSettlementPaymentProof.execute(policy.id);
    expect(proof.fileName).toBe('comprovante-2026-10-09.pdf');
    expect(proof.contentType).toBe('application/pdf');
    expect([...proof.content]).toEqual([...PROOF_BYTES]);
  });

  it('keeps the proof as a BLOB, never as text (REQ-095)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'credit' });
    await reconcile();
    await application.useCases.openSettlement.execute({ policyId: policy.id });
    await application.useCases.registerSettlementPayment.execute({
      policyId: policy.id,
      amount: '20.00',
      proof: { fileName: 'c.pdf', contentType: 'application/pdf', content: PROOF_BYTES },
      userId: 'financeiro-1',
    });

    await application.shutdown();
    const db = new DatabaseSync(file);
    const row = db
      .prepare('SELECT typeof(content) AS kind, length(content) AS size FROM document')
      .get() as { kind: string; size: number };
    db.close();
    application = open();

    // Text would corrupt any byte outside the ASCII range on the way back.
    expect(row.kind).toBe('blob');
    expect(row.size).toBe(PROOF_BYTES.length);
  });

  it('writes no document when the payment is refused (REQ-095)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'bank-slip' });
    await reconcile();
    // EX-07: the transfer is held, so there is nothing to pay yet.
    await application.useCases.openSettlement.execute({ policyId: policy.id });

    await expect(
      application.useCases.registerSettlementPayment.execute({
        policyId: policy.id,
        amount: '20.00',
        proof: { fileName: 'c.pdf', contentType: 'application/pdf', content: PROOF_BYTES },
        userId: 'financeiro-1',
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    await application.shutdown();
    const db = new DatabaseSync(file);
    const { total } = db.prepare('SELECT count(*) AS total FROM document').get() as {
      total: number;
    };
    db.close();
    application = open();

    expect(total).toBe(0);
  });

  it('refuses to open a transfer before the real commission is apurada (FP-03 step 1)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'credit' });

    await expect(
      application.useCases.openSettlement.execute({ policyId: policy.id }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('carries the override into the transfer (REQ-066, REQ-093)', async () => {
    const policy = await registerPolicy({ paymentMethodId: 'credit' });
    await reconcile();

    await application.useCases.overrideCommission.execute({
      policyId: policy.id,
      payable: '25.00',
      justification: 'acordo extraordinario com o corretor',
      userId: 'admin-1',
    });

    const settlement = await application.useCases.openSettlement.execute({ policyId: policy.id });

    expect(settlement.amount).toBe('25.00');
  });
});

describe('broker commission statement (OUT-07)', () => {
  it('shows what is forecast, held, released and paid, by broker', async () => {
    // Four businesses of the same broker, one in each situation OUT-07 names.
    const forecast = await registerPolicy({
      proposalNumber: 'PRP-8001',
      policyNumber: 'APL-8001',
    });
    const held = await registerPolicy({
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-8002',
      policyNumber: 'APL-8002',
    });
    const released = await registerPolicy({
      proposalNumber: 'PRP-8003',
      policyNumber: 'APL-8003',
    });
    const paid = await registerPolicy({ proposalNumber: 'PRP-8004', policyNumber: 'APL-8004' });

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-8002', proposalNumber: 'PRP-8002', producerCommission: '40.00' },
        { policyNumber: 'APL-8003', proposalNumber: 'PRP-8003', producerCommission: '40.00' },
        { policyNumber: 'APL-8004', proposalNumber: 'PRP-8004', producerCommission: '40.00' },
      ],
    });

    await application.useCases.openSettlement.execute({ policyId: held.id });
    await application.useCases.openSettlement.execute({ policyId: released.id });
    await application.useCases.openSettlement.execute({ policyId: paid.id });
    await application.useCases.registerSettlementPayment.execute({
      policyId: paid.id,
      amount: '19.50',
      proof: {
        fileName: 'comprovante-8004.pdf',
        contentType: 'application/pdf',
        content: PROOF_BYTES,
      },
      userId: 'financeiro-1',
    });

    const statement = await application.useCases.listBrokerStatement.execute({
      brokerId: 'broker-1',
    });

    const byPolicy = new Map(statement.lines.map((line) => [line.policyId, line]));
    expect(statement.lines).toHaveLength(4);

    // The *prevista* of OUT-07: commission calculated, transfer never opened.
    expect(byPolicy.get(forecast.id)?.settlement).toBeNull();
    expect(byPolicy.get(forecast.id)?.payable).toBe('20.00');
    // EX-07: the bank slip waits for the client to pay the first installment.
    expect(byPolicy.get(held.id)?.settlement?.status).toBe('AWAITING_CONFIRMATION');
    expect(byPolicy.get(released.id)?.settlement?.status).toBe('RELEASED');
    expect(byPolicy.get(paid.id)?.settlement?.payment?.proof.fileName).toBe('comprovante-8004.pdf');

    // REQ-120: the totals are exact, and the paid one is what was sent.
    expect(statement.totals).toEqual({
      payable: '80.00',
      awaitingConfirmation: '20.00',
      released: '20.00',
      paid: '19.50',
    });
  });

  it('separates one broker from another and survives a reopening', async () => {
    await application.useCases.registerBrokerCommissionRate.execute({
      brokerId: 'broker-2',
      rate: '25',
    });

    await registerPolicy({ proposalNumber: 'PRP-8101', policyNumber: 'APL-8101' });
    await registerPolicy({
      brokerId: 'broker-2',
      proposalNumber: 'PRP-8102',
      policyNumber: 'APL-8102',
    });

    await application.shutdown();
    application = open();

    const first = await application.useCases.listBrokerStatement.execute({
      brokerId: 'broker-1',
    });
    const second = await application.useCases.listBrokerStatement.execute({
      brokerId: 'broker-2',
    });
    const everyone = await application.useCases.listBrokerStatement.execute();

    expect(first.lines.map((line) => line.policyNumber)).toEqual(['APL-8101']);
    // IN-05: a different table produces a different value for the same premium.
    expect(second.lines.map((line) => line.policyNumber)).toEqual(['APL-8102']);
    expect(second.totals.payable).toBe('10.00');
    expect(everyone.brokerId).toBeNull();
    expect(everyone.lines).toHaveLength(2);
    expect(everyone.totals.payable).toBe('30.00');
  });
});

async function reconcile(producerCommission = '40.00'): Promise<void> {
  await application.useCases.reconcileCommissionReport.execute({
    competence: '2026-10',
    lines: [{ policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission }],
  });
}
