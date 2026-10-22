import { describe, expect, it } from 'vitest';
import { InMemoryClientRepository } from '../../../infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Client } from '../../registry/domain/client.ts';
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
  };
}

interface BusinessOptions {
  readonly suffix: string;
  readonly calculatedAt: string;
}

async function business(
  repositories: {
    proposals: InMemoryProposalRepository;
    policies: InMemoryPolicyRepository;
    commissions: InMemoryCommissionRepository;
  },
  options: BusinessOptions,
): Promise<void> {
  const { suffix, calculatedAt } = options;

  await repositories.proposals.save(
    Proposal.register({
      id: `proposal-${suffix}`,
      clientId: `client-${suffix}`,
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      proposalNumber: `PRP-${suffix}`,
      netPremium: Money.fromString('100.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-10-01'),
      installments: [],
      workedCommission: Percentage.fromString('40'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
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

  await repositories.commissions.save(
    Commission.forecast({
      id: `commission-${suffix}`,
      policyId: `policy-${suffix}`,
      basis: basis('100.00'),
      agreedReceivable: Money.fromString('40.00'),
      calculatedAt: new Date(calculatedAt),
    }),
  );
}

/** Three businesses, each with its agreed commission. */
async function scenario() {
  const repositories = {
    proposals: new InMemoryProposalRepository(),
    policies: new InMemoryPolicyRepository(),
    commissions: new InMemoryCommissionRepository(),
    // IN-01 is empty unless a test registers a name.
    references: new InMemoryReferenceRepository(),
    // V2 section 9E: empty unless a test registers a client.
    clients: new InMemoryClientRepository(),
  };

  await business(repositories, { suffix: 'FORE', calculatedAt: '2026-09-15T12:00:00.000Z' });
  await business(repositories, { suffix: 'CONC', calculatedAt: '2026-09-16T12:00:00.000Z' });
  await business(repositories, { suffix: 'DIV', calculatedAt: '2026-09-18T12:00:00.000Z' });

  return { ...repositories, useCase: new ListCommissions(repositories) };
}

describe('ListCommissions', () => {
  it('shows the agreed commission of every policy, newest calculation first (OUT-05)', async () => {
    const { useCase } = await scenario();

    const panel = await useCase.execute();

    // Newest calculation first, so the last business worked on leads.
    expect(panel.items.map((line) => line.policyNumber)).toEqual([
      'APL-DIV',
      'APL-CONC',
      'APL-FORE',
    ]);
    expect(panel.items.map((line) => line.effectiveReceivable)).toEqual([
      '40.00',
      '40.00',
      '40.00',
    ]);
  });

  it('lists the commissions of the state asked for', async () => {
    const { useCase } = await scenario();

    const forecast = await useCase.execute({ status: 'FORECAST' });

    expect(forecast.items).toHaveLength(3);
    expect(forecast.items.every((line) => line.status === 'FORECAST')).toBe(true);
  });

  it('identifies each line by the records that hold a readable reference', async () => {
    const { useCase } = await scenario();

    const {
      items: [line],
    } = await useCase.execute();

    // REQ-050: both numbers; REQ-022: who the business is for. The registries
    // of IN-01 are not modelled, so the references travel as stored.
    expect(line?.policyNumber).toBe('APL-DIV');
    expect(line?.proposalNumber).toBe('PRP-DIV');
    expect(line?.clientId).toBe('client-DIV');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.productId).toBe('auto');
  });

  it('refuses to answer a commission whose policy is gone', async () => {
    const commissions = new InMemoryCommissionRepository();
    await commissions.save(
      Commission.forecast({
        id: 'commission-orphan',
        policyId: 'policy-gone',
        basis: basis('100.00'),
        agreedReceivable: Money.fromString('40.00'),
        calculatedAt: new Date('2026-09-18T12:00:00.000Z'),
      }),
    );

    const useCase = new ListCommissions({
      commissions,
      policies: new InMemoryPolicyRepository(),
      proposals: new InMemoryProposalRepository(),
      references: new InMemoryReferenceRepository(),
      clients: new InMemoryClientRepository(),
    });

    await expect(useCase.execute()).rejects.toBeInstanceOf(RecordNotFound);
  });

  it('identifies each line by the name IN-01 registered, and the client by its registry (REQ-096, REQ-318)', async () => {
    const { references, clients, useCase } = await scenario();
    const at = new Date('2026-09-20T12:00:00.000Z');

    await clients.save(
      Client.register({
        id: 'client-DIV',
        name: 'Ana Lima',
        cpf: '52998224725',
        signed: Authorship.of('user-1', at),
      }),
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

    const {
      items: [line],
    } = await useCase.execute();

    expect(line?.clientName).toBe('Ana Lima');
    expect(line?.insurerName).toBe('Seguradora Norte');
    expect(line?.productName).toBe('Automovel');
    // The identifier stays beside the name: it is what every record is
    // matched on.
    expect(line?.clientId).toBe('client-DIV');
  });

  it('answers no name for a reference nobody registered, and lists it anyway', async () => {
    const { useCase } = await scenario();

    const panel = await useCase.execute();

    // REQ-002: an empty registry costs the panel its names, never a line.
    expect(panel.items).toHaveLength(3);
    expect(panel.items.every((line) => line.insurerName === null)).toBe(true);
    // REQ-320: a client that is no registered client is the text, as it is.
    expect(panel.items.every((line) => line.clientName === line.clientId)).toBe(true);
  });
});
