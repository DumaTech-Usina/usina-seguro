import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';
import { cpfOf } from '../support/cpf.ts';

/**
 * Application layer against the real SQLite driver: use cases, repositories and
 * the unit of work wired the way the process wires them.
 */
let directory: string;
let file: string;
let application: Application;
/** REQ-307: the registered brokers the proposals name, by the label each test uses. */
let brokers: Record<'broker-1' | 'broker-2', string>;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-flow-'));
  file = path.join(directory, 'usina.sqlite');
  application = open();
  const register = (name: string, seed: number) =>
    application.useCases.registerBroker.execute({ name, cpf: cpfOf(seed), userId: 'operator' });
  brokers = {
    'broker-1': (await register('Corretora Alfa', 1)).id,
    'broker-2': (await register('Corretora Beta', 2)).id,
  };
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function open(): Application {
  return composeApplication(loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }));
}

async function registerProposal(proposalNumber = 'PRP-9001'): Promise<string> {
  const proposal = await application.useCases.registerProposal.execute({
    clientId: 'client-1',
    brokerId: brokers['broker-1'],
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber,
    netPremium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [
      { amount: '600.00', dueDate: '2026-10-10' },
      { amount: '600.00', dueDate: null },
    ],
    workedCommission: '32.5',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
  });
  return proposal.id;
}

/** REQ-209: the recognition of issuance, which creates the policy (REQ-240). */
async function registerPolicy(proposalId: string, userId = 'carla.dias') {
  return application.useCases.registerPolicy.execute({ proposalId, userId });
}

describe('proposal to policy flow on SQLite', () => {
  it('walks FP-01: register the proposal, recognise the issuance, get the policy it inherits', async () => {
    const proposalId = await registerProposal();

    const policy = await registerPolicy(proposalId);

    expect(policy).toMatchObject({
      policyNumber: 'PRP-9001',
      proposalNumber: 'PRP-9001',
      status: 'ACTIVE',
      premium: '1200.00',
      renewalDate: '2027-10-01',
    });
    expect(policy.installments).toHaveLength(2);
    expect(policy.installments[0]).toMatchObject({ number: 1, status: 'PENDING' });
    expect(policy.installments[1]).toMatchObject({ number: 2, dueDate: null });
  });

  it('keeps who recognised the issuance and when across a restart (REQ-209, CA-207)', async () => {
    const proposalId = await registerProposal();
    const policy = await registerPolicy(proposalId, 'carla.dias');
    await application.shutdown();

    application = open();
    const proposal = await application.useCases.getProposal.execute(proposalId);

    expect(proposal.status).toBe('ISSUED');
    expect(proposal.issuanceRecognizedBy).toBe('carla.dias');
    expect(proposal.issuanceRecognizedAt).toBe(policy.registeredAt);
  });

  it('survives a restart: the policy and its schedule are read back from disk', async () => {
    const proposalId = await registerProposal();
    const created = await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    const read = await application.useCases.getPolicy.execute(created.id);

    expect(read).toEqual(created);
  });

  it('refuses a second policy for the same proposal, also after a restart (REQ-049)', async () => {
    const proposalId = await registerProposal();
    await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    await expect(registerPolicy(proposalId)).rejects.toThrow(BusinessRuleViolation);
  });

  it('creates two policies with the same number on disk (DEC-207)', async () => {
    const first = await registerPolicy(await registerProposal('PRP-SAME'));
    const second = await registerPolicy(await registerProposal('PRP-SAME'));

    expect(second.policyNumber).toBe(first.policyNumber);
    expect(second.id).not.toBe(first.id);
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
      recipientId: brokers['broker-1'],
    });
    expect(notified).toMatchObject({
      event: 'POLICY_ISSUED',
      policyId: policy.id,
      policyNumber: 'PRP-9001',
      client: { id: 'client-1', name: 'Maria Souza' },
      // REQ-212: the CT informed on the proposal, with its scale (REQ-121).
      workedCommission: '32.5',
      netPremium: '1200.00',
    });
  });

  it('narrows the notifications to one broker, on the driver (OUT-10)', async () => {
    // Three emissions, two brokers. The filter is SQL, not a slice done after
    // reading: the in-memory driver answers the same shape in the unit suite.
    const emissions: readonly ['broker-1' | 'broker-2', string][] = [
      ['broker-1', 'PRP-N-1'],
      ['broker-2', 'PRP-N-2'],
      ['broker-1', 'PRP-N-3'],
    ];

    for (const [broker, proposalNumber] of emissions) {
      const proposal = await application.useCases.registerProposal.execute({
        clientId: 'client-1',
        brokerId: brokers[broker],
        insurerId: 'insurer-1',
        productId: 'auto',
        paymentMethodId: 'bank-slip',
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
      await registerPolicy(proposal.id);
    }

    const mine = await application.useCases.listNotifications.execute({
      recipientId: brokers['broker-1'],
    });
    expect(mine.map((notification) => notification.policyNumber).sort()).toEqual([
      'PRP-N-1',
      'PRP-N-3',
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

  it('writes nothing when the recognition is unsigned: the proposal stays open (REJ-205)', async () => {
    const proposalId = await registerProposal();

    await expect(registerPolicy(proposalId, '  ')).rejects.toThrow(BusinessRuleViolation);

    // The proposal can still be recognised: nothing was written.
    const policy = await registerPolicy(proposalId);
    expect(policy.status).toBe('ACTIVE');

    // REQ-100 fires on the emission that happened, and only on it.
    const notified = await application.useCases.listNotifications.execute({});
    expect(notified).toHaveLength(1);
  });
});
