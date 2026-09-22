import { describe, expect, it } from 'vitest';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Reference } from '../../registry/domain/reference.ts';
import { Installment } from '../domain/installment.ts';
import { Policy } from '../domain/policy.ts';
import { ListPolicies } from './list-policies.ts';

interface BusinessOptions {
  readonly suffix: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /** REQ-020, REQ-055: the day the renewal is controlled against. */
  readonly renewalDate: string;
  readonly premium: string;
}

async function business(
  repositories: {
    proposals: InMemoryProposalRepository;
    policies: InMemoryPolicyRepository;
  },
  options: BusinessOptions,
): Promise<void> {
  const { suffix, coverageStart, coverageEnd, renewalDate, premium } = options;

  await repositories.proposals.save(
    Proposal.register({
      id: `proposal-${suffix}`,
      clientId: `client-${suffix}`,
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      proposalNumber: `PRP-${suffix}`,
      netPremium: Money.fromString(premium),
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
      premium: Money.fromString(premium),
      coverageStart: CalendarDate.fromString(coverageStart),
      coverageEnd: CalendarDate.fromString(coverageEnd),
      renewalDate: CalendarDate.fromString(renewalDate),
      installments: [
        Installment.create({
          id: `installment-${suffix}`,
          policyId: `policy-${suffix}`,
          number: 1,
          amount: Money.fromString(premium),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
      registeredAt: new Date('2026-09-20T10:00:00.000Z'),
    }),
  );
}

/**
 * Three policies renewing on three different days, saved in an order that is
 * not the order they renew in: an answer that came out sorted by accident of
 * insertion would pass a listing that never sorted anything.
 */
async function scenario() {
  const repositories = {
    proposals: new InMemoryProposalRepository(),
    policies: new InMemoryPolicyRepository(),
    // IN-01 is empty unless a test registers a name: an unregistered
    // reference is the ordinary case until somebody maintains the registry.
    references: new InMemoryReferenceRepository(),
  };

  await business(repositories, {
    suffix: 'MID',
    coverageStart: '2026-07-01',
    coverageEnd: '2027-06-30',
    renewalDate: '2027-06-30',
    premium: '2400.00',
  });
  await business(repositories, {
    suffix: 'LAST',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-09-30',
    renewalDate: '2027-09-30',
    premium: '1200.00',
  });
  await business(repositories, {
    suffix: 'FIRST',
    coverageStart: '2026-01-15',
    coverageEnd: '2027-01-14',
    renewalDate: '2027-01-14',
    premium: '600.00',
  });

  return { ...repositories, useCase: new ListPolicies(repositories) };
}

describe('ListPolicies', () => {
  it('lists the policies sold, nearest renewal first (OUT-03, REQ-055)', async () => {
    const { useCase } = await scenario();

    const listing = await useCase.execute();

    expect(listing.map((line) => line.policyNumber)).toEqual(['APL-FIRST', 'APL-MID', 'APL-LAST']);

    // REQ-020: the coverage period, the premium and the state, which is what
    // OUT-03 asks a control of policies to show.
    const [first] = listing;
    expect(first?.coverageStart).toBe('2026-01-15');
    expect(first?.coverageEnd).toBe('2027-01-14');
    expect(first?.renewalDate).toBe('2027-01-14');
    expect(first?.premium).toBe('600.00');
    expect(first?.status).toBe('ACTIVE');
  });

  it('narrows to the policies about to renew (OUT-04, CA-032)', async () => {
    const { useCase } = await scenario();

    const expiring = await useCase.execute({ renewalUntil: '2027-06-30' });

    // The day informed is inside the window, not one day short.
    expect(expiring.map((line) => line.policyNumber)).toEqual(['APL-FIRST', 'APL-MID']);
  });

  it('leaves out what renews after the informed day', async () => {
    const { useCase } = await scenario();

    const expiring = await useCase.execute({ renewalUntil: '2027-06-29' });

    expect(expiring.map((line) => line.policyNumber)).toEqual(['APL-FIRST']);
  });

  it('identifies each line by the records that hold a readable reference', async () => {
    const { useCase } = await scenario();

    const [line] = await useCase.execute({ renewalUntil: '2027-01-14' });

    // REQ-050: both numbers; REQ-022: who the business is for. The registries
    // of IN-01 are not modelled, so the references travel as stored.
    expect(line?.policyNumber).toBe('APL-FIRST');
    expect(line?.proposalNumber).toBe('PRP-FIRST');
    expect(line?.clientId).toBe('client-FIRST');
    expect(line?.insurerId).toBe('insurer-1');
    expect(line?.productId).toBe('auto');
    // The line has to be able to hand the operator over to the policy itself.
    expect(line?.id).toBe('policy-FIRST');
    expect(line?.proposalId).toBe('proposal-FIRST');
  });

  it('answers an empty listing rather than failing when nothing renews until then', async () => {
    const { useCase } = await scenario();

    await expect(useCase.execute({ renewalUntil: '2026-12-31' })).resolves.toEqual([]);
  });

  it('refuses a malformed day instead of reading it as no window at all', async () => {
    const { useCase } = await scenario();

    // Answering the whole listing to a question that was not understood would
    // show policies that renew long after what was asked for (REQ-020).
    await expect(useCase.execute({ renewalUntil: '30/06/2027' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
    await expect(useCase.execute({ renewalUntil: '2027-02-31' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
  });

  it('refuses to answer a policy whose proposal is gone', async () => {
    const { policies } = await scenario();

    const useCase = new ListPolicies({
      policies,
      proposals: new InMemoryProposalRepository(),
      references: new InMemoryReferenceRepository(),
    });

    await expect(useCase.execute()).rejects.toBeInstanceOf(RecordNotFound);
  });

  it('identifies each line by the name IN-01 registered (REQ-096)', async () => {
    const { references, useCase } = await scenario();

    await references.save(
      Reference.register({
        kind: 'CLIENT',
        id: 'client-MID',
        name: 'Ana Lima',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );
    await references.save(
      Reference.register({
        kind: 'INSURER',
        id: 'insurer-1',
        name: 'Seguradora Norte',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );
    await references.save(
      Reference.register({
        kind: 'PRODUCT',
        id: 'auto',
        name: 'Automovel',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );

    const listing = await useCase.execute();
    const mid = listing.find((line) => line.policyNumber === 'APL-MID');

    expect(mid?.clientName).toBe('Ana Lima');
    expect(mid?.insurerName).toBe('Seguradora Norte');
    // REQ-022 names the field "produto/ramo": the product's name is the ramo.
    expect(mid?.productName).toBe('Automovel');
    // The identifier travels beside the name: it is what every other record
    // is matched on, and the name never replaces it.
    expect(mid?.clientId).toBe('client-MID');
  });

  it('answers no name for a reference nobody registered, and lists it anyway', async () => {
    const { references, useCase } = await scenario();

    await references.save(
      Reference.register({
        kind: 'CLIENT',
        id: 'client-MID',
        name: 'Ana Lima',
        registeredAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );

    const listing = await useCase.execute();
    const last = listing.find((line) => line.policyNumber === 'APL-LAST');

    // REQ-002: the system reflects a control that happens outside it. A client
    // nobody registered is a missing name, never a business to hide or refuse.
    expect(last?.clientName).toBeNull();
    expect(last?.clientId).toBe('client-LAST');
    expect(listing).toHaveLength(3);
  });
});
