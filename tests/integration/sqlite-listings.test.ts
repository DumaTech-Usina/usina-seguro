import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { cpfOf } from '../support/cpf.ts';
import { recognitionInput } from '../support/policy-recognition.ts';

/**
 * REQ-330 to REQ-334 on the real SQLite driver, where each page and its total
 * come from one query: the page is cut after the filter (REQ-333), the order
 * is the listing's own, and the text filters follow the core's rules — which
 * `LIKE` would not, since it folds the case of ASCII letters only.
 *
 * One database for the whole file, built through the use cases:
 * 30 proposals of 30 days, one client per proposal, the last client
 * "José Ávila"; a policy for each, renewing one day apart; the even ones with
 * CT parcelled; three integral ones eligible.
 */
let directory: string;
let application: Application;
const policies: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-listings-'));
  application = composeApplication(
    loadConfig({
      NODE_ENV: 'test',
      PERSISTENCE_DRIVER: 'sqlite',
      SQLITE_FILE: path.join(directory, 'usina.sqlite'),
    }),
  );
  const { useCases } = application;
  const alfa = await useCases.registerBroker.execute({
    name: 'Corretora Ômega',
    cpf: cpfOf(1),
    userId: 'operator',
  });

  for (let n = 1; n <= 30; n++) {
    const parcelled = n % 2 === 0;
    const day = String(n).padStart(2, '0');
    // A registration per millisecond at least: the order by instant is then the order of n.
    await nextMillisecond();
    const proposal = await useCases.registerProposal.execute({
      client: { name: n === 30 ? 'José Ávila' : `Cliente ${day}`, cpf: cpfOf(100 + n) },
      brokerId: alfa.id,
      insurerId: 'ALLIANZ',
      productId: 'Auto',
      paymentMethodId: 'credit',
      proposalNumber: `PRP-${day}`,
      netPremium: '1000.00',
      coverageStart: '2026-10-01',
      // The renewal is the end of the coverage (REQ-203): one day apart.
      coverageEnd: `2027-${n <= 15 ? '01' : '02'}-${String(n <= 15 ? n : n - 15).padStart(2, '0')}`,
      installments: parcelled
        ? [
            { amount: '500.00', dueDate: null },
            { amount: '500.00', dueDate: null },
          ]
        : [],
      workedCommission: parcelled ? '100' : '20',
      subsequentWorkedCommission: parcelled ? '30' : null,
      workedCommissionMode: parcelled ? 'PARCELLED' : 'INTEGRAL',
      intermediary: null,
      author: 'operator',
    });
    const policy = await useCases.registerPolicy.execute(
      recognitionInput(proposal.id, 'operator', `APL-${day}`),
    );
    policies.push(policy.id);
  }

  // Three integral policies made eligible, the last one the most recent.
  for (const index of [0, 2, 4]) {
    const policyId = policies[index] as string;
    await useCases.informPayoutRate.execute({ policyId, rate: '50', userId: 'operator' });
    await nextMillisecond();
    await useCases.declarePayoutEligibility.execute({ policyId, userId: 'carla' });
  }
});

function nextMillisecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

afterAll(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

/** The number each line is known by: the policy's when the line has one, else the proposal's. */
const numbers = (page: { items: readonly object[] }) =>
  page.items.map((line) => {
    const { policyNumber, proposalNumber } = line as {
      policyNumber?: string;
      proposalNumber?: string;
    };
    return policyNumber ?? proposalNumber;
  });

describe('the listings in pages, on SQLite (REQ-330 to REQ-333)', () => {
  it('cuts the proposals newest first, with the total and the next page in the same order (CA-330, CA-331)', async () => {
    const { listProposals } = application.useCases;

    const first = await listProposals.execute({ size: 25 });
    const second = await listProposals.execute({ page: 2, size: 25 });

    expect(first).toMatchObject({ total: 30, number: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(first.items[0]?.proposalNumber).toBe('PRP-30');
    expect(numbers(second)).toEqual(['PRP-05', 'PRP-04', 'PRP-03', 'PRP-02', 'PRP-01']);
    expect((await listProposals.execute()).items).toHaveLength(30);
    expect(await listProposals.execute({ page: 3, size: 25 })).toMatchObject({
      items: [],
      total: 30,
    });
  });

  it('shows the name of the client on each proposal line (REQ-318)', async () => {
    const page = await application.useCases.listProposals.execute({ size: 25 });

    expect(page.items[0]).toMatchObject({ proposalNumber: 'PRP-30', clientName: 'José Ávila' });
  });

  it('finds by client the proposal and the policy of the last page, by the core rule (CA-332, REQ-319)', async () => {
    const { listProposals, listPolicies } = application.useCases;

    // "JOSÉ" and "ávila": case folded beyond ASCII, as `matchesClientQuery` does.
    // The seeded CPFs share their first digits; `0130` is only José's.
    for (const term of ['JOSÉ', 'ávila', cpfOf(130).slice(5, 9)]) {
      const proposals = await listProposals.execute({ client: term, size: 25 });
      const found = await listPolicies.execute({ client: term, size: 25 });
      expect(proposals.total).toBe(1);
      expect(numbers(proposals)).toEqual(['PRP-30']);
      expect(numbers(found)).toEqual(['APL-30']);
    }
    expect((await listPolicies.execute({ client: 'ninguém' })).total).toBe(0);
  });

  it('cuts the policies nearest renewal first, and filters the renewal before cutting', async () => {
    const { listPolicies } = application.useCases;

    const first = await listPolicies.execute({ size: 25 });
    const until = await listPolicies.execute({ renewalUntil: '2027-01-03' });

    expect(first.items[0]?.policyNumber).toBe('APL-01');
    expect(numbers(await listPolicies.execute({ page: 2, size: 25 }))).toEqual([
      'APL-26',
      'APL-27',
      'APL-28',
      'APL-29',
      'APL-30',
    ]);
    expect(until.total).toBe(3);
    expect(numbers(until)).toEqual(['APL-01', 'APL-02', 'APL-03']);
  });

  it('lists without CR only the integral policies with no CR, counted over all of them (REQ-286)', async () => {
    const page = await application.useCases.listPoliciesWithoutPayoutRate.execute({ size: 25 });

    // 15 integral, 3 of them with a CR.
    expect(page.total).toBe(12);
    expect(numbers(page)).toEqual([
      'APL-07',
      'APL-09',
      'APL-11',
      'APL-13',
      'APL-15',
      'APL-17',
      'APL-19',
      'APL-21',
      'APL-23',
      'APL-25',
      'APL-27',
      'APL-29',
    ]);
  });

  it('lists every policy with CT parcelled, nearest renewal first (REQ-268)', async () => {
    const { listParcelledPolicies } = application.useCases;

    const first = await listParcelledPolicies.execute({ size: 25 });

    expect(first.total).toBe(15);
    expect(numbers(first).slice(0, 3)).toEqual(['APL-02', 'APL-04', 'APL-06']);
    expect(first.items[0]?.situation).toBeDefined();
  });

  it('lists the eligible ones most recent first, with the filters over all of them (REQ-284)', async () => {
    const { listEligiblePayouts } = application.useCases;

    expect(numbers(await listEligiblePayouts.execute({}))).toEqual(['APL-05', 'APL-03', 'APL-01']);
    // Broker by part, case folded beyond ASCII; the renewal by month.
    expect((await listEligiblePayouts.execute({ broker: 'ômega' })).total).toBe(3);
    expect((await listEligiblePayouts.execute({ broker: 'ÔMEGA' })).total).toBe(3);
    expect(numbers(await listEligiblePayouts.execute({ policyNumber: 'apl-03' }))).toEqual([
      'APL-03',
    ]);
    expect(
      (await listEligiblePayouts.execute({ renewalFrom: '2027-02', renewalUntil: '2027-12' }))
        .total,
    ).toBe(0);
    expect(
      (await listEligiblePayouts.execute({ eligibleFrom: '2099-01-01T00:00:00Z' })).total,
    ).toBe(0);
  });

  it('cuts the clients by name, and searches them by the core rule (REQ-316)', async () => {
    const { listClients } = application.useCases;

    const first = await listClients.execute({ size: 25 });

    expect(first.total).toBe(30);
    expect(first.items[0]?.name).toBe('Cliente 01');
    expect((await listClients.execute({ page: 2, size: 25 })).items.at(-1)?.name).toBe(
      'José Ávila',
    );
    expect((await listClients.execute({ query: 'ÁVILA' })).items.map((c) => c.name)).toEqual([
      'José Ávila',
    ]);
  });

  it('cuts the notifications most recent first, and of one recipient (REQ-330)', async () => {
    const { listNotifications, listBrokers } = application.useCases;
    const [broker] = await listBrokers.execute({});

    const first = await listNotifications.execute({ size: 25 });
    const mine = await listNotifications.execute({ recipientId: broker?.id ?? '', size: 25 });

    expect(first.total).toBe(30);
    expect(first.items[0]?.policyNumber).toBe('APL-30');
    expect(mine.total).toBe(30);
    expect((await listNotifications.execute({ recipientId: 'ninguém' })).total).toBe(0);
  });
});
