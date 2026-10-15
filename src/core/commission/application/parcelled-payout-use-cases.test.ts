import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryBrokerRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-repository.ts';
import { InMemoryClientRepository } from '../../../infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryParcelledPayoutRepository } from '../../../infrastructure/persistence/in-memory/in-memory-parcelled-payout-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { RegisterPolicy } from '../../policy/application/register-policy.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { DeclareInstallmentEligibility } from './declare-installment-eligibility.ts';
import { GetParcelledPayout } from './get-parcelled-payout.ts';
import { InformParcelledPayoutRates } from './inform-parcelled-payout-rates.ts';
import { ListParcelledPolicies } from './list-parcelled-policies.ts';
import { ReviseParcelledPayoutRates } from './revise-parcelled-payout-rates.ts';

interface BusinessOptions {
  readonly proposalId: string;
  readonly mode?: 'INTEGRAL' | 'PARCELLED';
  readonly coverageEnd?: string;
}

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const parcelledPayouts = new InMemoryParcelledPayoutRepository();
  let sequence = 0;
  let clock = new Date('2026-10-01T12:00:00.000Z');
  const newId = () => `id-${++sequence}`;
  const now = () => clock;

  const registerPolicy = new RegisterPolicy({
    proposals,
    policies,
    documents: new InMemoryDocumentStorage(),
    transaction: new ImmediateTransaction(),
    agreedCommission: { calculateFor: async () => {} },
    notifier: { notify: async () => {} },
    newId,
    now,
  });

  const brokers = new InMemoryBrokerRepository();
  const clients = new InMemoryClientRepository();
  const deps = { proposals, policies, parcelledPayouts, brokers, clients, newId, now };

  return {
    setClock: (iso: string) => {
      clock = new Date(iso);
    },
    /** FP-01 up to the policy. CT 100/30 on three installments of 100.00 (CA-246). */
    async policy(options: BusinessOptions): Promise<string> {
      const parcelled = (options.mode ?? 'PARCELLED') === 'PARCELLED';
      await proposals.save(
        Proposal.register({
          id: options.proposalId,
          clientId: 'Ana Lima',
          brokerId: 'Corretora Alfa',
          insurerId: 'ALLIANZ',
          productId: 'Auto',
          paymentMethodId: 'credit',
          proposalNumber: `PRP-${options.proposalId}`,
          netPremium: Money.fromString('300.00'),
          coverageStart: CalendarDate.fromString('2026-10-01'),
          coverageEnd: CalendarDate.fromString(options.coverageEnd ?? '2027-10-01'),
          installments: [
            { amount: Money.fromString('100.00'), dueDate: CalendarDate.fromString('2026-10-10') },
            { amount: Money.fromString('100.00'), dueDate: null },
            { amount: Money.fromString('100.00'), dueDate: null },
          ],
          workedCommission: Percentage.fromString(parcelled ? '100' : '30'),
          subsequentWorkedCommission: parcelled ? Percentage.fromString('30') : null,
          workedCommissionMode: parcelled ? 'PARCELLED' : 'INTEGRAL',
          receipt: { kind: 'DIRECT' },
          registeredBy: 'operator',
          registeredAt: new Date('2026-09-20T12:00:00.000Z'),
        }),
      );
      const policy = await registerPolicy.execute({
        proposalId: options.proposalId,
        userId: 'operator',
      });
      return policy.id;
    },
    get: new GetParcelledPayout(deps),
    inform: new InformParcelledPayoutRates(deps),
    revise: new ReviseParcelledPayoutRates(deps),
    declareEligible: new DeclareInstallmentEligibility(deps),
    list: new ListParcelledPolicies(deps),
  };
}

async function rejection(promise: Promise<unknown>): Promise<BusinessRuleViolation> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BusinessRuleViolation) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a BusinessRuleViolation.');
}

describe('GetParcelledPayout (REQ-268, REQ-293)', () => {
  it('shows each installment with its CT and Usina value, without CR yet (REQ-268, CA-265)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const view = await s.get.execute(policyId);

    expect(view.situation).toBe('WITHOUT_CR');
    expect(view.firstWorkedCommission).toBe('100');
    expect(view.subsequentWorkedCommission).toBe('30');
    expect(view.firstRate).toBeNull();
    expect(view.installments).toEqual([
      {
        number: 1,
        amount: '100.00',
        dueDate: '2026-10-10',
        workedCommission: '100',
        usinaValue: '100.00',
        payoutRate: null,
        payout: null,
        retained: null,
        statement: null,
      },
      expect.objectContaining({ number: 2, workedCommission: '30', usinaValue: '30.00' }),
      expect.objectContaining({ number: 3, dueDate: null }),
    ]);
  });

  it('refuses a policy with integral CT: its payout is the single CR (REQ-287)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1', mode: 'INTEGRAL' });

    expect((await rejection(s.get.execute(policyId))).rule).toBe('REQ-287');
  });

  it('reports an unknown policy as not found', async () => {
    await expect(scenario().get.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});

describe('InformParcelledPayoutRates (REQ-287, REQ-263, REQ-264)', () => {
  it('informs both CRs and shows the payout of each installment (CA-254, CA-263)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const view = await s.inform.execute({
      policyId,
      firstRate: '100',
      subsequentRate: '15',
      userId: 'ana',
    });

    expect(view.situation).toBe('NONE_ELIGIBLE');
    expect(view.firstRate).toBe('100');
    expect(view.subsequentRate).toBe('15');
    expect(view.installments.map((i) => [i.payoutRate, i.payout, i.retained])).toEqual([
      ['100', '100.00', '0.00'],
      ['15', '15.00', '15.00'],
      ['15', '15.00', '15.00'],
    ]);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      firstRate: '100',
      subsequentRate: '15',
      previousFirstRate: null,
      previousSubsequentRate: null,
      reason: null,
      informedBy: 'ana',
      informedAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('refuses a CR above its CT (REQ-263, EX-213)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const error = await rejection(
      s.inform.execute({ policyId, firstRate: '100', subsequentRate: '31', userId: 'ana' }),
    );

    expect(error.rule).toBe('REQ-263');
    expect((await s.get.execute(policyId)).situation).toBe('WITHOUT_CR');
  });

  it('refuses informing the CRs a second time: a change is a revision (REQ-265)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });

    const error = await rejection(
      s.inform.execute({ policyId, firstRate: '90', subsequentRate: '15', userId: 'ana' }),
    );

    expect(error.messageKey).toBe('commission.payout_already_informed');
  });

  it('refuses an unsigned information (REQ-216)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    expect(
      (
        await rejection(
          s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: ' ' }),
        )
      ).rule,
    ).toBe('REQ-216');
  });

  it('refuses the CRs of a parcelled payout on a policy with integral CT (REQ-287)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1', mode: 'INTEGRAL' });

    expect(
      (
        await rejection(
          s.inform.execute({ policyId, firstRate: '10', subsequentRate: '10', userId: 'ana' }),
        )
      ).rule,
    ).toBe('REQ-287');
  });
});

describe('ReviseParcelledPayoutRates (REQ-265, REQ-289)', () => {
  it('changes both CRs with a reason and shows both in the history (CA-255)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });
    s.setClock('2026-10-02T09:00:00.000Z');

    const view = await s.revise.execute({
      policyId,
      firstRate: '90',
      subsequentRate: '20',
      reason: 'acordo revisto',
      userId: 'bruno',
    });

    expect(view.entries[1]).toMatchObject({
      firstRate: '90',
      subsequentRate: '20',
      previousFirstRate: '100',
      previousSubsequentRate: '15',
      reason: 'acordo revisto',
      informedBy: 'bruno',
      informedAt: '2026-10-02T09:00:00.000Z',
    });
    // REQ-265, CA-266: the calculation of each installment, kept per entry.
    expect(view.entries[1]?.calculations.map((c) => c.payout)).toEqual(['90.00', '20.00', '20.00']);
    expect(view.entries[0]?.calculations.map((c) => c.payout)).toEqual([
      '100.00',
      '15.00',
      '15.00',
    ]);
  });

  it('refuses a revision of a policy without CR', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    expect(
      (
        await rejection(
          s.revise.execute({
            policyId,
            firstRate: '90',
            subsequentRate: '20',
            reason: 'motivo',
            userId: 'bruno',
          }),
        )
      ).messageKey,
    ).toBe('commission.payout_not_informed');
  });

  it('refuses a revision once an installment is eligible (REQ-289, CA-257)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });
    await s.declareEligible.execute({ policyId, number: 2, userId: 'carla' });

    expect(
      (
        await rejection(
          s.revise.execute({
            policyId,
            firstRate: '90',
            subsequentRate: '20',
            reason: 'motivo',
            userId: 'bruno',
          }),
        )
      ).rule,
    ).toBe('REQ-289');
  });
});

describe('DeclareInstallmentEligibility (REQ-288, REQ-266)', () => {
  it('signs the eligibility of one installment and generates its statement (CA-256, CA-258)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });
    s.setClock('2026-10-05T15:00:00.000Z');

    const view = await s.declareEligible.execute({ policyId, number: 2, userId: 'carla' });

    expect(view.situation).toBe('PARTIALLY_ELIGIBLE');
    expect(view.installments[1]?.statement).toEqual({
      policyNumber: 'PRP-p1',
      broker: 'Corretora Alfa',
      insurer: 'ALLIANZ',
      client: 'Ana Lima',
      installmentNumber: 2,
      installmentAmount: '100.00',
      workedCommission: '30',
      payoutRate: '15',
      retained: '15.00',
      payout: '15.00',
      eligibleAt: '2026-10-05T15:00:00.000Z',
      signedBy: 'carla',
    });
    expect(view.installments[0]?.statement).toBeNull();
  });

  it('refuses the eligibility of an installment without CR (REQ-288, EX-214, REJ-242)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const error = await rejection(
      s.declareEligible.execute({ policyId, number: 1, userId: 'carla' }),
    );

    expect(error.rule).toBe('REQ-288');
    expect(error.messageKey).toBe('commission.installment_eligibility_requires_rates');
  });

  it('accepts it with a CR zero informed: the statement shows CR 0 and nothing to pay (CA-264)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '0', subsequentRate: '0', userId: 'ana' });

    const view = await s.declareEligible.execute({ policyId, number: 1, userId: 'carla' });

    expect(view.installments[0]?.statement).toMatchObject({ payoutRate: '0', payout: '0.00' });
  });

  it('refuses an unsigned eligibility (REQ-216, REJ-238)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });

    expect(
      (await rejection(s.declareEligible.execute({ policyId, number: 1, userId: '' }))).rule,
    ).toBe('REQ-216');
  });

  it('becomes fully eligible when every installment is, in any order (CA-267, FA-222)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, firstRate: '100', subsequentRate: '15', userId: 'ana' });

    for (const number of [3, 1, 2]) {
      await s.declareEligible.execute({ policyId, number, userId: 'carla' });
    }

    expect((await s.get.execute(policyId)).situation).toBe('FULLY_ELIGIBLE');
  });
});

describe('ListParcelledPolicies (REQ-268)', () => {
  it('lists every parcelled policy with its situation, and no integral one (CA-265)', async () => {
    const s = scenario();
    const without = await s.policy({ proposalId: 'p1', coverageEnd: '2027-12-01' });
    const informed = await s.policy({ proposalId: 'p2', coverageEnd: '2027-11-01' });
    await s.policy({ proposalId: 'p3', mode: 'INTEGRAL' });
    await s.inform.execute({
      policyId: informed,
      firstRate: '100',
      subsequentRate: '15',
      userId: 'ana',
    });

    const lines = await s.list.execute();

    expect(lines).toEqual([
      {
        policyId: informed,
        policyNumber: 'PRP-p2',
        client: 'Ana Lima',
        broker: 'Corretora Alfa',
        renewalDate: '2027-11-01',
        situation: 'NONE_ELIGIBLE',
      },
      {
        policyId: without,
        policyNumber: 'PRP-p1',
        client: 'Ana Lima',
        broker: 'Corretora Alfa',
        renewalDate: '2027-12-01',
        situation: 'WITHOUT_CR',
      },
    ]);
  });
});
