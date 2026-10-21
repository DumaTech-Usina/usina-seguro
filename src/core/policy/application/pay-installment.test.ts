import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal, type ProposalRegistration } from '../../proposal/domain/proposal.ts';
import { PayInstallment } from './pay-installment.ts';
import { RegisterPolicy } from './register-policy.ts';

const NOW = new Date('2026-09-20T10:00:00.000Z');

async function issuedPolicy(overrides: Partial<ProposalRegistration> = {}) {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  let sequence = 0;

  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-9001',
      netPremium: Money.fromString('200.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [
        { amount: Money.fromString('100.00'), dueDate: null },
        { amount: Money.fromString('100.00'), dueDate: null },
      ],
      workedCommission: Percentage.fromString('20'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
      ...overrides,
    }),
  );

  const policy = await new RegisterPolicy({
    proposals,
    policies,
    documents: new InMemoryDocumentStorage(),
    transaction: new ImmediateTransaction(),
    agreedCommission: { calculateFor: async () => {} },
    notifier: { notify: async () => {} },
    newId: () => `id-${++sequence}`,
    now: () => NOW,
  }).execute({
    proposalId: 'proposal-1',
    userId: 'carla',
    policyNumber: 'APL-1',
    document: { fileName: 'apolice.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  });

  return {
    policyId: policy.id,
    policies,
    useCase: new PayInstallment({ proposals, policies, now: () => NOW }),
  };
}

describe('PayInstallment (REQ-269)', () => {
  it('keeps the confirmation of payment on a policy with integral CT, as it is (REQ-269, CA-260)', async () => {
    const { policyId, useCase } = await issuedPolicy();

    const view = await useCase.execute({ policyId, number: 1, userId: 'bruno' });

    expect(view.installments[0]?.status).toBe('PAID');
  });

  it('refuses it on a policy with parcelled CT: there the act is the eligibility (REQ-269)', async () => {
    const { policyId, policies, useCase } = await issuedPolicy({
      workedCommission: Percentage.fromString('100'),
      subsequentWorkedCommission: Percentage.fromString('30'),
      workedCommissionMode: 'PARCELLED',
    });

    try {
      await useCase.execute({ policyId, number: 1, userId: 'bruno' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolation);
      expect((error as BusinessRuleViolation).rule).toBe('REQ-269');
      expect((error as BusinessRuleViolation).messageKey).toBe(
        'policy.parcelled_installment_has_no_payment_confirmation',
      );
    }

    expect((await policies.findById(policyId))?.installments[0]?.status).toBe('PENDING');
  });
});
