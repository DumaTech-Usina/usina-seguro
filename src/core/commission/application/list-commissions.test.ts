import { describe, expect, it } from 'vitest';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Reference } from '../../registry/domain/reference.ts';
import { Commission } from '../domain/commission.ts';
import { ListCommissions } from './list-commissions.ts';

/** Direct chain of REQ-068: 40% of the premium in, half of it out. */
function basis(premium: string) {
  return {
    premium: Money.fromString(premium),
    insurerRate: Percentage.fromString('40'),
    insurerAmount: Money.fromString('40.00'),
    intermediaryId: null,
    intermediaryRate: null,
    brokerBase: 'USINA' as const,
    brokerBaseAmount: Money.fromString('40.00'),
    brokerRate: Percentage.fromString('50'),
  };
}

interface BusinessOptions {
  readonly suffix: string;
  readonly calculatedAt: string;
  /** Absent means the report never reached this policy (REQ-075). */
  readonly reported?: string;
}

async function business(
  repositories: {
    proposals: InMemoryProposalRepository;
    policies: InMemoryPolicyRepository;
    commissions: InMemoryCommissionRepository;
  },
  options: BusinessOptions,
): Promise<void> {
  const { suffix, calculatedAt, reported } = options;

  await repositories.proposals.save(
    Proposal.register({
      id: `proposal-${suffix}`,
      clientId: `client-${suffix}`,
      brokerId: 'broker-1',
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
      installments: [
        Installment.create({
          id: `installment-${suffix}`,
          policyId: `policy-${suffix}`,
          number: 1,
          amount: Money.fromString('100.00'),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
      registeredAt: new Date(calculatedAt),
    }),
  );

  const forecast = Commission.forecast({
    id: `commission-${suffix}`,
    policyId: `policy-${suffix}`,
    basis: basis('100.00'),
    agreedReceivable: Money.fromString('40.00'),
    agreedPayable: Money.fromString('20.00'),
    calculatedAt: new Date(calculatedAt),
  });

  await repositories.commissions.save(
    reported === undefined
      ? forecast
      : forecast.reconcile('2026-10', Money.fromString(reported), new Date('2026-11-01T10:00:00Z')),
  );
}

/**
 * Three businesses in the state FP-02 leaves them in: one never reported, one
 * reported exactly as agreed, one reported short.
 */
async function scenario() {
  const repositories = {
    proposals: new InMemoryProposalRepository(),
    policies: new InMemoryPolicyRepository(),
    commissions: new InMemoryCommissionRepository(),
    // IN-01 is empty unless a test registers a name.
    references: new InMemoryReferenceRepository(),
  };

  await business(repositories, { suffix: 'FORE', calculatedAt: '2026-09-15T12:00:00.000Z' });
  await business(repositories, {
    suffix: 'CONC',
    calculatedAt: '2026-09-16T12:00:00.000Z',
    reported: '40.00',
  });
  await business(repositories, {
    suffix: 'DIV',
    calculatedAt: '2026-09-18T12:00:00.000Z',
    reported: '31.00',
  });

  return { ...repositories, useCase: new ListCommissions(repositories) };
}

describe('ListCommissions', () => {
  it('shows agreed and real side by side for every policy (OUT-05, CA-016)', async () => {
    const { useCase } = await scenario();

    const panel = await useCase.execute();

    // Newest calculation first, so the last business worked on leads.
    expect(panel.map((line) => line.policyNumber)).toEqual(['APL-DIV', 'APL-CONC', 'APL-FORE']);

    const [divergent, reconciled, forecast] = panel;
    expect(divergent?.effectiveReceivable).toBe('40.00');
    expect(divergent?.realReceivable).toBe('31.00');
    expect(divergent?.effectivePayable).toBe('20.00');
    expect(divergent?.reconciledCompetence).toBe('2026-10');
    expect(reconciled?.realReceivable).toBe('40.00');
    // REQ-075: nothing was apurado for this one yet.
    expect(forecast?.realReceivable).toBeNull();
    expect(forecast?.reconciledCompetence).toBeNull();
  });

  it('flags the policies where agreed and real disagree (REQ-076, CA-017)', async () => {
    const { useCase } = await scenario();

    const panel = await useCase.execute();

    expect(panel.map((line) => line.divergent)).toEqual([true, false, false]);
    // REQ-077: the divergent one is listed like any other, not held back.
    expect(panel).toHaveLength(3);
  });

  it('lists only the divergences when asked for them (FP-02 step 5)', async () => {
    const { useCase } = await scenario();

    const divergent = await useCase.execute({ status: 'DIVERGENT' });

    expect(divergent).toHaveLength(1);
    expect(divergent[0]?.policyNumber).toBe('APL-DIV');
    expect(divergent[0]?.status).toBe('DIVERGENT');
  });

  it('drops a divergence out of the worklist once a human closes it (REQ-085)', async () => {
    const { commissions, useCase } = await scenario();
    const divergent = await commissions.findByPolicyId('policy-DIV');

    await commissions.save(
      (divergent as Commission).resolveDivergence({
        justification: 'seguradora confirmou o valor menor',
        userId: 'financeiro-1',
        at: new Date('2026-11-02T10:00:00.000Z'),
      }),
    );

    await expect(useCase.execute({ status: 'DIVERGENT' })).resolves.toEqual([]);

    // REQ-124, REJ-014: it left the worklist, not the panel, and the values
    // that disagreed are still there.
    const [resolved] = await useCase.execute({ status: 'RESOLVED' });
    expect(resolved?.policyNumber).toBe('APL-DIV');
    expect(resolved?.effectiveReceivable).toBe('40.00');
    expect(resolved?.realReceivable).toBe('31.00');
    expect(resolved?.divergent).toBe(true);
  });

  it('identifies each line by the records that hold a readable reference', async () => {
    const { useCase } = await scenario();

    const [line] = await useCase.execute({ status: 'DIVERGENT' });

    // REQ-050: both numbers; REQ-022: who the business is for. The registries
    // of IN-01 are not modelled, so the references travel as stored.
    expect(line?.policyNumber).toBe('APL-DIV');
    expect(line?.proposalNumber).toBe('PRP-DIV');
    expect(line?.clientId).toBe('client-DIV');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.productId).toBe('auto');
  });

  it('answers an empty panel rather than failing when nothing matches', async () => {
    const { useCase } = await scenario();

    await expect(useCase.execute({ status: 'RECEIVED' })).resolves.toEqual([]);
  });

  it('refuses to answer a commission whose policy is gone', async () => {
    const commissions = new InMemoryCommissionRepository();
    await commissions.save(
      Commission.forecast({
        id: 'commission-orphan',
        policyId: 'policy-gone',
        basis: basis('100.00'),
        agreedReceivable: Money.fromString('40.00'),
        agreedPayable: Money.fromString('20.00'),
        calculatedAt: new Date('2026-09-18T12:00:00.000Z'),
      }),
    );

    const useCase = new ListCommissions({
      commissions,
      policies: new InMemoryPolicyRepository(),
      proposals: new InMemoryProposalRepository(),
      references: new InMemoryReferenceRepository(),
    });

    await expect(useCase.execute()).rejects.toBeInstanceOf(RecordNotFound);
  });

  it('identifies each line by the name IN-01 registered (REQ-096)', async () => {
    const { references, useCase } = await scenario();
    const at = new Date('2026-09-20T12:00:00.000Z');

    await references.save(
      Reference.register({ kind: 'CLIENT', id: 'client-DIV', name: 'Ana Lima', registeredAt: at }),
    );
    await references.save(
      Reference.register({
        kind: 'INSURER',
        id: 'insurer-1',
        name: 'Seguradora Norte',
        registeredAt: at,
      }),
    );
    await references.save(
      Reference.register({ kind: 'PRODUCT', id: 'auto', name: 'Automovel', registeredAt: at }),
    );

    const [line] = await useCase.execute({ status: 'DIVERGENT' });

    expect(line?.clientName).toBe('Ana Lima');
    expect(line?.insurerName).toBe('Seguradora Norte');
    expect(line?.productName).toBe('Automovel');
    // The identifier stays beside the name: it is what the conciliation of
    // REQ-082 and every other record are matched on.
    expect(line?.clientId).toBe('client-DIV');
  });

  it('answers no name for a reference nobody registered, and lists it anyway', async () => {
    const { useCase } = await scenario();

    const panel = await useCase.execute();

    // REQ-002, REQ-077: an empty registry costs the panel its names, never a
    // line and never the divergence it is there to show.
    expect(panel).toHaveLength(3);
    expect(panel.every((line) => line.clientName === null)).toBe(true);
    expect(panel.some((line) => line.divergent)).toBe(true);
  });
});
