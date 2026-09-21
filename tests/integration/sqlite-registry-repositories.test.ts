import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrokerCommissionRateRepository } from '../../src/core/commission/application/broker-commission-rate-repository.ts';
import type { CommissionAgreementRepository } from '../../src/core/commission/application/commission-agreement-repository.ts';
import { ListBrokerCommissionRates } from '../../src/core/commission/application/list-broker-commission-rates.ts';
import { ListCommissionAgreements } from '../../src/core/commission/application/list-commission-agreements.ts';
import { BrokerCommissionRate } from '../../src/core/commission/domain/broker-commission-rate.ts';
import { CommissionAgreement } from '../../src/core/commission/domain/commission-agreement.ts';
import { CalendarDate } from '../../src/core/policy/domain/calendar-date.ts';
import { Percentage } from '../../src/core/proposal/domain/percentage.ts';
import { ListReferences } from '../../src/core/registry/application/list-references.ts';
import type { ReferenceRepository } from '../../src/core/registry/application/reference-repository.ts';
import { Reference, type ReferenceKind } from '../../src/core/registry/domain/reference.ts';
import { ListPaymentMethodReleaseRules } from '../../src/core/settlement/application/list-payment-method-release-rules.ts';
import type { PaymentMethodReleaseRuleRepository } from '../../src/core/settlement/application/payment-method-release-rule-repository.ts';
import {
  PaymentMethodReleaseRule,
  type ReleaseRule,
} from '../../src/core/settlement/domain/payment-method-release-rule.ts';
import { InMemoryBrokerCommissionRateRepository } from '../../src/infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { InMemoryCommissionAgreementRepository } from '../../src/infrastructure/persistence/in-memory/in-memory-commission-agreement-repository.ts';
import { InMemoryPaymentMethodReleaseRuleRepository } from '../../src/infrastructure/persistence/in-memory/in-memory-payment-method-release-rule-repository.ts';
import { InMemoryReferenceRepository } from '../../src/infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { SqliteBrokerCommissionRateRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-broker-commission-rate-repository.ts';
import { SqliteCommissionAgreementRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-commission-agreement-repository.ts';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqlitePaymentMethodReleaseRuleRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-payment-method-release-rule-repository.ts';
import { SqliteReferenceRepository } from '../../src/infrastructure/persistence/sqlite/sqlite-reference-repository.ts';

/**
 * The registries of IN-02, IN-05 and IN-06 read back from the real driver.
 *
 * These three records are the parameters the whole calculation runs on
 * (REQ-061, REQ-125). Two things are checked against SQLite on disk that a
 * fake cannot answer: the order the listing promises, and that re-registering
 * a key replaces the record instead of adding one — the `UNIQUE` constraints
 * of `schema.sql` are what enforce the second, and the in-memory driver has to
 * agree with them or the same reading answers differently per driver.
 */
let directory: string;
let db: DatabaseSync;
let agreements: SqliteCommissionAgreementRepository;
let brokerRates: SqliteBrokerCommissionRateRepository;
let releaseRules: SqlitePaymentMethodReleaseRuleRepository;
let references: SqliteReferenceRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-registries-'));
  db = openSqliteConnection(path.join(directory, 'usina.sqlite'));
  agreements = new SqliteCommissionAgreementRepository(db);
  brokerRates = new SqliteBrokerCommissionRateRepository(db);
  releaseRules = new SqlitePaymentMethodReleaseRuleRepository(db);
  references = new SqliteReferenceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

interface AgreementOptions {
  readonly id: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly effectiveFrom: string;
  readonly insurerRate: string;
  readonly intermediary?: { readonly id: string; readonly rate: string };
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
            brokerBase: 'INTERMEDIARY',
          },
    registeredAt: new Date('2026-09-18T12:00:00.000Z'),
  });
}

function brokerRate(brokerId: string, rate: string): BrokerCommissionRate {
  return BrokerCommissionRate.register({
    brokerId,
    rate: Percentage.fromString(rate),
    registeredAt: new Date('2026-09-18T12:00:00.000Z'),
  });
}

function releaseRule(paymentMethodId: string, release: ReleaseRule): PaymentMethodReleaseRule {
  return PaymentMethodReleaseRule.register({
    paymentMethodId,
    release,
    registeredAt: new Date('2026-09-18T12:00:00.000Z'),
  });
}

function reference(kind: ReferenceKind, id: string, name: string): Reference {
  return Reference.register({ kind, id, name, registeredAt: new Date('2026-09-21T12:00:00.000Z') });
}

async function seedReferences(repository: ReferenceRepository): Promise<void> {
  await repository.save(reference('CLIENT', 'client-2', 'Maria Souza'));
  await repository.save(reference('CLIENT', 'client-1', 'Ana Lima'));
  await repository.save(reference('PRODUCT', 'auto', 'Automovel'));
  await repository.save(reference('INTERMEDIARY', 'mega', 'Mega Intermediacao'));
}

/** The same four agreements in whatever driver is handed over. */
async function seedAgreements(repository: CommissionAgreementRepository): Promise<void> {
  await repository.save(
    agreement({
      id: 'a-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '40',
    }),
  );
  await repository.save(
    agreement({
      id: 'a-3',
      insurerId: 'insurer-2',
      productId: 'auto',
      effectiveFrom: '2026-01-01',
      insurerRate: '30',
      intermediary: { id: 'mega', rate: '80' },
    }),
  );
  await repository.save(
    agreement({
      id: 'a-2',
      insurerId: 'insurer-1',
      productId: 'auto',
      effectiveFrom: '2026-07-01',
      insurerRate: '45',
    }),
  );
  await repository.save(
    agreement({
      id: 'a-4',
      insurerId: 'insurer-1',
      productId: 'residencial',
      effectiveFrom: '2026-01-01',
      insurerRate: '25',
    }),
  );
}

async function seedBrokerRates(repository: BrokerCommissionRateRepository): Promise<void> {
  await repository.save(brokerRate('broker-2', '45'));
  await repository.save(brokerRate('broker-1', '50.5'));
}

async function seedReleaseRules(repository: PaymentMethodReleaseRuleRepository): Promise<void> {
  await repository.save(releaseRule('credit', 'IMMEDIATE'));
  await repository.save(releaseRule('bank-slip', 'REQUIRES_RECEIPT_CONFIRMATION'));
}

describe('the commercial agreement registry on SQLite (IN-02)', () => {
  it('lists by insurer, product and most recent validity first', async () => {
    await seedAgreements(agreements);

    const listed = await new ListCommissionAgreements({ agreements, references }).execute();

    expect(listed.map((line) => line.id)).toEqual(['a-2', 'a-1', 'a-4', 'a-3']);
  });

  it('keeps both validities of a pair (REQ-065, REQ-124)', async () => {
    await seedAgreements(agreements);

    const listed = await new ListCommissionAgreements({ agreements, references }).execute();
    const auto = listed.filter(
      (line) => line.insurerId === 'insurer-1' && line.productId === 'auto',
    );

    expect(auto.map((line) => line.effectiveFrom)).toEqual(['2026-07-01', '2026-01-01']);
    // CA-012: the older validity is untouched by the newer one.
    expect(auto.map((line) => line.insurerRate)).toEqual(['45', '40']);
  });

  it('replaces the record when the same validity is registered again', async () => {
    await seedAgreements(agreements);

    await agreements.save(
      agreement({
        id: 'a-1-corrected',
        insurerId: 'insurer-1',
        productId: 'auto',
        effectiveFrom: '2026-01-01',
        insurerRate: '38',
      }),
    );

    const listed = await new ListCommissionAgreements({ agreements, references }).execute();

    // UNIQUE (insurer_id, product_id, effective_from): a correction of a
    // validity, not a second one.
    expect(listed).toHaveLength(4);
    expect(
      listed.find((line) => line.effectiveFrom === '2026-01-01' && line.productId === 'auto'),
    ).toMatchObject({ id: 'a-1-corrected', insurerRate: '38' });
  });

  it('answers the chain and the rates exactly as they were stored', async () => {
    await seedAgreements(agreements);

    const listed = await new ListCommissionAgreements({ agreements, references }).execute();
    const viaIntermediary = listed.find((line) => line.id === 'a-3');

    expect(viaIntermediary).toMatchObject({
      chain: 'INTERMEDIARY',
      intermediaryId: 'mega',
      intermediaryRate: '80',
      brokerBase: 'INTERMEDIARY',
    });
  });

  it('stores the rate as exact text, never as a float (REQ-121)', async () => {
    await agreements.save(
      agreement({
        id: 'a-scale',
        insurerId: 'insurer-1',
        productId: 'auto',
        effectiveFrom: '2026-01-01',
        insurerRate: '32.50',
      }),
    );

    const row = db
      .prepare(
        'SELECT typeof(insurer_rate) AS kind, insurer_rate AS value FROM commission_agreement',
      )
      .get() as { kind: string; value: string };

    expect(row.kind).toBe('text');
    expect(row.value).toBe('32.50');
    const [listed] = await new ListCommissionAgreements({ agreements, references }).execute();
    expect(listed?.insurerRate).toBe('32.50');
  });

  it('answers the same listing as the in-memory driver', async () => {
    const inMemory = new InMemoryCommissionAgreementRepository();
    await seedAgreements(agreements);
    await seedAgreements(inMemory);

    await expect(
      new ListCommissionAgreements({ agreements: inMemory, references }).execute(),
    ).resolves.toEqual(await new ListCommissionAgreements({ agreements, references }).execute());
  });
});

describe('the broker commission table on SQLite (IN-05)', () => {
  it('lists every broker, by broker, with the informed scale', async () => {
    await seedBrokerRates(brokerRates);

    const listed = await new ListBrokerCommissionRates({ brokerRates }).execute();

    expect(listed.map((line) => line.brokerId)).toEqual(['broker-1', 'broker-2']);
    expect(listed[0]?.rate).toBe('50.5');
  });

  it('replaces the rate of a broker registered again (REQ-093)', async () => {
    await seedBrokerRates(brokerRates);
    await brokerRates.save(brokerRate('broker-1', '55'));

    const listed = await new ListBrokerCommissionRates({ brokerRates }).execute();

    expect(listed).toHaveLength(2);
    expect(listed[0]?.rate).toBe('55');
  });

  it('answers the same listing as the in-memory driver', async () => {
    const inMemory = new InMemoryBrokerCommissionRateRepository();
    await seedBrokerRates(brokerRates);
    await seedBrokerRates(inMemory);

    await expect(
      new ListBrokerCommissionRates({ brokerRates: inMemory }).execute(),
    ).resolves.toEqual(await new ListBrokerCommissionRates({ brokerRates }).execute());
  });
});

describe('the release rule registry on SQLite (IN-06)', () => {
  it('lists every payment method configured, and only those', async () => {
    await seedReleaseRules(releaseRules);

    const listed = await new ListPaymentMethodReleaseRules({ releaseRules }).execute();

    expect(listed.map((line) => line.paymentMethodId)).toEqual(['bank-slip', 'credit']);
    expect(listed.map((line) => line.release)).toEqual([
      'REQUIRES_RECEIPT_CONFIRMATION',
      'IMMEDIATE',
    ]);
  });

  it('replaces the rule of a method registered again (CA-024, REQ-125)', async () => {
    await seedReleaseRules(releaseRules);
    await releaseRules.save(releaseRule('bank-slip', 'IMMEDIATE'));

    const listed = await new ListPaymentMethodReleaseRules({ releaseRules }).execute();

    // The behaviour changed without a deploy, and the registry shows one rule
    // per payment method, which is what the settlement reads back.
    expect(listed).toHaveLength(2);
    expect(listed[0]).toMatchObject({ paymentMethodId: 'bank-slip', release: 'IMMEDIATE' });
  });

  it('answers the same listing as the in-memory driver', async () => {
    const inMemory = new InMemoryPaymentMethodReleaseRuleRepository();
    await seedReleaseRules(releaseRules);
    await seedReleaseRules(inMemory);

    await expect(
      new ListPaymentMethodReleaseRules({ releaseRules: inMemory }).execute(),
    ).resolves.toEqual(await new ListPaymentMethodReleaseRules({ releaseRules }).execute());
  });
});

describe('the reference registry on SQLite (IN-01)', () => {
  it('lists by kind and then by name', async () => {
    await seedReferences(references);

    const listed = await new ListReferences({ references }).execute();

    expect(listed.map((line) => `${line.kind}:${line.id}`)).toEqual([
      'CLIENT:client-1',
      'CLIENT:client-2',
      'INTERMEDIARY:mega',
      'PRODUCT:auto',
    ]);
  });

  it('answers one kind at a time when asked', async () => {
    await seedReferences(references);

    const clients = await new ListReferences({ references }).execute({ kind: 'CLIENT' });

    expect(clients.map((line) => line.name)).toEqual(['Ana Lima', 'Maria Souza']);
  });

  it('replaces the name of a record registered again', async () => {
    await seedReferences(references);
    await references.save(reference('CLIENT', 'client-1', 'Ana Lima Souza'));

    const clients = await new ListReferences({ references }).execute({ kind: 'CLIENT' });

    // PRIMARY KEY (kind, id): a correction of the name, not a second record.
    expect(clients).toHaveLength(2);
    expect(clients.find((line) => line.id === 'client-1')?.name).toBe('Ana Lima Souza');
  });

  it('keeps the same identifier of two different kinds apart', async () => {
    await references.save(reference('CLIENT', 'alfa', 'Alfa Transportes'));
    await references.save(reference('BROKER', 'alfa', 'Corretora Alfa'));

    const listed = await new ListReferences({ references }).execute();

    expect(listed).toHaveLength(2);
  });

  it('names the intermediary of an agreement read back from the driver', async () => {
    await seedAgreements(agreements);
    await seedReferences(references);

    const listed = await new ListCommissionAgreements({ agreements, references }).execute();

    expect(listed.find((line) => line.id === 'a-3')?.intermediaryName).toBe('Mega Intermediacao');
    expect(listed.find((line) => line.id === 'a-1')?.intermediaryName).toBeNull();
  });

  it('answers the same listing as the in-memory driver', async () => {
    const inMemory = new InMemoryReferenceRepository();
    await seedReferences(references);
    await seedReferences(inMemory);

    await expect(new ListReferences({ references: inMemory }).execute()).resolves.toEqual(
      await new ListReferences({ references }).execute(),
    );
  });
});
