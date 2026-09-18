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

/** IN-02 to IN-06: the cadastral data the calculation reads. */
async function registries(): Promise<void> {
  const { useCases } = application;

  // Direct chain of REQ-068: insurer pays 40% of the premium to the Usina.
  await useCases.registerCommissionAgreement.execute({
    insurerId: 'insurer-1',
    productId: 'auto',
    effectiveFrom: '2026-01-01',
    insurerRate: '40',
  });
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
}

async function registerPolicy(options: PolicyOptions = {}) {
  const { useCases } = application;
  const premium = options.premium ?? '100.00';

  const proposal = await useCases.registerProposal.execute({
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: options.paymentMethodId ?? 'credit',
    customerAccepted: true,
    netPremium: premium,
  });

  await useCases.transmitProposal.execute({
    proposalId: proposal.id,
    proposalNumber: options.proposalNumber ?? 'PRP-9001',
    workedCommission: '40',
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

  it('registers the policy even when no agreement covers it', async () => {
    const { useCases } = application;
    const proposal = await useCases.registerProposal.execute({
      clientId: 'client-1',
      brokerId: 'broker-1',
      // No agreement was registered for this insurer.
      insurerId: 'insurer-unknown',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: '100.00',
    });
    await useCases.transmitProposal.execute({
      proposalId: proposal.id,
      proposalNumber: 'PRP-2',
      workedCommission: '40',
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

describe('commercial agreement registry (IN-02, REQ-065)', () => {
  it('replaces the whole record when the same validity is registered again', async () => {
    const replacement = await application.useCases.registerCommissionAgreement.execute({
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '45',
    });

    // The id answered to the caller is the id the row carries: the rates and
    // the identity of the record cannot come apart.
    await application.shutdown();
    const db = new DatabaseSync(file);
    const rows = db
      .prepare('SELECT id, insurer_rate FROM commission_agreement WHERE insurer_id = ?')
      .all('insurer-1') as unknown as { id: string; insurer_rate: string }[];
    db.close();

    expect(rows).toEqual([{ id: replacement.id, insurer_rate: '45' }]);

    application = open();
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
      proofReference: 'comprovante-2026-10-09.pdf',
      userId: 'financeiro-1',
    });

    expect(paid.status).toBe('PAID');
    expect(paid.payment?.amount).toBe('20.00');
    expect(paid.payment?.proofReference).toBe('comprovante-2026-10-09.pdf');

    await application.shutdown();
    application = open();

    const reloaded = await application.useCases.getSettlement.execute(policy.id);
    expect(reloaded.status).toBe('PAID');
    expect(reloaded.payment?.userId).toBe('financeiro-1');
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

async function reconcile(producerCommission = '40.00'): Promise<void> {
  await application.useCases.reconcileCommissionReport.execute({
    competence: '2026-10',
    lines: [{ policyNumber: 'APL-4711', proposalNumber: 'PRP-9001', producerCommission }],
  });
}
