import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import type {
  AgreedCommissionCalculator,
  AgreedCommissionRequest,
} from './agreed-commission-calculator.ts';
import { RegisterPolicy, type RegisterPolicyInput } from './register-policy.ts';

const NOW = new Date('2026-09-20T10:00:00.000Z');

/**
 * Stands in for the commission module (FP-01 step 7). The policy module is
 * tested against the port it declared, not against a real calculation: what
 * the agreed commission is worth is a rule of the other module.
 */
class RecordingCommissionCalculator implements AgreedCommissionCalculator {
  readonly requests: AgreedCommissionRequest[] = [];

  async calculateFor(request: AgreedCommissionRequest): Promise<void> {
    this.requests.push(request);
  }
}

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const agreedCommission = new RecordingCommissionCalculator();
  let sequence = 0;

  const useCase = new RegisterPolicy({
    proposals,
    policies,
    transaction: new ImmediateTransaction(),
    agreedCommission,
    newId: () => `id-${++sequence}`,
    now: () => NOW,
  });

  return { proposals, policies, agreedCommission, useCase };
}

function draft(): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    customerAccepted: true,
    netPremium: Money.fromString('1200.00'),
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
  });
}

function transmitted(): Proposal {
  return draft().transmit({
    proposalNumber: 'PRP-9001',
    workedCommission: Percentage.fromString('40'),
    transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
  });
}

function input(overrides: Partial<RegisterPolicyInput> = {}): RegisterPolicyInput {
  return {
    proposalId: 'proposal-1',
    policyNumber: 'APL-4711',
    premium: '1200.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    installments: [
      { number: 1, amount: '600.00', dueDate: '2026-10-10' },
      { number: 2, amount: '600.00', dueDate: '2026-11-10' },
    ],
    ...overrides,
  };
}

describe('RegisterPolicy', () => {
  it('registers the policy with its schedule and both numbers (REQ-048, REQ-050)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    const output = await useCase.execute(input());

    expect(output).toMatchObject({
      policyNumber: 'APL-4711',
      proposalId: 'proposal-1',
      proposalNumber: 'PRP-9001',
      status: 'ACTIVE',
      premium: '1200.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      registeredAt: NOW.toISOString(),
    });
    expect(output.installments).toEqual([
      {
        id: 'id-2',
        number: 1,
        amount: '600.00',
        dueDate: '2026-10-10',
        status: 'PENDING',
        // REQ-123: nobody has confirmed a receipt yet (IN-13).
        confirmedBy: null,
        confirmedAt: null,
      },
      {
        id: 'id-3',
        number: 2,
        amount: '600.00',
        dueDate: '2026-11-10',
        status: 'PENDING',
        confirmedBy: null,
        confirmedAt: null,
      },
    ]);
  });

  it('moves the proposal to ACCEPTED in the same operation (REQ-111)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(transmitted());

    const output = await useCase.execute(input());

    expect((await proposals.findById('proposal-1'))?.status).toBe('ACCEPTED');
    expect((await policies.findById(output.id))?.policyNumber).toBe('APL-4711');
  });

  it('keeps a policy number that differs from the proposal number (CA-008)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());

    const output = await useCase.execute(input({ policyNumber: 'APL-0001' }));

    expect(output.policyNumber).toBe('APL-0001');
    expect(output.proposalNumber).toBe('PRP-9001');
  });

  it('does not create a policy for a refused proposal (CA-006)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(transmitted().reject('perfil de risco'));

    try {
      await useCase.execute(input());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-047');
    }

    expect(await policies.findById('id-1')).toBeNull();
  });

  it('does not create a second policy for the same proposal (CA-007, REJ-005)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(transmitted());
    await useCase.execute(input());

    try {
      await useCase.execute(input({ policyNumber: 'APL-4712' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-049');
    }
  });

  it('does not register a policy number another policy already uses (REQ-082, CA-018)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(transmitted());
    await useCase.execute(input());

    // A second business, with its own proposal, reusing the same number: the
    // report line of FP-02 would no longer say which policy it belongs to.
    const second = Proposal.register({
      id: 'proposal-2',
      clientId: 'client-2',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      customerAccepted: true,
      netPremium: Money.fromString('900.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }).transmit({
      proposalNumber: 'PRP-9002',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
    });
    await proposals.save(second);

    await expect(
      useCase.execute(input({ proposalId: 'proposal-2', policyNumber: 'APL-4711' })),
    ).rejects.toThrow(BusinessRuleViolation);

    expect(await policies.findByProposalId('proposal-2')).toBeNull();
    // REQ-112: the refused registration leaves the proposal where it was.
    expect((await proposals.findById('proposal-2'))?.status).toBe('TRANSMITTED');
  });

  it('stores the policy number trimmed, so the conciliation key matches (REQ-082)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(transmitted());

    await useCase.execute(input({ policyNumber: '  APL-4711  ' }));

    expect(await policies.findByPolicyNumber('APL-4711')).not.toBeNull();
  });

  it('does not create a policy for a proposal that was never transmitted', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(draft());

    await expect(useCase.execute(input())).rejects.toThrow(BusinessRuleViolation);
    expect((await proposals.findById('proposal-1'))?.status).toBe('DRAFT');
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute(input({ proposalId: 'ghost' }))).rejects.toThrow(RecordNotFound);
  });

  it('leaves the proposal untouched when the policy data is invalid', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(transmitted());

    await expect(useCase.execute(input({ installments: [] }))).rejects.toThrow(
      BusinessRuleViolation,
    );

    expect((await proposals.findById('proposal-1'))?.status).toBe('TRANSMITTED');
    expect(await policies.findById('id-1')).toBeNull();
  });

  it('asks for the agreed commission once the policy is created (FP-01 step 7)', async () => {
    const { proposals, agreedCommission, useCase } = scenario();
    await proposals.save(transmitted());

    const policy = await useCase.execute(input());

    expect(agreedCommission.requests).toHaveLength(1);
    expect(agreedCommission.requests[0]).toEqual({
      policyId: policy.id,
      proposalId: 'proposal-1',
      // REQ-051: the policy premium is what the other module calculates on.
      premium: Money.fromString('1200.00'),
      calculatedAt: NOW,
    });
  });

  it('asks for nothing when the policy is refused (REQ-070, CA-009)', async () => {
    const { proposals, agreedCommission, useCase } = scenario();
    await proposals.save(transmitted());

    await expect(useCase.execute(input({ installments: [] }))).rejects.toThrow(
      BusinessRuleViolation,
    );

    expect(agreedCommission.requests).toEqual([]);
  });
});
