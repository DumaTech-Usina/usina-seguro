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
 * `Policy -> agreed Commission -> Reconciliation`. The agreed commission comes
 * from the proposal's CT (REQ-236); no registry has to be filled first.
 */
let directory: string;
let file: string;
let application: Application;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-financial-'));
  file = path.join(directory, 'usina.sqlite');
  application = open();
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function open(): Application {
  return composeApplication(loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }));
}

interface PolicyOptions {
  readonly paymentMethodId?: string;
  /** Also the policy number: the policy inherits it (REQ-241). */
  readonly proposalNumber?: string;
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
    proposalNumber: options.proposalNumber ?? 'PRP-9001',
    netPremium: premium,
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    // The policy inherits the schedule (REQ-241).
    installments: [
      { amount: '50.00', dueDate: '2026-10-10' },
      { amount: '50.00', dueDate: '2026-11-10' },
    ],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
  });

  return useCases.registerPolicy.execute({ proposalId: proposal.id, userId: 'operator' });
}

describe('policy to agreed commission (FP-01 step 7)', () => {
  it('calculates and persists the agreed commission when the policy is registered', async () => {
    const policy = await registerPolicy();

    const commission = await application.useCases.getCommission.execute(policy.id);

    expect(commission.status).toBe('FORECAST');
    expect(commission.agreedReceivable).toBe('40.00');
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
});

describe('commission to reconciliation (FP-02)', () => {
  it('matches by the policy number and records the real value (REQ-082, CA-018)', async () => {
    const policy = await registerPolicy();

    const report = await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
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
        { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
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
        { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
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
        { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
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
          { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '40.00' },
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
    const first = await registerPolicy({ proposalNumber: 'PRP-9001' });
    const second = await registerPolicy({ proposalNumber: 'PRP-9002' });
    return { first, second };
  }

  it('lists every policy with both values (CA-016)', async () => {
    const { first, second } = await twoPolicies();

    const panel = await application.useCases.listCommissions.execute();

    // The order between two registrations of the same instant is the driver's
    // tie-break, not a rule; what the panel promises is that both are on it.
    expect(panel.map((line) => line.policyId).sort()).toEqual([first.id, second.id].sort());

    const line = panel.find((entry) => entry.policyNumber === 'PRP-9002');
    expect(line?.proposalNumber).toBe('PRP-9002');
    expect(line?.clientId).toBe('client-1');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.effectiveReceivable).toBe('40.00');
    // REQ-075: nothing is apurado before a report matches the policy.
    expect(line?.realReceivable).toBeNull();
  });

  it('survives a reopening of the database', async () => {
    await twoPolicies();

    await application.shutdown();
    application = open();

    const panel = await application.useCases.listCommissions.execute();
    expect(panel.map((line) => line.policyNumber).sort()).toEqual(['PRP-9001', 'PRP-9002']);
  });

  it('narrows to the divergences the Financeiro has to treat (FP-02 step 5)', async () => {
    const { first } = await twoPolicies();

    await application.useCases.reconcileCommissionReport.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'PRP-9001', proposalNumber: 'PRP-9001', producerCommission: '31.00' },
        { policyNumber: 'PRP-9002', proposalNumber: 'PRP-9002', producerCommission: '40.00' },
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
