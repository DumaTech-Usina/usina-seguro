import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';

/**
 * The financial life of a policy, against the real SQLite driver.
 *
 * A policy exists before its commission and before its transfer. Neither is a
 * precondition of it, and both can be created afterwards — in whatever order
 * the operation actually happens. What this file protects is that ordering:
 * the commission used to be reachable only as a side effect of registering
 * the policy, so a policy registered before the registries could never have
 * one, and there was nothing left to do with it.
 *
 * The other half of the file is the opposite guarantee: making the commission
 * reachable later must not make it reachable *twice*.
 */
let directory: string;
let file: string;
let application: Application;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-lifecycle-'));
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

/**
 * IN-05: half of what the Usina receives to the broker. The Usina side is the
 * CT of 40% the proposal carries (REQ-236).
 */
async function commissionRegistries(): Promise<void> {
  await application.useCases.registerBrokerCommissionRate.execute({
    brokerId: 'broker-1',
    rate: '50',
  });
}

/** IN-06, REQ-091: credit releases the transfer at once. */
async function releaseRule(paymentMethodId = 'credit'): Promise<void> {
  await application.useCases.registerPaymentMethodReleaseRule.execute({
    paymentMethodId,
    release: paymentMethodId === 'credit' ? 'IMMEDIATE' : 'REQUIRES_RECEIPT_CONFIRMATION',
  });
}

/** FP-01 up to the policy. Nothing financial is configured by this. */
async function registerPolicy(paymentMethodId = 'credit'): Promise<string> {
  const { useCases } = application;

  const proposal = await useCases.registerProposal.execute({
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId,
    customerAccepted: true,
    proposalNumber: 'PRP-1',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    // The policy inherits the schedule (REQ-241); REQ-091 needs a first one.
    installments: [{ amount: '100.00', dueDate: '2026-10-10' }],
    workedCommission: '40',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
  });

  const policy = await useCases.registerPolicy.execute({
    proposalId: proposal.id,
    userId: 'operator',
  });

  return policy.id;
}

/** FP-02 step 3: the report matched this policy, so a real value exists. */
async function reconcile(producerCommission = '40.00'): Promise<void> {
  await application.useCases.reconcileCommissionReport.execute({
    competence: '2026-10',
    lines: [{ policyNumber: 'PRP-1', proposalNumber: 'PRP-1', producerCommission }],
  });
}

async function commissionOf(policyId: string): Promise<unknown | null> {
  return application.useCases.getCommission.execute(policyId).catch(() => null);
}

async function settlementOf(policyId: string): Promise<unknown | null> {
  return application.useCases.getSettlement.execute(policyId).catch(() => null);
}

describe('the financial life of a policy', () => {
  it('A — builds the policy, then the commission, then the transfer', async () => {
    // Nothing is configured: the policy is registered all the same (REQ-002).
    const policyId = await registerPolicy();

    expect(await commissionOf(policyId)).toBeNull();
    expect(await settlementOf(policyId)).toBeNull();

    // The registries arrive late, which is the whole point of the scenario.
    await commissionRegistries();
    await releaseRule();

    const commission = await application.useCases.calculatePolicyCommission.execute({ policyId });
    expect(commission).toMatchObject({
      policyId,
      agreedReceivable: '40.00',
      agreedPayable: '20.00',
      status: 'FORECAST',
    });

    // FP-03 step 1 needs the real value apurada; that is its own rule.
    await reconcile();
    const settlement = await application.useCases.openSettlement.execute({ policyId });

    expect(settlement).toMatchObject({ policyId, brokerId: 'broker-1', amount: '20.00' });

    // Both live on the same policy, and the policy was never recreated.
    expect(await commissionOf(policyId)).not.toBeNull();
    expect(await settlementOf(policyId)).not.toBeNull();
    const policy = await application.useCases.getPolicy.execute(policyId);
    expect(policy.policyNumber).toBe('PRP-1');
  });

  it('B — the commission is created after other steps have happened', async () => {
    const policyId = await registerPolicy('bank-slip');
    await releaseRule('bank-slip');

    // The client pays the first installment before anybody notices the
    // commission is missing (REQ-092, IN-13).
    await application.useCases.payInstallment.execute({
      policyId,
      number: 1,
      userId: 'fin-1',
    });
    expect(await commissionOf(policyId)).toBeNull();

    await commissionRegistries();
    const commission = await application.useCases.calculatePolicyCommission.execute({ policyId });

    expect(commission.policyId).toBe(policyId);
    // The installment payment is untouched by the late calculation.
    const policy = await application.useCases.getPolicy.execute(policyId);
    expect(policy.installments[0]).toMatchObject({ status: 'PAID', confirmedBy: 'fin-1' });
  });

  it('C — the transfer is opened long after the commission exists', async () => {
    await commissionRegistries();
    const policyId = await registerPolicy();
    // The commission came with the policy this time (FP-01 step 7).
    expect(await commissionOf(policyId)).not.toBeNull();
    expect(await settlementOf(policyId)).toBeNull();

    await reconcile();
    // The release rule only shows up now, and the transfer waits for it.
    await expect(application.useCases.openSettlement.execute({ policyId })).rejects.toThrow(
      BusinessRuleViolation,
    );

    await releaseRule();
    const settlement = await application.useCases.openSettlement.execute({ policyId });

    expect(settlement).toMatchObject({ policyId, status: 'RELEASED', amount: '20.00' });
  });

  it('D — the same policy reaches the same place in a different order', async () => {
    // Registries first for one policy, registries last for the other: the
    // commission has to come out identical.
    await commissionRegistries();
    const early = await registerPolicy();
    const withRegistries = await application.useCases.getCommission.execute(early);

    await application.shutdown();
    directory = mkdtempSync(path.join(tmpdir(), 'usina-lifecycle-'));
    file = path.join(directory, 'usina.sqlite');
    application = open();

    const late = await registerPolicy();
    await commissionRegistries();
    const calculated = await application.useCases.calculatePolicyCommission.execute({
      policyId: late,
    });

    expect(calculated.agreedReceivable).toBe(withRegistries.agreedReceivable);
    expect(calculated.agreedPayable).toBe(withRegistries.agreedPayable);
    expect(calculated.basis).toEqual(withRegistries.basis);
  });

  it('E — nothing can be counted twice', async () => {
    await commissionRegistries();
    await releaseRule();
    const policyId = await registerPolicy();

    // REQ-124: the commission that exists is not calculated again.
    await expect(
      application.useCases.calculatePolicyCommission.execute({ policyId }),
    ).rejects.toThrow(BusinessRuleViolation);

    // REQ-086, EX-05: the same report again changes nothing.
    await reconcile();
    const afterFirst = await application.useCases.getCommission.execute(policyId);
    await reconcile();
    expect(await application.useCases.getCommission.execute(policyId)).toEqual(afterFirst);

    // REQ-094: one transfer per policy.
    await application.useCases.openSettlement.execute({ policyId });
    await expect(application.useCases.openSettlement.execute({ policyId })).rejects.toThrow(
      BusinessRuleViolation,
    );

    // REQ-095: a released transfer is paid once; the second is refused.
    const payment = {
      policyId,
      amount: '20.00',
      proof: {
        fileName: 'comprovante.pdf',
        contentType: 'application/pdf',
        content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      userId: 'fin-1',
    };
    await application.useCases.registerSettlementPayment.execute(payment);
    await expect(application.useCases.registerSettlementPayment.execute(payment)).rejects.toThrow(
      BusinessRuleViolation,
    );

    const statement = await application.useCases.listBrokerStatement.execute({
      brokerId: 'broker-1',
    });
    expect(statement.lines).toHaveLength(1);
    expect(statement.totals.paid).toBe('20.00');
  });

  it('keeps the late commission after a restart, bound to the same policy', async () => {
    const policyId = await registerPolicy();
    await commissionRegistries();
    const calculated = await application.useCases.calculatePolicyCommission.execute({ policyId });

    await application.shutdown();
    application = open();

    expect(await application.useCases.getCommission.execute(policyId)).toEqual(calculated);
  });
});
