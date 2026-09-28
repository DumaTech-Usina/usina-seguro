import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-composition-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('application composition', () => {
  it('composes with the memory driver and runs the use case end to end', async () => {
    const config = loadConfig({ PERSISTENCE_DRIVER: 'memory' });
    const application = composeApplication(config);

    const output = await application.useCases.registerProposal.execute({
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'credit-card',
      proposalNumber: 'PRP-1',
      netPremium: '100.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      installments: [],
      workedCommission: '40',
      workedCommissionMode: 'INTEGRAL',
      intermediary: null,
      author: 'operator',
    });

    expect(output.status).toBe('AWAITING_ISSUANCE');
    await application.shutdown();
  });

  it('composes with the sqlite driver, creates the file and persists across runs', async () => {
    const file = path.join(directory, 'nested', 'usina.sqlite');
    const config = loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file });

    const first = composeApplication(config);
    const output = await first.useCases.registerProposal.execute({
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-1',
      netPremium: '3210.99',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      installments: [],
      workedCommission: '40',
      workedCommissionMode: 'INTEGRAL',
      intermediary: null,
      author: 'operator',
    });
    await first.shutdown();

    // New composition, same file: the data must still be there.
    const second = composeApplication(config);
    const repeated = await second.useCases.registerProposal.execute({
      clientId: 'client-2',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'product-1',
      paymentMethodId: 'bank-slip',
      proposalNumber: 'PRP-1',
      netPremium: '10.01',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      installments: [],
      workedCommission: '40',
      workedCommissionMode: 'INTEGRAL',
      intermediary: null,
      author: 'operator',
    });
    await second.shutdown();

    expect(output.id).not.toBe(repeated.id);
    expect(output.netPremium).toBe('3210.99');
  });

  it('fails explicitly when the postgres driver is selected (not implemented yet)', () => {
    const config = loadConfig({
      PERSISTENCE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://localhost/usina',
    });

    expect(() => composeApplication(config)).toThrow(/postgres is not implemented yet/);
  });
});
