import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';

/**
 * Application layer against the real SQLite driver: use cases, repositories and
 * the unit of work wired the way the process wires them.
 */
let directory: string;
let file: string;
let application: Application;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-flow-'));
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

async function registerProposal(): Promise<string> {
  const proposal = await application.useCases.registerProposal.execute({
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    proposalNumber: 'PRP-9001',
    netPremium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [],
    workedCommission: '32.5',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
  });
  return proposal.id;
}

async function registerPolicy(proposalId: string, policyNumber = 'APL-4711') {
  return application.useCases.registerPolicy.execute({
    proposalId,
    policyNumber,
    premium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [
      { number: 1, amount: '600.00', dueDate: '2026-10-10' },
      { number: 2, amount: '600.00', dueDate: '2026-11-10' },
    ],
  });
}

describe('proposal to policy flow on SQLite', () => {
  it('walks FP-01: register, transmit, register the policy with its schedule', async () => {
    const proposalId = await registerProposal();

    const policy = await registerPolicy(proposalId);

    expect(policy).toMatchObject({
      policyNumber: 'APL-4711',
      proposalNumber: 'PRP-9001',
      status: 'ACTIVE',
      premium: '1200.00',
    });
    expect(policy.installments).toHaveLength(2);
    expect(policy.installments[0]).toMatchObject({ number: 1, status: 'PENDING' });
  });

  it('survives a restart: the policy and its schedule are read back from disk', async () => {
    const proposalId = await registerProposal();
    const created = await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    const read = await application.useCases.getPolicy.execute(created.id);

    expect(read).toEqual(created);
  });

  it('refuses a second policy for the same proposal, also after a restart (CA-007)', async () => {
    const proposalId = await registerProposal();
    await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    await expect(registerPolicy(proposalId, 'APL-4712')).rejects.toThrow(BusinessRuleViolation);
  });

  it('refuses a policy for a refused proposal and keeps the record (CA-005, CA-006)', async () => {
    const proposalId = await registerProposal();
    await application.useCases.rejectProposal.execute({
      proposalId,
      reason: 'perfil de risco',
    });

    await expect(registerPolicy(proposalId)).rejects.toThrow(BusinessRuleViolation);

    const rejected = await application.useCases.rejectProposal
      .execute({ proposalId, reason: 'outro motivo' })
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(BusinessRuleViolation);
  });

  it('notifies the broker in the same unit of work (FP-01 step 7, REQ-100)', async () => {
    await application.useCases.registerReference.execute({
      kind: 'CLIENT',
      id: 'client-1',
      name: 'Maria Souza',
    });
    const proposalId = await registerProposal();

    const policy = await registerPolicy(proposalId);

    const [notified] = await application.useCases.listNotifications.execute({
      recipientId: 'broker-1',
    });
    expect(notified).toMatchObject({
      event: 'POLICY_ISSUED',
      policyId: policy.id,
      policyNumber: 'APL-4711',
      client: { id: 'client-1', name: 'Maria Souza' },
      // REQ-041: the percentage informed at transmission, with its scale.
      workedCommission: '32.5',
      netPremium: '1200.00',
    });
  });

  it('narrows the notifications to one broker, on the driver (OUT-10)', async () => {
    // Three emissions, two brokers. The filter is SQL, not a slice done after
    // reading: the in-memory driver answers the same shape in the unit suite.
    const emissions: readonly [string, string, string][] = [
      ['broker-1', 'PRP-N-1', 'APL-N-1'],
      ['broker-2', 'PRP-N-2', 'APL-N-2'],
      ['broker-1', 'PRP-N-3', 'APL-N-3'],
    ];

    for (const [brokerId, proposalNumber, policyNumber] of emissions) {
      const proposal = await application.useCases.registerProposal.execute({
        clientId: 'client-1',
        brokerId,
        insurerId: 'insurer-1',
        productId: 'auto',
        paymentMethodId: 'bank-slip',
        customerAccepted: true,
        proposalNumber,
        netPremium: '1200.00',
        coverageStart: '2026-10-01',
        coverageEnd: '2027-10-01',
        installments: [],
        workedCommission: '32.5',
        workedCommissionMode: 'INTEGRAL',
        intermediary: null,
        author: 'operator',
      });
      await registerPolicy(proposal.id, policyNumber);
    }

    const mine = await application.useCases.listNotifications.execute({
      recipientId: 'broker-1',
    });
    expect(mine.map((notification) => notification.policyNumber).sort()).toEqual([
      'APL-N-1',
      'APL-N-3',
    ]);

    // REQ-105: most recent first, as the contract of the repository promises.
    const every = await application.useCases.listNotifications.execute({});
    expect(every).toHaveLength(3);
    const instants = every.map((notification) => Date.parse(notification.occurredAt));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  it('keeps the notification readable after a restart (REQ-105)', async () => {
    const proposalId = await registerProposal();
    const policy = await registerPolicy(proposalId);
    const before = await application.useCases.listNotifications.execute({});
    await application.shutdown();

    application = open();
    const after = await application.useCases.listNotifications.execute({});

    expect(after).toEqual(before);
    expect(after[0]?.policyId).toBe(policy.id);
  });

  it('writes nothing when the policy data is invalid: the proposal stays open', async () => {
    const proposalId = await registerProposal();

    await expect(
      application.useCases.registerPolicy.execute({
        proposalId,
        policyNumber: 'APL-4711',
        premium: '1200.00',
        coverageStart: '2026-10-01',
        coverageEnd: '2027-09-30',
        renewalDate: '2027-09-30',
        installments: [{ number: 2, amount: '600.00', dueDate: '2026-10-10' }],
      }),
    ).rejects.toThrow(BusinessRuleViolation);

    // The proposal is still transmittable to a policy: nothing was accepted.
    const policy = await registerPolicy(proposalId);
    expect(policy.status).toBe('ACTIVE');

    // REQ-100 fires on the emission that happened, and only on it: the
    // refused attempt rolled back with the rest of the unit of work.
    const notified = await application.useCases.listNotifications.execute({});
    expect(notified).toHaveLength(1);
  });
});
