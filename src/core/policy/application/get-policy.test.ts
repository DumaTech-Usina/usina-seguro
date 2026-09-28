import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
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
      documents: new InMemoryDocumentStorage(),
      transaction: new ImmediateTransaction(),
      // FP-01 step 7 belongs to the commission and notification modules; this
      // test is about reading a policy back.
      agreedCommission: { calculateFor: async () => {} },
      notifier: { notify: async () => {} },
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
      proposalNumber: 'PRP-9001',
      netPremium: Money.fromString('1200.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [],
      workedCommission: Percentage.fromString('40'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }),
  );
}

describe('GetPolicy', () => {
  it('returns both numbers and the schedule (REQ-050, REQ-241, OUT-03)', async () => {
    const { proposals, registerPolicy, getPolicy } = scenario();
    await transmittedProposal(proposals);

    const registered = await registerPolicy.execute({
      proposalId: 'proposal-1',
      userId: 'operator',
    });

    const read = await getPolicy.execute(registered.id);

    expect(read).toEqual(registered);
    expect(read.policyNumber).toBe('PRP-9001');
    expect(read.proposalNumber).toBe('PRP-9001');
    // REQ-241: the schedule is the proposal's, which has none here.
    expect(read.installments).toEqual([]);
  });

  it('reports an unknown policy as not found', async () => {
    const { getPolicy } = scenario();

    await expect(getPolicy.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
