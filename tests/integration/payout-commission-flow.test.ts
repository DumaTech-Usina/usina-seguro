import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';
import { cpfOf } from '../support/cpf.ts';

/**
 * FP-02 against the real SQLite driver: the CR, its recalculation and the
 * eligibility survive a reopening exactly as they were recorded (REQ-279,
 * REQ-283 — nothing is recalculated when read back).
 */
let directory: string;
let file: string;
let application: Application;
/** REQ-307: the registered broker the proposals name. */
let brokerId: string;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-payout-'));
  file = path.join(directory, 'usina.sqlite');
  application = open();
  brokerId = (
    await application.useCases.registerBroker.execute({
      name: 'Corretora Alfa',
      cpf: cpfOf(1),
      userId: 'operator',
    })
  ).id;
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function open(): Application {
  return composeApplication(loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }));
}

async function policy(proposalNumber: string, mode: 'INTEGRAL' | 'PARCELLED' = 'INTEGRAL') {
  const { useCases } = application;
  const proposal = await useCases.registerProposal.execute({
    client: { name: 'Ana Lima', cpf: cpfOf(201) },
    brokerId,
    insurerId: 'ALLIANZ',
    productId: 'Auto',
    paymentMethodId: 'credit',
    proposalNumber,
    netPremium: '1000.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    // REQ-291, REQ-292, REQ-296: a parcelled CT has two CTs, at least two
    // installments and no intermediary.
    installments:
      mode === 'PARCELLED'
        ? [
            { amount: '100.00', dueDate: null },
            { amount: '100.00', dueDate: null },
          ]
        : [],
    workedCommission: mode === 'PARCELLED' ? '100' : '20',
    subsequentWorkedCommission: mode === 'PARCELLED' ? '30' : null,
    workedCommissionMode: mode,
    intermediary: mode === 'PARCELLED' ? null : { intermediaryId: 'Mega', ctu: '80' },
    author: 'operator',
  });

  return useCases.registerPolicy.execute({ proposalId: proposal.id, userId: 'operator' });
}

describe('payout commission on SQLite (FP-02)', () => {
  it('keeps the CR entries and the statement across a reopening (REQ-279, REQ-283)', async () => {
    const issued = await policy('PRP-1');
    const { useCases } = application;

    await useCases.informPayoutRate.execute({ policyId: issued.id, rate: '60', userId: 'ana' });
    await useCases.revisePayoutRate.execute({
      policyId: issued.id,
      rate: '70',
      reason: 'corretor renegociou',
      userId: 'bruno',
    });
    const eligible = await useCases.declarePayoutEligibility.execute({
      policyId: issued.id,
      userId: 'carla',
    });

    await application.shutdown();
    application = open();

    const reread = await application.useCases.getPolicyPayout.execute(issued.id);

    expect(reread).toEqual(eligible);
    // CA-226: CT 20%, CTU 80% over 1,000.00 -> 160.00; CR 70% -> 112.00 / 48.00.
    expect(reread.commission?.statement).toMatchObject({
      policyNumber: 'PRP-1',
      ctu: '80',
      usinaValue: '160.00',
      payoutRate: '70',
      payout: '112.00',
      retained: '48.00',
      signedBy: 'carla',
    });
    expect(reread.commission?.entries.map((entry) => entry.rate)).toEqual(['60', '70']);
  });

  it('stores amounts and rates as exact decimal text (REQ-120, REQ-121)', async () => {
    const issued = await policy('PRP-2');
    await application.useCases.informPayoutRate.execute({
      policyId: issued.id,
      rate: '70.55',
      userId: 'ana',
    });
    await application.shutdown();

    const db = new DatabaseSync(file);
    const row = db
      .prepare(
        `SELECT rate, typeof(rate) AS rate_type, payout, typeof(payout) AS payout_type
         FROM payout_rate_entry`,
      )
      .get() as { rate: string; rate_type: string; payout: string; payout_type: string };
    db.close();

    expect(row).toEqual({
      rate: '70.55',
      rate_type: 'text',
      // 160.00 x 70.55% = 112.88 exactly.
      payout: '112.88',
      payout_type: 'text',
    });

    application = open();
  });

  it('lists the eligible and the policies without CR after a reopening (REQ-284, REQ-286)', async () => {
    const first = await policy('PRP-3');
    await policy('PRP-4');
    await policy('PRP-5', 'PARCELLED');
    await application.useCases.informPayoutRate.execute({
      policyId: first.id,
      rate: '60',
      userId: 'ana',
    });
    await application.useCases.declarePayoutEligibility.execute({
      policyId: first.id,
      userId: 'carla',
    });

    await application.shutdown();
    application = open();

    const eligible = await application.useCases.listEligiblePayouts.execute({ broker: 'alfa' });
    const without = await application.useCases.listPoliciesWithoutPayoutRate.execute();

    expect(eligible.map((line) => line.policyNumber)).toEqual(['PRP-3']);
    expect(without.map((line) => line.policyNumber)).toEqual(['PRP-4']);
  });

  it('refuses a second CR on the same policy (REQ-271, REJ-217)', async () => {
    const issued = await policy('PRP-6');
    await application.useCases.informPayoutRate.execute({
      policyId: issued.id,
      rate: '60',
      userId: 'ana',
    });

    await expect(
      application.useCases.informPayoutRate.execute({
        policyId: issued.id,
        rate: '50',
        userId: 'ana',
      }),
    ).rejects.toThrow(BusinessRuleViolation);
  });
});

describe('parcelled payout on SQLite (V2 section 9B)', () => {
  it('keeps the CR entries, the calculation of each installment and the statements across a reopening (REQ-265, REQ-266)', async () => {
    const issued = await policy('PRP-P1', 'PARCELLED');
    const { useCases } = application;

    await useCases.informParcelledPayoutRates.execute({
      policyId: issued.id,
      firstRate: '100',
      subsequentRate: '15',
      userId: 'ana',
    });
    await useCases.reviseParcelledPayoutRates.execute({
      policyId: issued.id,
      firstRate: '90',
      subsequentRate: '20',
      reason: 'acordo revisto',
      userId: 'bruno',
    });
    const eligible = await useCases.declareInstallmentEligibility.execute({
      policyId: issued.id,
      number: 2,
      userId: 'carla',
    });

    await application.shutdown();
    application = open();

    const read = await application.useCases.getParcelledPayout.execute(issued.id);

    expect(read).toEqual(eligible);
    expect(read.situation).toBe('PARTIALLY_ELIGIBLE');
    expect(read.entries.map((entry) => entry.calculations.map((c) => c.payout))).toEqual([
      ['100.00', '15.00'],
      ['90.00', '20.00'],
    ]);
    expect(read.installments[1]?.statement).toMatchObject({
      installmentNumber: 2,
      payoutRate: '20',
      payout: '20.00',
      retained: '10.00',
      signedBy: 'carla',
    });
  });

  it('lists the parcelled policies with their situation after a reopening (REQ-268)', async () => {
    const parcelled = await policy('PRP-P2', 'PARCELLED');
    await policy('PRP-I1');

    await application.shutdown();
    application = open();

    expect(await application.useCases.listParcelledPolicies.execute()).toEqual([
      expect.objectContaining({ policyId: parcelled.id, situation: 'WITHOUT_CR' }),
    ]);
  });
});
