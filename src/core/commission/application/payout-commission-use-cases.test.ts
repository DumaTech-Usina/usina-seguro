import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryPayoutCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-payout-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { RegisterPolicy } from '../../policy/application/register-policy.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import type { Receipt } from '../../proposal/domain/receipt.ts';
import type { WorkedCommissionMode } from '../../proposal/domain/worked-commission.ts';
import { COMMISSION_MESSAGES } from '../domain/errors.ts';
import { DeclarePayoutEligibility } from './declare-payout-eligibility.ts';
import { GetPolicyPayout } from './get-policy-payout.ts';
import { InformPayoutRate } from './inform-payout-rate.ts';
import { ListEligiblePayouts } from './list-eligible-payouts.ts';
import { ListPoliciesWithoutPayoutRate } from './list-policies-without-payout-rate.ts';
import { RevisePayoutRate } from './revise-payout-rate.ts';

interface BusinessOptions {
  readonly proposalId: string;
  readonly proposalNumber?: string;
  readonly clientId?: string;
  readonly brokerId?: string;
  readonly netPremium?: string;
  readonly ct?: string;
  readonly mode?: WorkedCommissionMode;
  readonly receipt?: Receipt;
  readonly coverageEnd?: string;
}

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const payouts = new InMemoryPayoutCommissionRepository();
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

  const deps = { proposals, policies, payouts, newId, now };

  return {
    setClock: (iso: string) => {
      clock = new Date(iso);
    },
    /** FP-01 up to the policy: FP-02 step 1. Answers the policy id. */
    async policy(options: BusinessOptions): Promise<string> {
      await proposals.save(
        Proposal.register({
          id: options.proposalId,
          clientId: options.clientId ?? 'Ana Lima',
          brokerId: options.brokerId ?? 'Corretora Alfa',
          insurerId: 'ALLIANZ',
          productId: 'Auto',
          paymentMethodId: 'credit',
          proposalNumber: options.proposalNumber ?? `PRP-${options.proposalId}`,
          netPremium: Money.fromString(options.netPremium ?? '1000.00'),
          coverageStart: CalendarDate.fromString('2026-10-01'),
          coverageEnd: CalendarDate.fromString(options.coverageEnd ?? '2027-10-01'),
          // REQ-291, REQ-292: a parcelled CT has two CTs and at least two installments.
          installments:
            options.mode === 'PARCELLED'
              ? [
                  { amount: Money.fromString('500.00'), dueDate: null },
                  { amount: Money.fromString('500.00'), dueDate: null },
                ]
              : [],
          workedCommission: Percentage.fromString(options.ct ?? '30'),
          subsequentWorkedCommission:
            options.mode === 'PARCELLED' ? Percentage.fromString('10') : null,
          workedCommissionMode: options.mode ?? 'INTEGRAL',
          receipt: options.receipt ?? { kind: 'DIRECT' },
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
    inform: new InformPayoutRate(deps),
    revise: new RevisePayoutRate(deps),
    declareEligible: new DeclarePayoutEligibility(deps),
    get: new GetPolicyPayout(deps),
    listEligible: new ListEligiblePayouts(deps),
    listWithoutRate: new ListPoliciesWithoutPayoutRate(deps),
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

describe('the situation of a policy (REQ-273, REQ-285)', () => {
  it('is without CR once the policy exists, with the Usina value shown (CA-236)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const view = await s.get.execute(policyId);

    expect(view.situation).toBe('WITHOUT_CR');
    expect(view.usinaValue).toBe('300.00');
    expect(view.commission).toBeNull();
  });

  it('leaves a policy with parcelled CT out of the three situations (REQ-285, FA-214)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1', mode: 'PARCELLED' });

    const view = await s.get.execute(policyId);

    expect(view.situation).toBeNull();
    expect(view.workedCommissionMode).toBe('PARCELLED');
  });

  it('answers not found for a policy that does not exist (REJ-216)', async () => {
    const s = scenario();

    await expect(s.get.execute('ghost')).rejects.toThrow(RecordNotFound);
    await expect(
      s.inform.execute({ policyId: 'ghost', rate: '60', userId: 'ana' }),
    ).rejects.toThrow(RecordNotFound);
  });
});

describe('InformPayoutRate (REQ-270 to REQ-272, REQ-278)', () => {
  it('direct receipt: CR 60% over 300.00 -> 180.00 to pay, 120.00 stays (CA-225, CA-231)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const view = await s.inform.execute({ policyId, rate: '60', userId: 'ana' });

    expect(view.situation).toBe('CALCULATED');
    expect(view.commission).toMatchObject({
      status: 'CALCULATED',
      rate: '60',
      base: '300.00',
      payout: '180.00',
      retained: '120.00',
    });
  });

  it('through an intermediary: CT 20%, CTU 80%, CR 70% -> 112.00 and 48.00 (CA-226, FA-213)', async () => {
    const s = scenario();
    const policyId = await s.policy({
      proposalId: 'p1',
      ct: '20',
      receipt: { kind: 'INTERMEDIARY', intermediaryId: 'Mega', ctu: Percentage.fromString('80') },
    });

    const view = await s.inform.execute({ policyId, rate: '70', userId: 'ana' });

    expect(view.usinaValue).toBe('160.00');
    expect(view.commission?.payout).toBe('112.00');
    expect(view.commission?.retained).toBe('48.00');
  });

  it('records who informed it, when, and the calculation (REQ-279, CA-230)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    s.setClock('2026-10-05T09:00:00.000Z');

    const view = await s.inform.execute({ policyId, rate: '60', userId: '  ana  ' });

    expect(view.commission?.entries).toEqual([
      {
        rate: '60',
        previousRate: null,
        reason: null,
        base: '300.00',
        payout: '180.00',
        retained: '120.00',
        informedBy: 'ana',
        informedAt: '2026-10-05T09:00:00.000Z',
      },
    ]);
  });

  it('refuses a second CR on the same policy (REQ-271, REJ-217)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });

    const error = await rejection(s.inform.execute({ policyId, rate: '50', userId: 'ana' }));

    expect(error.rule).toBe('REQ-271');
    expect(error.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_ALREADY_INFORMED);
  });

  it('refuses a CR on a policy with parcelled CT (REQ-271, REJ-218)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1', mode: 'PARCELLED' });

    const error = await rejection(s.inform.execute({ policyId, rate: '60', userId: 'ana' }));

    expect(error.rule).toBe('REQ-271');
  });

  it('refuses a CR nobody signed (REQ-216, REJ-223)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const error = await rejection(s.inform.execute({ policyId, rate: '60', userId: ' ' }));

    expect(error.rule).toBe('REQ-216');
  });

  it('accepts a CR of zero informed deliberately (FA-211, CA-228)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const view = await s.inform.execute({ policyId, rate: '0', userId: 'ana' });

    expect(view.commission?.payout).toBe('0.00');
    expect(view.commission?.retained).toBe('300.00');
  });
});

describe('RevisePayoutRate (REQ-277, REQ-279)', () => {
  it('recalculates and keeps the audit of the change (FA-212, CA-230, CA-231)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });
    s.setClock('2026-10-06T10:00:00.000Z');

    const view = await s.revise.execute({
      policyId,
      rate: '50',
      reason: 'corretor renegociou',
      userId: 'bruno',
    });

    expect(view.commission?.payout).toBe('150.00');
    expect(view.commission?.retained).toBe('150.00');
    expect(view.commission?.entries[1]).toEqual({
      rate: '50',
      previousRate: '60',
      reason: 'corretor renegociou',
      base: '300.00',
      payout: '150.00',
      retained: '150.00',
      informedBy: 'bruno',
      informedAt: '2026-10-06T10:00:00.000Z',
    });
    // Nothing is recalculated in the earlier entry (REQ-279).
    expect(view.commission?.entries[0]?.payout).toBe('180.00');
  });

  it('refuses a change without a reason (EX-204, REJ-224)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });

    const error = await rejection(
      s.revise.execute({ policyId, rate: '50', reason: '', userId: 'bruno' }),
    );

    expect(error.rule).toBe('REQ-279');
  });

  it('refuses to change a CR that was never informed (REQ-273)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const error = await rejection(
      s.revise.execute({ policyId, rate: '50', reason: 'ajuste', userId: 'bruno' }),
    );

    expect(error.rule).toBe('REQ-273');
    expect(error.messageKey).toBe(COMMISSION_MESSAGES.PAYOUT_NOT_INFORMED);
  });
});

describe('DeclarePayoutEligibility (REQ-281 to REQ-283)', () => {
  it('signs the eligibility and generates the statement, nothing typed (CA-232, CA-233, CA-237)', async () => {
    const s = scenario();
    const policyId = await s.policy({
      proposalId: 'p1',
      proposalNumber: 'PRP-777',
      clientId: 'Ana Lima',
      brokerId: 'Corretora Alfa',
    });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });
    s.setClock('2026-11-02T15:30:00.000Z');

    const view = await s.declareEligible.execute({ policyId, userId: 'carla' });

    expect(view.situation).toBe('ELIGIBLE');
    expect(view.commission?.statement).toEqual({
      policyNumber: 'PRP-777',
      broker: 'Corretora Alfa',
      client: 'Ana Lima',
      netPremium: '1000.00',
      workedCommission: '30',
      payoutRate: '60',
      ctu: null,
      usinaValue: '300.00',
      eligibleAt: '2026-11-02T15:30:00.000Z',
      retained: '120.00',
      payout: '180.00',
      signedBy: 'carla',
    });
  });

  it('carries the CTU into the statement when there is an intermediary (REQ-283)', async () => {
    const s = scenario();
    const policyId = await s.policy({
      proposalId: 'p1',
      ct: '20',
      receipt: { kind: 'INTERMEDIARY', intermediaryId: 'Mega', ctu: Percentage.fromString('80') },
    });
    await s.inform.execute({ policyId, rate: '70', userId: 'ana' });

    const view = await s.declareEligible.execute({ policyId, userId: 'carla' });

    expect(view.commission?.statement?.ctu).toBe('80');
    expect(view.commission?.statement?.usinaValue).toBe('160.00');
  });

  it('refuses the eligibility of a policy without CR (EX-205, REJ-226)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });

    const error = await rejection(s.declareEligible.execute({ policyId, userId: 'carla' }));

    expect(error.rule).toBe('REQ-273');
  });

  it('refuses an eligibility nobody signed (REJ-227)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });

    const error = await rejection(s.declareEligible.execute({ policyId, userId: '' }));

    expect(error.rule).toBe('REQ-216');
  });

  it('is definitive: the CR no longer changes (EX-206, REJ-228)', async () => {
    const s = scenario();
    const policyId = await s.policy({ proposalId: 'p1' });
    await s.inform.execute({ policyId, rate: '60', userId: 'ana' });
    await s.declareEligible.execute({ policyId, userId: 'carla' });

    const revision = await rejection(
      s.revise.execute({ policyId, rate: '50', reason: 'ajuste', userId: 'bruno' }),
    );
    const again = await rejection(s.declareEligible.execute({ policyId, userId: 'carla' }));

    expect(revision.rule).toBe('REQ-282');
    expect(again.rule).toBe('REQ-282');
  });
});

describe('ListPoliciesWithoutPayoutRate (REQ-286)', () => {
  it('lists a policy without CR and drops it once the CR is informed (CA-238)', async () => {
    const s = scenario();
    const first = await s.policy({ proposalId: 'p1', proposalNumber: 'PRP-1' });
    await s.policy({ proposalId: 'p2', proposalNumber: 'PRP-2' });

    expect((await s.listWithoutRate.execute()).map((line) => line.policyNumber)).toEqual([
      'PRP-1',
      'PRP-2',
    ]);

    await s.inform.execute({ policyId: first, rate: '60', userId: 'ana' });

    const lines = await s.listWithoutRate.execute();
    expect(lines.map((line) => line.policyNumber)).toEqual(['PRP-2']);
    expect(lines[0]).toMatchObject({
      client: 'Ana Lima',
      broker: 'Corretora Alfa',
      usinaValue: '300.00',
      renewalDate: '2027-10-01',
    });
  });

  it('never lists a policy with parcelled CT (CA-240)', async () => {
    const s = scenario();
    await s.policy({ proposalId: 'p1', proposalNumber: 'PRP-PARC', mode: 'PARCELLED' });

    expect(await s.listWithoutRate.execute()).toEqual([]);
  });
});

describe('ListEligiblePayouts (REQ-284)', () => {
  /** Three eligible commissions and one still calculated. */
  async function eligibles() {
    const s = scenario();
    const make = async (
      id: string,
      options: Omit<BusinessOptions, 'proposalId'>,
      signedAt: string,
    ): Promise<string> => {
      const policyId = await s.policy({ proposalId: id, ...options });
      await s.inform.execute({ policyId, rate: '60', userId: 'ana' });
      s.setClock(signedAt);
      await s.declareEligible.execute({ policyId, userId: 'carla' });
      return policyId;
    };

    const a = await make(
      'a',
      {
        proposalNumber: 'APL-100',
        clientId: 'Ana Lima',
        brokerId: 'Corretora Alfa',
        coverageEnd: '2027-01-15',
      },
      '2026-11-02T15:00:00.000Z',
    );
    const b = await make(
      'b',
      {
        proposalNumber: 'APL-200',
        clientId: 'Bruno Souza',
        brokerId: 'Corretora Beta',
        coverageEnd: '2027-03-10',
      },
      '2026-11-10T15:00:00.000Z',
    );
    const c = await make(
      'c',
      {
        proposalNumber: 'XYZ-300',
        clientId: 'Ana Maria',
        brokerId: 'Corretora Alfa',
        coverageEnd: '2027-06-01',
      },
      '2026-12-01T15:00:00.000Z',
    );
    const pending = await s.policy({ proposalId: 'd', proposalNumber: 'APL-400' });
    await s.inform.execute({ policyId: pending, rate: '60', userId: 'ana' });

    return { s, a, b, c };
  }

  const numbers = (lines: readonly { policyNumber: string }[]) =>
    lines.map((line) => line.policyNumber);

  it('lists only eligible commissions, most recent eligibility first', async () => {
    const { s } = await eligibles();

    expect(numbers(await s.listEligible.execute({}))).toEqual(['XYZ-300', 'APL-200', 'APL-100']);
  });

  it('links each line to its policy (REQ-284, CA-235)', async () => {
    const { s, a } = await eligibles();

    const line = (await s.listEligible.execute({ policyNumber: 'APL-100' }))[0];

    expect(line?.policyId).toBe(a);
    expect(line?.payout).toBe('180.00');
    expect(line?.renewalDate).toBe('2027-01-15');
  });

  it('matches policy number, broker and client by part, ignoring case (CA-234)', async () => {
    const { s } = await eligibles();

    expect(numbers(await s.listEligible.execute({ policyNumber: 'apl' }))).toEqual([
      'APL-200',
      'APL-100',
    ]);
    expect(numbers(await s.listEligible.execute({ broker: 'ALFA' }))).toEqual([
      'XYZ-300',
      'APL-100',
    ]);
    expect(numbers(await s.listEligible.execute({ client: 'ana ' }))).toEqual([
      'XYZ-300',
      'APL-100',
    ]);
  });

  it('narrows by the eligibility period, both ends included (CA-234)', async () => {
    const { s } = await eligibles();

    // The page sends the start of the first day and the start of the day
    // after the last one, in the reader's time zone.
    const lines = await s.listEligible.execute({
      eligibleFrom: '2026-11-02T00:00:00.000Z',
      eligibleBefore: '2026-11-11T00:00:00.000Z',
    });

    expect(numbers(lines)).toEqual(['APL-200', 'APL-100']);
  });

  it('narrows by the renewal period in month/year, both ends included (CA-234)', async () => {
    const { s } = await eligibles();

    expect(
      numbers(await s.listEligible.execute({ renewalFrom: '2027-03', renewalUntil: '2027-06' })),
    ).toEqual(['XYZ-300', 'APL-200']);
    expect(numbers(await s.listEligible.execute({ renewalUntil: '2027-01' }))).toEqual(['APL-100']);
  });

  it('applies every filter informed together', async () => {
    const { s } = await eligibles();

    expect(
      numbers(await s.listEligible.execute({ broker: 'alfa', renewalFrom: '2027-02' })),
    ).toEqual(['XYZ-300']);
  });
});
