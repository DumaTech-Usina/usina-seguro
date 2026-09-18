import { describe, expect, it } from 'vitest';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPaymentMethodReleaseRuleRepository } from '../../../infrastructure/persistence/in-memory/in-memory-payment-method-release-rule-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemorySettlementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-settlement-repository.ts';
import type { CommissionBasis } from '../../commission/domain/commission-basis.ts';
import { Commission } from '../../commission/domain/commission.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import {
  PaymentMethodReleaseRule,
  type ReleaseRule,
} from '../domain/payment-method-release-rule.ts';
import { OpenSettlement } from './open-settlement.ts';
import { ReleaseSettlement } from './release-settlement.ts';

const NOW = new Date('2026-10-09T10:00:00.000Z');

const BASIS: CommissionBasis = {
  premium: Money.fromString('100.00'),
  insurerRate: Percentage.fromString('40'),
  insurerAmount: Money.fromString('40.00'),
  intermediaryId: null,
  intermediaryRate: null,
  brokerBase: 'USINA',
  brokerBaseAmount: Money.fromString('40.00'),
  brokerRate: Percentage.fromString('50'),
};

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const commissions = new InMemoryCommissionRepository();
  const releaseRules = new InMemoryPaymentMethodReleaseRuleRepository();
  const settlements = new InMemorySettlementRepository();

  return {
    proposals,
    policies,
    commissions,
    releaseRules,
    settlements,
    openSettlement: new OpenSettlement({
      proposals,
      policies,
      commissions,
      releaseRules,
      settlements,
      newId: () => 'settlement-1',
      now: () => NOW,
    }),
    releaseSettlement: new ReleaseSettlement({ policies, settlements, now: () => NOW }),
  };
}

interface SetupOptions {
  readonly paymentMethodId: string;
  readonly release: ReleaseRule | null;
  readonly reconciled: boolean;
  readonly firstInstallmentPaid?: boolean;
}

async function setup(world: ReturnType<typeof scenario>, options: SetupOptions): Promise<void> {
  await world.proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: options.paymentMethodId,
      customerAccepted: true,
      netPremium: Money.fromString('100.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    })
      .transmit({
        proposalNumber: 'PRP-1',
        workedCommission: Percentage.fromString('40'),
        transmittedAt: new Date('2026-09-18T12:00:00.000Z'),
      })
      .accept(),
  );

  let policy = Policy.register({
    id: 'policy-1',
    proposalId: 'proposal-1',
    policyNumber: 'APL-1',
    premium: Money.fromString('100.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-09-30'),
    renewalDate: CalendarDate.fromString('2027-09-30'),
    registeredAt: new Date('2026-09-20T10:00:00.000Z'),
    installments: [
      Installment.create({
        id: 'installment-1',
        policyId: 'policy-1',
        number: 1,
        amount: Money.fromString('50.00'),
        dueDate: CalendarDate.fromString('2026-10-10'),
      }),
      Installment.create({
        id: 'installment-2',
        policyId: 'policy-1',
        number: 2,
        amount: Money.fromString('50.00'),
        dueDate: CalendarDate.fromString('2026-11-10'),
      }),
    ],
  });

  if (options.firstInstallmentPaid === true) {
    policy = policy.payInstallment(1, { userId: 'financeiro-1', at: NOW });
  }

  await world.policies.save(policy);

  let commission = Commission.forecast({
    id: 'commission-1',
    policyId: 'policy-1',
    basis: BASIS,
    agreedReceivable: Money.fromString('40.00'),
    agreedPayable: Money.fromString('20.00'),
    calculatedAt: new Date('2026-09-20T10:00:00.000Z'),
  });

  if (options.reconciled) {
    commission = commission.reconcile('2026-10', Money.fromString('40.00'), NOW);
  }

  await world.commissions.save(commission);

  if (options.release !== null) {
    await world.releaseRules.save(
      PaymentMethodReleaseRule.register({
        paymentMethodId: options.paymentMethodId,
        release: options.release,
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
  }
}

describe('OpenSettlement', () => {
  it('releases at once for a method configured as immediate (REQ-091, CA-022)', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'credit', release: 'IMMEDIATE', reconciled: true });

    const settlement = await world.openSettlement.execute({ policyId: 'policy-1' });

    expect(settlement.status).toBe('RELEASED');
    expect(settlement.brokerId).toBe('broker-1');
    // REQ-093: the broker's table over the base, as the commission holds it.
    expect(settlement.amount).toBe('20.00');
  });

  it('holds a method that requires confirmation (REQ-091, CA-023, EX-07)', async () => {
    const world = scenario();
    await setup(world, {
      paymentMethodId: 'bank-slip',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
      reconciled: true,
    });

    const settlement = await world.openSettlement.execute({ policyId: 'policy-1' });

    expect(settlement.status).toBe('AWAITING_CONFIRMATION');
  });

  it('changing the configuration of a method changes the behaviour (CA-024, REQ-125)', async () => {
    const world = scenario();
    // Same payment method as the previous test, configured the other way.
    await setup(world, { paymentMethodId: 'bank-slip', release: 'IMMEDIATE', reconciled: true });

    const settlement = await world.openSettlement.execute({ policyId: 'policy-1' });

    expect(settlement.status).toBe('RELEASED');
  });

  it('uses the overridden payable when the policy has one (REQ-066, REQ-093)', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'credit', release: 'IMMEDIATE', reconciled: true });

    const commission = await world.commissions.findByPolicyId('policy-1');
    await world.commissions.save(
      // biome-ignore lint/style/noNonNullAssertion: set up two lines above.
      commission!.applyOverride({
        receivable: null,
        payable: Money.fromString('25.00'),
        justification: 'acordo extraordinario',
        userId: 'user-1',
        at: NOW,
      }),
    );

    const settlement = await world.openSettlement.execute({ policyId: 'policy-1' });

    expect(settlement.amount).toBe('25.00');
  });

  it('refuses before the real commission is apurada (FP-03 step 1)', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'credit', release: 'IMMEDIATE', reconciled: false });

    await expect(world.openSettlement.execute({ policyId: 'policy-1' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });

  it('refuses when the payment method has no release rule configured (REQ-090)', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'pix', release: null, reconciled: true });

    // DEC-002 has not decided the rule for Pix, and the system does not guess.
    await expect(world.openSettlement.execute({ policyId: 'policy-1' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });

  it('refuses a policy with no commission at all (REQ-070, REJ-002)', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'credit', release: 'IMMEDIATE', reconciled: true });

    // Same wiring, but nothing was ever calculated for this policy.
    const useCase = new OpenSettlement({
      proposals: world.proposals,
      policies: world.policies,
      commissions: new InMemoryCommissionRepository(),
      releaseRules: world.releaseRules,
      settlements: world.settlements,
      newId: () => 'settlement-1',
      now: () => NOW,
    });

    await expect(useCase.execute({ policyId: 'policy-1' })).rejects.toThrow(RecordNotFound);
  });

  it('refuses to open a second transfer for the same policy', async () => {
    const world = scenario();
    await setup(world, { paymentMethodId: 'credit', release: 'IMMEDIATE', reconciled: true });

    await world.openSettlement.execute({ policyId: 'policy-1' });

    await expect(world.openSettlement.execute({ policyId: 'policy-1' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });
});

describe('ReleaseSettlement', () => {
  it('refuses while the first installment is not confirmed (REJ-009, EX-07)', async () => {
    const world = scenario();
    await setup(world, {
      paymentMethodId: 'bank-slip',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
      reconciled: true,
    });
    await world.openSettlement.execute({ policyId: 'policy-1' });

    await expect(world.releaseSettlement.execute({ policyId: 'policy-1' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });

  it('releases once the first installment is confirmed paid (REQ-091, REQ-092)', async () => {
    const world = scenario();
    await setup(world, {
      paymentMethodId: 'bank-slip',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
      reconciled: true,
    });
    await world.openSettlement.execute({ policyId: 'policy-1' });

    const policy = await world.policies.findById('policy-1');
    // biome-ignore lint/style/noNonNullAssertion: set up above.
    await world.policies.save(policy!.payInstallment(1, { userId: 'financeiro-1', at: NOW }));

    const released = await world.releaseSettlement.execute({ policyId: 'policy-1' });

    expect(released.status).toBe('RELEASED');
    expect(released.releasedAt).toBe(NOW.toISOString());
  });

  it('does not release on a later installment alone (REQ-091)', async () => {
    const world = scenario();
    await setup(world, {
      paymentMethodId: 'bank-slip',
      release: 'REQUIRES_RECEIPT_CONFIRMATION',
      reconciled: true,
    });
    await world.openSettlement.execute({ policyId: 'policy-1' });

    const policy = await world.policies.findById('policy-1');
    // biome-ignore lint/style/noNonNullAssertion: set up above.
    await world.policies.save(policy!.payInstallment(2, { userId: 'financeiro-1', at: NOW }));

    await expect(world.releaseSettlement.execute({ policyId: 'policy-1' })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });
});
