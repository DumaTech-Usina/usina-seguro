import { describe, expect, it } from 'vitest';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import type { Receipt } from '../../proposal/domain/receipt.ts';
import { CalculateAgreedCommission } from './calculate-agreed-commission.ts';

const REGISTERED_AT = new Date('2026-09-20T10:00:00.000Z');

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const commissions = new InMemoryCommissionRepository();
  let sequence = 0;

  const useCase = new CalculateAgreedCommission({
    proposals,
    commissions,
    newId: () => `commission-${++sequence}`,
  });

  return { proposals, commissions, useCase };
}

async function acceptedProposal(
  proposals: InMemoryProposalRepository,
  receipt: Receipt = { kind: 'DIRECT' },
): Promise<void> {
  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      proposalNumber: 'PRP-1',
      netPremium: Money.fromString('100.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [],
      workedCommission: Percentage.fromString('40'),
      workedCommissionMode: 'INTEGRAL',
      receipt,
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }),
  );
}

const request = {
  policyId: 'policy-1',
  proposalId: 'proposal-1',
  calculatedAt: REGISTERED_AT,
};

describe('CalculateAgreedCommission', () => {
  it('records the agreed value from the CT of the proposal (REQ-236, REQ-230)', async () => {
    const { proposals, commissions, useCase } = scenario();
    await acceptedProposal(proposals);

    await useCase.calculateFor(request);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.policyId).toBe('policy-1');
    expect(commission?.status).toBe('FORECAST');
    // 100.00 x CT 40% to the Usina.
    expect(commission?.agreedReceivable.toString()).toBe('40.00');
    expect(commission?.basis.insurerRate.toString()).toBe('40');
  });

  it('chains CT and CTU when the proposal declares an intermediary (REQ-236, REQ-231)', async () => {
    const { proposals, commissions, useCase } = scenario();
    await acceptedProposal(proposals, {
      kind: 'INTERMEDIARY',
      intermediaryId: 'mega',
      ctu: Percentage.fromString('50'),
    });

    await useCase.calculateFor(request);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.basis.intermediaryId).toBe('mega');
    expect(commission?.agreedReceivable.toString()).toBe('20.00');
  });
});
