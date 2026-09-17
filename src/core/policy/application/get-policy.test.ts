import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { GetPolicy } from './get-policy.ts';
import { RegisterPolicy } from './register-policy.ts';

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  let sequence = 0;

  return {
    proposals,
    policies,
    registerPolicy: new RegisterPolicy({
      proposals,
      policies,
      transaction: new ImmediateTransaction(),
      newId: () => `id-${++sequence}`,
      now: () => new Date('2026-09-20T10:00:00.000Z'),
    }),
    getPolicy: new GetPolicy({ proposals, policies }),
  };
}

async function transmittedProposal(proposals: InMemoryProposalRepository): Promise<void> {
  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      customerAccepted: true,
      netPremium: Money.fromString('1200.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }).transmit({
      proposalNumber: 'PRP-9001',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: new Date('2026-09-18T09:00:00.000Z'),
    }),
  );
}

describe('GetPolicy', () => {
  it('returns both numbers and the schedule (CA-008, OUT-03)', async () => {
    const { proposals, registerPolicy, getPolicy } = scenario();
    await transmittedProposal(proposals);

    const registered = await registerPolicy.execute({
      proposalId: 'proposal-1',
      policyNumber: 'APL-4711',
      premium: '1200.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-09-30',
      renewalDate: '2027-09-30',
      installments: [{ number: 1, amount: '1200.00', dueDate: '2026-10-10' }],
    });

    const read = await getPolicy.execute(registered.id);

    expect(read).toEqual(registered);
    expect(read.policyNumber).toBe('APL-4711');
    expect(read.proposalNumber).toBe('PRP-9001');
    expect(read.installments).toHaveLength(1);
  });

  it('reports an unknown policy as not found', async () => {
    const { getPolicy } = scenario();

    await expect(getPolicy.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
