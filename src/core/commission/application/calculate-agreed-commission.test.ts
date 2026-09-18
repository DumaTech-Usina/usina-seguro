import { describe, expect, it } from 'vitest';
import { InMemoryBrokerCommissionRateRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { InMemoryCommissionAgreementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-agreement-repository.ts';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';
import { CommissionAgreement } from '../domain/commission-agreement.ts';
import { CalculateAgreedCommission } from './calculate-agreed-commission.ts';

const REGISTERED_AT = new Date('2026-09-20T10:00:00.000Z');

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const commissions = new InMemoryCommissionRepository();
  const agreements = new InMemoryCommissionAgreementRepository();
  const brokerRates = new InMemoryBrokerCommissionRateRepository();
  let sequence = 0;

  const useCase = new CalculateAgreedCommission({
    proposals,
    commissions,
    agreements,
    brokerRates,
    newId: () => `commission-${++sequence}`,
  });

  return { proposals, commissions, agreements, brokerRates, useCase };
}

async function acceptedProposal(proposals: InMemoryProposalRepository): Promise<void> {
  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: Money.fromString('100.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }).transmit({
      proposalNumber: 'PRP-1',
      workedCommission: Percentage.fromString('40'),
      transmittedAt: new Date('2026-09-18T12:00:00.000Z'),
    }),
  );
}

async function agreement(
  agreements: InMemoryCommissionAgreementRepository,
  effectiveFrom: string,
  insurerRate: string,
): Promise<void> {
  await agreements.save(
    CommissionAgreement.register({
      id: `agreement-${effectiveFrom}`,
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: CalendarDate.fromString(effectiveFrom),
      insurerRate: Percentage.fromString(insurerRate),
      chain: { kind: 'DIRECT' },
      registeredAt: REGISTERED_AT,
    }),
  );
}

async function brokerRate(
  brokerRates: InMemoryBrokerCommissionRateRepository,
  rate: string,
): Promise<void> {
  await brokerRates.save(
    BrokerCommissionRate.register({
      brokerId: 'broker-1',
      rate: Percentage.fromString(rate),
      registeredAt: REGISTERED_AT,
    }),
  );
}

const request = {
  policyId: 'policy-1',
  proposalId: 'proposal-1',
  premium: Money.fromString('100.00'),
  calculatedAt: REGISTERED_AT,
};

describe('CalculateAgreedCommission', () => {
  it('records the agreed pair of the policy (FP-01 step 7, REQ-075)', async () => {
    const { proposals, commissions, agreements, brokerRates, useCase } = scenario();
    await acceptedProposal(proposals);
    await agreement(agreements, '2026-01-01', '40');
    await brokerRate(brokerRates, '50');

    await useCase.calculateFor(request);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.policyId).toBe('policy-1');
    expect(commission?.status).toBe('FORECAST');
    expect(commission?.agreedReceivable.toString()).toBe('40.00');
    expect(commission?.agreedPayable.toString()).toBe('20.00');
  });

  it('calculates on the policy premium, never on the proposal (REQ-051, REJ-001)', async () => {
    const { proposals, commissions, agreements, brokerRates, useCase } = scenario();
    await acceptedProposal(proposals);
    await agreement(agreements, '2026-01-01', '40');
    await brokerRate(brokerRates, '50');

    // The insurer effectuated a different amount from the proposed one
    // (REQ-002): the policy premium is what counts.
    await useCase.calculateFor({ ...request, premium: Money.fromString('200.00') });

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.basis.premium.toString()).toBe('200.00');
    expect(commission?.agreedReceivable.toString()).toBe('80.00');
  });

  it('uses the agreement in force on the day of the calculation (REQ-065)', async () => {
    const { proposals, commissions, agreements, brokerRates, useCase } = scenario();
    await acceptedProposal(proposals);
    await agreement(agreements, '2026-01-01', '40');
    await agreement(agreements, '2026-09-01', '30');
    // A validity that has not started yet must not be picked.
    await agreement(agreements, '2027-01-01', '20');
    await brokerRate(brokerRates, '50');

    await useCase.calculateFor(request);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.basis.insurerRate.toString()).toBe('30');
    expect(commission?.agreedReceivable.toString()).toBe('30.00');
  });

  it('copies the rates, so a later agreement cannot change it (CA-012, REJ-011)', async () => {
    const { proposals, commissions, agreements, brokerRates, useCase } = scenario();
    await acceptedProposal(proposals);
    await agreement(agreements, '2026-01-01', '40');
    await brokerRate(brokerRates, '50');

    await useCase.calculateFor(request);

    // The Administrator changes the agreement afterwards.
    await agreement(agreements, '2026-09-25', '10');

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.basis.insurerRate.toString()).toBe('40');
    expect(commission?.agreedReceivable.toString()).toBe('40.00');
  });

  it('calculates nothing when no agreement is in force', async () => {
    const { proposals, commissions, brokerRates, useCase } = scenario();
    await acceptedProposal(proposals);
    await brokerRate(brokerRates, '50');

    await useCase.calculateFor(request);

    expect(await commissions.findByPolicyId('policy-1')).toBeNull();
  });

  it('calculates nothing when the broker has no commission table (IN-05)', async () => {
    const { proposals, commissions, agreements, useCase } = scenario();
    await acceptedProposal(proposals);
    await agreement(agreements, '2026-01-01', '40');

    await useCase.calculateFor(request);

    expect(await commissions.findByPolicyId('policy-1')).toBeNull();
  });
});
