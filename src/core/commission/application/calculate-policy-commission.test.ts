import { describe, expect, it } from 'vitest';
import { InMemoryBrokerCommissionRateRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { InMemoryCommissionAgreementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-agreement-repository.ts';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';
import { CommissionAgreement } from '../domain/commission-agreement.ts';
import { CalculateAgreedCommission } from './calculate-agreed-commission.ts';
import { CalculatePolicyCommission } from './calculate-policy-commission.ts';

/** The policy was registered on this day: it is what selects the agreement. */
const REGISTERED_AT = new Date('2026-09-20T10:00:00.000Z');

function scenario() {
  const policies = new InMemoryPolicyRepository();
  const proposals = new InMemoryProposalRepository();
  const commissions = new InMemoryCommissionRepository();
  const agreements = new InMemoryCommissionAgreementRepository();
  const brokerRates = new InMemoryBrokerCommissionRateRepository();
  let sequence = 0;

  const agreedCommission = new CalculateAgreedCommission({
    proposals,
    commissions,
    agreements,
    brokerRates,
    newId: () => `commission-${++sequence}`,
  });

  return {
    policies,
    proposals,
    commissions,
    agreements,
    brokerRates,
    agreedCommission,
    useCase: new CalculatePolicyCommission({
      policies,
      proposals,
      commissions,
      agreements,
      brokerRates,
      agreedCommission,
    }),
  };
}

/** FP-01 as far as the policy: proposal issued, policy registered. */
async function registeredPolicy(
  proposals: InMemoryProposalRepository,
  policies: InMemoryPolicyRepository,
): Promise<void> {
  const proposal = Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'credit',
    customerAccepted: true,
    netPremium: Money.fromString('100.00'),
    registeredAt: new Date('2026-09-19T12:00:00.000Z'),
  }).transmit({
    proposalNumber: 'PRP-1',
    workedCommission: Percentage.fromString('40'),
    transmittedAt: new Date('2026-09-19T13:00:00.000Z'),
  });

  await proposals.save(proposal.accept());
  await policies.save(
    Policy.register({
      id: 'policy-1',
      proposalId: 'proposal-1',
      policyNumber: 'APL-1',
      premium: Money.fromString('100.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-09-30'),
      renewalDate: CalendarDate.fromString('2027-09-30'),
      registeredAt: REGISTERED_AT,
      installments: [
        Installment.create({
          id: 'installment-1',
          policyId: 'policy-1',
          number: 1,
          amount: Money.fromString('100.00'),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
    }),
  );
}

async function registerRegistries(
  agreements: InMemoryCommissionAgreementRepository,
  brokerRates: InMemoryBrokerCommissionRateRepository,
  effectiveFrom = '2026-01-01',
): Promise<void> {
  await agreements.save(
    CommissionAgreement.register({
      id: 'agreement-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: CalendarDate.fromString(effectiveFrom),
      insurerRate: Percentage.fromString('40'),
      chain: { kind: 'DIRECT' },
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  );
  await brokerRates.save(
    BrokerCommissionRate.register({
      brokerId: 'broker-1',
      rate: Percentage.fromString('50'),
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  );
}

describe('CalculatePolicyCommission', () => {
  it('gives a commission to a policy registered without one (REQ-075)', async () => {
    const { policies, proposals, commissions, agreements, brokerRates, useCase } = scenario();
    // The policy exists and the registries did not: FP-01 step 7 produced
    // nothing, which is the state this use case exists for.
    await registeredPolicy(proposals, policies);
    expect(await commissions.findByPolicyId('policy-1')).toBeNull();

    await registerRegistries(agreements, brokerRates);
    const calculated = await useCase.execute({ policyId: 'policy-1' });

    expect(calculated.policyId).toBe('policy-1');
    // REQ-062, REQ-093: 40% of 100.00 to the Usina, half of it to the broker.
    expect(calculated.agreedReceivable).toBe('40.00');
    expect(calculated.agreedPayable).toBe('20.00');
    expect(await commissions.findByPolicyId('policy-1')).not.toBeNull();
  });

  it('produces exactly what the registration would have produced (REQ-065)', async () => {
    const { policies, proposals, agreements, brokerRates, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    await registerRegistries(agreements, brokerRates);

    const calculated = await useCase.execute({ policyId: 'policy-1' });

    // The date that selects the agreement is the policy's, not the clock's:
    // calculating late must not silently change the rates.
    expect(calculated.calculatedAt).toBe(REGISTERED_AT.toISOString());
  });

  it('refuses when the agreement does not reach the policy (REQ-065)', async () => {
    const { policies, proposals, agreements, brokerRates, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    // Registered today, valid from today: it does not cover a policy from
    // before. The operator has to backdate the validity, and the refusal says
    // which day it has to reach.
    await registerRegistries(agreements, brokerRates, '2026-09-25');

    try {
      await useCase.execute({ policyId: 'policy-1' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-065');
      expect((error as BusinessRuleViolation).params).toMatchObject({
        insurerId: 'insurer-1',
        productId: 'auto',
        on: '2026-09-20',
      });
    }
  });

  it('names the broker table when that is what is missing (IN-05)', async () => {
    const { policies, proposals, agreements, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    await agreements.save(
      CommissionAgreement.register({
        id: 'agreement-1',
        insurerId: 'insurer-1',
        productId: 'auto',
        effectiveFrom: CalendarDate.fromString('2026-01-01'),
        insurerRate: Percentage.fromString('40'),
        chain: { kind: 'DIRECT' },
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    try {
      await useCase.execute({ policyId: 'policy-1' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('IN-05');
      expect((error as BusinessRuleViolation).params).toMatchObject({ brokerId: 'broker-1' });
    }
  });

  it('refuses to recalculate a commission that exists (REQ-124, REJ-011)', async () => {
    const { policies, proposals, agreements, brokerRates, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    await registerRegistries(agreements, brokerRates);
    const first = await useCase.execute({ policyId: 'policy-1' });

    try {
      await useCase.execute({ policyId: 'policy-1' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-124');
    }

    // And nothing was written a second time: one commission, the first one.
    expect(await commissions.list({})).toHaveLength(1);
    expect((await commissions.findByPolicyId('policy-1'))?.id).toBe(first.id);
  });

  it('does not reach a policy that does not exist (REQ-070, CA-009)', async () => {
    const { useCase, commissions } = scenario();

    await expect(useCase.execute({ policyId: 'ghost' })).rejects.toThrow(RecordNotFound);
    expect(await commissions.list({})).toEqual([]);
  });

  it('writes nothing when it refuses', async () => {
    const { policies, proposals, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies);

    await expect(useCase.execute({ policyId: 'policy-1' })).rejects.toThrow(BusinessRuleViolation);

    expect(await commissions.list({})).toEqual([]);
  });
});
