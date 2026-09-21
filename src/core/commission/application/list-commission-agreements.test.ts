import { describe, expect, it } from 'vitest';
import { InMemoryCommissionAgreementRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-agreement-repository.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { CommissionAgreement } from '../domain/commission-agreement.ts';
import { ListCommissionAgreements } from './list-commission-agreements.ts';

interface AgreementOptions {
  readonly id: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly effectiveFrom: string;
  readonly insurerRate: string;
  readonly registeredAt?: string;
  readonly intermediary?: { readonly id: string; readonly rate: string; readonly base: 'USINA' };
}

function agreement(options: AgreementOptions): CommissionAgreement {
  return CommissionAgreement.register({
    id: options.id,
    insurerId: options.insurerId,
    productId: options.productId,
    effectiveFrom: CalendarDate.fromString(options.effectiveFrom),
    insurerRate: Percentage.fromString(options.insurerRate),
    chain:
      options.intermediary === undefined
        ? { kind: 'DIRECT' }
        : {
            kind: 'INTERMEDIARY',
            intermediaryId: options.intermediary.id,
            intermediaryRate: Percentage.fromString(options.intermediary.rate),
            brokerBase: options.intermediary.base,
          },
    registeredAt: new Date(options.registeredAt ?? '2026-09-18T12:00:00.000Z'),
  });
}

async function scenario() {
  const agreements = new InMemoryCommissionAgreementRepository();

  // Two validities of the same pair, written out of chronological order, plus
  // two other pairs, so nothing below can pass by accident of insertion order.
  await agreements.save(
    agreement({
      id: 'a-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '40',
    }),
  );
  await agreements.save(
    agreement({
      id: 'a-3',
      insurerId: 'insurer-2',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '30',
      intermediary: { id: 'mega', rate: '80', base: 'USINA' },
    }),
  );
  await agreements.save(
    agreement({
      id: 'a-2',
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: '2026-07-01',
      insurerRate: '45',
    }),
  );
  await agreements.save(
    agreement({
      id: 'a-4',
      insurerId: 'insurer-1',
      productId: 'residencial',
      effectiveFrom: '2026-01-01',
      insurerRate: '25',
    }),
  );

  return { agreements, useCase: new ListCommissionAgreements({ agreements }) };
}

describe('ListCommissionAgreements', () => {
  it('answers every agreement registered (IN-02, REQ-065)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute();

    expect(listed.map((line) => line.id)).toEqual(['a-2', 'a-1', 'a-4', 'a-3']);
  });

  it('groups the validities of a pair, most recent first (REQ-124)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute();
    const auto = listed.filter(
      (line) => line.insurerId === 'insurer-1' && line.productId === 'auto',
    );

    // REQ-065, CA-012: a new validity is a new record, not a rewrite, so both
    // are answered and the reader sees the history.
    expect(auto.map((line) => line.effectiveFrom)).toEqual(['2026-07-01', '2026-01-01']);
    expect(auto.map((line) => line.insurerRate)).toEqual(['45', '40']);
  });

  it('describes the chain of each agreement (REQ-060, REQ-063, REQ-064)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute();
    const direct = listed.find((line) => line.id === 'a-1');
    const viaIntermediary = listed.find((line) => line.id === 'a-3');

    expect(direct?.chain).toBe('DIRECT');
    expect(direct?.intermediaryId).toBeNull();
    expect(direct?.intermediaryRate).toBeNull();
    // REQ-062: with nobody in between, there is only one amount to calculate on.
    expect(direct?.brokerBase).toBe('USINA');

    expect(viaIntermediary?.chain).toBe('INTERMEDIARY');
    expect(viaIntermediary?.intermediaryId).toBe('mega');
    expect(viaIntermediary?.intermediaryRate).toBe('80');
    expect(viaIntermediary?.brokerBase).toBe('USINA');
  });

  it('preserves the scale the rate was informed with (REQ-121)', async () => {
    const agreements = new InMemoryCommissionAgreementRepository();
    await agreements.save(
      agreement({
        id: 'a-scale',
        insurerId: 'insurer-1',
        productId: 'auto',
        effectiveFrom: '2026-01-01',
        insurerRate: '32.50',
      }),
    );

    const [listed] = await new ListCommissionAgreements({ agreements }).execute();

    expect(listed?.insurerRate).toBe('32.50');
  });

  it('answers an empty registry rather than failing', async () => {
    const useCase = new ListCommissionAgreements({
      agreements: new InMemoryCommissionAgreementRepository(),
    });

    await expect(useCase.execute()).resolves.toEqual([]);
  });

  it('replaces a validity registered twice instead of listing it twice', async () => {
    const { agreements, useCase } = await scenario();

    // The same insurer, product and validity: a correction of the rate, which
    // is the key `commission_agreement` is UNIQUE on.
    await agreements.save(
      agreement({
        id: 'a-1-corrected',
        insurerId: 'insurer-1',
        productId: 'auto',
        effectiveFrom: '2026-01-01',
        insurerRate: '38',
      }),
    );

    const listed = await useCase.execute();
    const sameValidity = listed.filter(
      (line) =>
        line.insurerId === 'insurer-1' &&
        line.productId === 'auto' &&
        line.effectiveFrom === '2026-01-01',
    );

    expect(sameValidity).toHaveLength(1);
    expect(sameValidity[0]?.insurerRate).toBe('38');
  });
});
