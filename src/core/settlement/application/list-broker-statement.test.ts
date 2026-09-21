import { describe, expect, it } from 'vitest';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemorySettlementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-settlement-repository.ts';
import type { CommissionBasis } from '../../commission/domain/commission-basis.ts';
import { Commission } from '../../commission/domain/commission.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Settlement } from '../domain/settlement.ts';
import { ListBrokerStatement } from './list-broker-statement.ts';

const NOW = new Date('2026-11-01T10:00:00.000Z');

/** Direct chain of REQ-068: 40% of the premium in, half of that out. */
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

type Stage = 'FORECAST' | 'RECONCILED' | 'DIVERGENT';

interface BusinessOptions {
  readonly suffix: string;
  readonly brokerId: string;
  readonly calculatedAt: string;
  readonly stage: Stage;
  /** FP-03: where the transfer of this policy is, or nothing if never opened. */
  readonly transfer?: 'AWAITING_CONFIRMATION' | 'RELEASED' | 'PAID';
  readonly paidAmount?: string;
}

function world() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const commissions = new InMemoryCommissionRepository();
  const settlements = new InMemorySettlementRepository();

  return {
    proposals,
    policies,
    commissions,
    settlements,
    useCase: new ListBrokerStatement({ commissions, policies, proposals, settlements }),
  };
}

async function business(
  repositories: ReturnType<typeof world>,
  options: BusinessOptions,
): Promise<void> {
  const { suffix, brokerId, calculatedAt, stage, transfer } = options;

  await repositories.proposals.save(
    Proposal.register({
      id: `proposal-${suffix}`,
      clientId: `client-${suffix}`,
      brokerId,
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: Money.fromString('100.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }).transmit({
      proposalNumber: `PRP-${suffix}`,
      workedCommission: Percentage.fromString('40'),
      transmittedAt: new Date('2026-09-18T12:00:00.000Z'),
    }),
  );

  await repositories.policies.save(
    Policy.register({
      id: `policy-${suffix}`,
      proposalId: `proposal-${suffix}`,
      policyNumber: `APL-${suffix}`,
      premium: Money.fromString('100.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-09-30'),
      renewalDate: CalendarDate.fromString('2027-09-30'),
      registeredAt: new Date(calculatedAt),
      installments: [
        Installment.create({
          id: `installment-${suffix}`,
          policyId: `policy-${suffix}`,
          number: 1,
          amount: Money.fromString('100.00'),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
    }),
  );

  let commission = Commission.forecast({
    id: `commission-${suffix}`,
    policyId: `policy-${suffix}`,
    basis: BASIS,
    agreedReceivable: Money.fromString('40.00'),
    agreedPayable: Money.fromString('20.00'),
    calculatedAt: new Date(calculatedAt),
  });

  if (stage === 'RECONCILED') {
    commission = commission.reconcile('2026-10', Money.fromString('40.00'), NOW);
  }

  if (stage === 'DIVERGENT') {
    commission = commission.reconcile('2026-10', Money.fromString('31.00'), NOW);
  }

  await repositories.commissions.save(commission);

  if (transfer === undefined) {
    return;
  }

  let settlement = Settlement.open(
    {
      id: `settlement-${suffix}`,
      policyId: `policy-${suffix}`,
      brokerId,
      amount: commission.effectivePayable,
      // A method that waits is what makes EX-07 visible on the statement.
      releaseRule:
        transfer === 'AWAITING_CONFIRMATION' ? 'REQUIRES_RECEIPT_CONFIRMATION' : 'IMMEDIATE',
      openedAt: NOW,
    },
    false,
  );

  if (transfer === 'PAID') {
    settlement = settlement.registerPayment({
      paidAt: NOW,
      // REQ-095: what was actually sent, which the statement adds up as such.
      amount: Money.fromString(options.paidAmount ?? '20.00'),
      proofReference: `comprovante-${suffix}`,
      userId: 'financeiro-1',
    });
  }

  await repositories.settlements.save(settlement);
}

/**
 * Four businesses of `broker-1`, one in each situation OUT-07 names, plus one
 * of another broker so the filter has something to leave out.
 */
async function scenario() {
  const repositories = world();

  await business(repositories, {
    suffix: 'PREV',
    brokerId: 'broker-1',
    calculatedAt: '2026-09-15T12:00:00.000Z',
    stage: 'FORECAST',
  });
  await business(repositories, {
    suffix: 'RETIDO',
    brokerId: 'broker-1',
    calculatedAt: '2026-09-16T12:00:00.000Z',
    stage: 'RECONCILED',
    transfer: 'AWAITING_CONFIRMATION',
  });
  await business(repositories, {
    suffix: 'LIBER',
    brokerId: 'broker-1',
    calculatedAt: '2026-09-17T12:00:00.000Z',
    stage: 'DIVERGENT',
    transfer: 'RELEASED',
  });
  await business(repositories, {
    suffix: 'PAGO',
    brokerId: 'broker-1',
    calculatedAt: '2026-09-18T12:00:00.000Z',
    stage: 'RECONCILED',
    transfer: 'PAID',
    paidAmount: '19.50',
  });
  await business(repositories, {
    suffix: 'OUTRO',
    brokerId: 'broker-2',
    calculatedAt: '2026-09-19T12:00:00.000Z',
    stage: 'RECONCILED',
    transfer: 'RELEASED',
  });

  return repositories;
}

describe('ListBrokerStatement', () => {
  it('lists what the Usina owes one broker, in every situation (OUT-07)', async () => {
    const { useCase } = await scenario();

    const statement = await useCase.execute({ brokerId: 'broker-1' });

    expect(statement.brokerId).toBe('broker-1');
    // Newest calculation first, and the other broker is not here.
    expect(statement.lines.map((line) => line.policyNumber)).toEqual([
      'APL-PAGO',
      'APL-LIBER',
      'APL-RETIDO',
      'APL-PREV',
    ]);

    const byNumber = new Map(statement.lines.map((line) => [line.policyNumber, line]));

    // The *prevista* of OUT-07: the commission exists, the transfer does not.
    expect(byNumber.get('APL-PREV')?.settlement).toBeNull();
    expect(byNumber.get('APL-PREV')?.commissionStatus).toBe('FORECAST');
    // REQ-093: what the Usina expects to pay is on every line.
    expect(byNumber.get('APL-PREV')?.payable).toBe('20.00');

    // EX-07: held until the client's first installment is confirmed.
    expect(byNumber.get('APL-RETIDO')?.settlement?.status).toBe('AWAITING_CONFIRMATION');
    expect(byNumber.get('APL-LIBER')?.settlement?.status).toBe('RELEASED');
    // REQ-077: a divergence on the receivable side does not stop the transfer,
    // and the statement says both things at once.
    expect(byNumber.get('APL-LIBER')?.divergent).toBe(true);
    expect(byNumber.get('APL-LIBER')?.commissionStatus).toBe('DIVERGENT');

    // REQ-095: the payment carries what was sent, with its proof and user.
    const paid = byNumber.get('APL-PAGO');
    expect(paid?.settlement?.status).toBe('PAID');
    expect(paid?.settlement?.payment?.amount).toBe('19.50');
    expect(paid?.settlement?.payment?.proofReference).toBe('comprovante-PAGO');
    expect(paid?.settlement?.payment?.userId).toBe('financeiro-1');
  });

  it('identifies each line by the records that hold a readable reference', async () => {
    const { useCase } = await scenario();

    const [line] = (await useCase.execute({ brokerId: 'broker-1' })).lines;

    // REQ-050, REQ-022. The registries of IN-01 are not modelled, so the
    // references travel as stored — there is no name nor ramo to resolve.
    expect(line?.policyNumber).toBe('APL-PAGO');
    expect(line?.proposalNumber).toBe('PRP-PAGO');
    expect(line?.clientId).toBe('client-PAGO');
    expect(line?.productId).toBe('auto');
    expect(line?.brokerId).toBe('broker-1');
  });

  it('adds the statement up on exact cents (REQ-120)', async () => {
    const { useCase } = await scenario();

    const { totals } = await useCase.execute({ brokerId: 'broker-1' });

    // REQ-093 over the four lines: 4 x 20.00.
    expect(totals.payable).toBe('80.00');
    expect(totals.awaitingConfirmation).toBe('20.00');
    expect(totals.released).toBe('20.00');
    // REQ-095: what was sent, not what was expected.
    expect(totals.paid).toBe('19.50');
  });

  it('covers every broker when none is asked for', async () => {
    const { useCase } = await scenario();

    const statement = await useCase.execute();

    expect(statement.brokerId).toBeNull();
    expect(statement.lines).toHaveLength(5);
    expect(statement.lines.map((line) => line.brokerId)).toContain('broker-2');
    // The other broker's released transfer is in the total now.
    expect(statement.totals.released).toBe('40.00');
    expect(statement.totals.payable).toBe('100.00');
  });

  it('answers an empty statement for a broker with no business', async () => {
    const { useCase } = await scenario();

    const statement = await useCase.execute({ brokerId: 'broker-sem-negocio' });

    expect(statement.lines).toEqual([]);
    expect(statement.totals).toEqual({
      payable: '0.00',
      awaitingConfirmation: '0.00',
      released: '0.00',
      paid: '0.00',
    });
  });

  it('carries the override of REQ-066 into what is expected', async () => {
    const repositories = await scenario();
    const commission = await repositories.commissions.findByPolicyId('policy-PREV');

    await repositories.commissions.save(
      (commission as Commission).applyOverride({
        receivable: null,
        payable: Money.fromString('25.00'),
        justification: 'acordo extraordinario com o corretor',
        userId: 'admin-1',
        at: NOW,
      }),
    );

    const statement = await repositories.useCase.execute({ brokerId: 'broker-1' });
    const line = statement.lines.find((entry) => entry.policyNumber === 'APL-PREV');

    expect(line?.payable).toBe('25.00');
    expect(statement.totals.payable).toBe('85.00');
  });

  it('refuses to answer a commission whose policy is gone', async () => {
    const repositories = world();
    await repositories.commissions.save(
      Commission.forecast({
        id: 'commission-orphan',
        policyId: 'policy-gone',
        basis: BASIS,
        agreedReceivable: Money.fromString('40.00'),
        agreedPayable: Money.fromString('20.00'),
        calculatedAt: NOW,
      }),
    );

    await expect(repositories.useCase.execute()).rejects.toBeInstanceOf(RecordNotFound);
  });
});
