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
    netPremium: '1200.00',
  });
  return proposal.id;
}

async function transmit(proposalId: string): Promise<void> {
  await application.useCases.transmitProposal.execute({
    proposalId,
    proposalNumber: 'PRP-9001',
    workedCommission: '32.5',
  });
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
    await transmit(proposalId);

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
    await transmit(proposalId);
    const created = await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    const read = await application.useCases.getPolicy.execute(created.id);

    expect(read).toEqual(created);
  });

  it('refuses a second policy for the same proposal, also after a restart (CA-007)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId);
    await registerPolicy(proposalId);
    await application.shutdown();

    application = open();
    await expect(registerPolicy(proposalId, 'APL-4712')).rejects.toThrow(BusinessRuleViolation);
  });

  it('refuses a policy for a refused proposal and keeps the record (CA-005, CA-006)', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId);
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

  it('writes nothing when the policy data is invalid: the proposal stays open', async () => {
    const proposalId = await registerProposal();
    await transmit(proposalId);

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
  });
});
