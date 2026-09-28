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
import { GetPolicyByProposal } from './get-policy-by-proposal.ts';
import { RegisterPolicy } from './register-policy.ts';

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  let sequence = 0;

  return {
    proposals,
    registerPolicy: new RegisterPolicy({
      proposals,
      policies,
      documents: new InMemoryDocumentStorage(),
      transaction: new ImmediateTransaction(),
      // FP-01 step 7 belongs to the commission and notification modules; this
      // test is about reaching the policy from the proposal.
      agreedCommission: { calculateFor: async () => {} },
      notifier: { notify: async () => {} },
      newId: () => `id-${++sequence}`,
      now: () => new Date('2026-09-20T10:00:00.000Z'),
    }),
    useCase: new GetPolicyByProposal({ proposals, policies }),
  };
}

async function transmittedProposal(proposals: InMemoryProposalRepository): Promise<void> {
  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-9001',
      netPremium: Money.fromString('1200.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [],
      workedCommission: Percentage.fromString('32.5'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }),
  );
}

describe('GetPolicyByProposal', () => {
  it('reaches the policy the proposal originated (REQ-050, FP-01 step 6)', async () => {
    const { proposals, registerPolicy, useCase } = scenario();
    await transmittedProposal(proposals);

    const registered = await registerPolicy.execute({
      proposalId: 'proposal-1',
      userId: 'operator',
    });

    await expect(useCase.execute('proposal-1')).resolves.toEqual(registered);
  });

  it('reports a proposal with no policy yet as not found', async () => {
    const { proposals, useCase } = scenario();
    await transmittedProposal(proposals);

    await expect(useCase.execute('proposal-1')).rejects.toThrow(RecordNotFound);
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
