import { describe, expect, it } from 'vitest';
import { InMemoryBrokerCommissionRateRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';
import { CalculateAgreedCommission } from './calculate-agreed-commission.ts';
import { CalculatePolicyCommission } from './calculate-policy-commission.ts';

/** The policy was registered on this day. */
const REGISTERED_AT = new Date('2026-09-20T10:00:00.000Z');

function scenario() {
  const policies = new InMemoryPolicyRepository();
  const proposals = new InMemoryProposalRepository();
  const commissions = new InMemoryCommissionRepository();
  const brokerRates = new InMemoryBrokerCommissionRateRepository();
  let sequence = 0;

  const agreedCommission = new CalculateAgreedCommission({
    proposals,
    commissions,
    brokerRates,
    newId: () => `commission-${++sequence}`,
  });

  return {
    policies,
    proposals,
    commissions,
    brokerRates,
    agreedCommission,
    useCase: new CalculatePolicyCommission({
      policies,
      proposals,
      commissions,
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
    proposalNumber: 'PRP-1',
    netPremium: Money.fromString('100.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [],
    workedCommission: Percentage.fromString('40'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'operator',
    registeredAt: new Date('2026-09-19T12:00:00.000Z'),
  });

  await proposals.save(
    proposal.recognizeIssuance(Authorship.of('operator', new Date('2026-09-20T10:00:00.000Z'))),
  );
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

async function registerBrokerRate(
  brokerRates: InMemoryBrokerCommissionRateRepository,
): Promise<void> {
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
    const { policies, proposals, commissions, brokerRates, useCase } = scenario();
    // The policy exists and the registries did not: FP-01 step 7 produced
    // nothing, which is the state this use case exists for.
    await registeredPolicy(proposals, policies);
    expect(await commissions.findByPolicyId('policy-1')).toBeNull();

    await registerBrokerRate(brokerRates);
    const calculated = await useCase.execute({ policyId: 'policy-1' });

    expect(calculated.policyId).toBe('policy-1');
    // REQ-236: CT 40% of 100.00 to the Usina; the broker table takes half of it.
    expect(calculated.agreedReceivable).toBe('40.00');
    expect(calculated.agreedPayable).toBe('20.00');
    expect(await commissions.findByPolicyId('policy-1')).not.toBeNull();
  });

  it('dates the calculation at the policy registration, like FP-01 would have', async () => {
    const { policies, proposals, brokerRates, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    await registerBrokerRate(brokerRates);

    const calculated = await useCase.execute({ policyId: 'policy-1' });

    expect(calculated.calculatedAt).toBe(REGISTERED_AT.toISOString());
  });

  it('names the broker table when that is what is missing (IN-05)', async () => {
    const { policies, proposals, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    try {
      await useCase.execute({ policyId: 'policy-1' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('IN-05');
      expect((error as BusinessRuleViolation).params).toMatchObject({ brokerId: 'broker-1' });
    }
  });

  it('refuses to recalculate a commission that exists (REQ-124, REJ-011)', async () => {
    const { policies, proposals, brokerRates, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies);
    await registerBrokerRate(brokerRates);
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
