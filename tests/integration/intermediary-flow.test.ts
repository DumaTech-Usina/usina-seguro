import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import type { RegisterProposalInput } from '../../src/core/proposal/application/register-proposal.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';
import { cpfOf } from '../support/cpf.ts';

/**
 * REQ-229 against the real SQLite driver and the real wiring: the proposal
 * names an intermediary of the reference registry, the one that exists today
 * (Mega) and any other registered later, with no change to the system.
 */
let directory: string;
let file: string;
let application: Application;
let brokerId: string;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-intermediaries-'));
  file = path.join(directory, 'usina.sqlite');
  application = open();
  brokerId = (
    await application.useCases.registerBroker.execute({
      name: 'Corretora Alfa',
      cpf: cpfOf(1),
      userId: 'operator',
    })
  ).id;
  await application.useCases.registerReference.execute({
    kind: 'INTERMEDIARY',
    id: 'mega',
    name: 'Mega Intermediação',
  });
});

afterEach(async () => {
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function open(): Application {
  return composeApplication(loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: file }));
}

function proposal(overrides: Partial<RegisterProposalInput> = {}): RegisterProposalInput {
  return {
    client: { name: 'Maria Souza', cpf: cpfOf(601) },
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-1',
    netPremium: '100.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [],
    workedCommission: '20',
    workedCommissionMode: 'INTEGRAL',
    intermediary: { intermediaryId: 'mega', ctu: '50' },
    author: 'operator',
    ...overrides,
  };
}

describe('the registered intermediary on SQLite (REQ-229)', () => {
  it('registers a proposal through Mega and reads it back after a reopening (CA-269, REQ-226)', async () => {
    const registered = await application.useCases.registerProposal.execute(proposal());

    await application.shutdown();
    application = open();

    const reread = await application.useCases.getProposal.execute(registered.id);
    expect(reread).toEqual(registered);
    expect(reread).toMatchObject({
      intermediaryId: 'mega',
      ctu: '50',
      expectedReceipt: { intermediary: '20.00', usina: '10.00' },
    });
  });

  it('refuses an unregistered intermediary and leaves neither proposal nor client behind (REJ-246, EX-216, CA-314)', async () => {
    const refused = await application.useCases.registerProposal
      .execute(proposal({ intermediary: { intermediaryId: 'Intermediaria Digitada', ctu: '50' } }))
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(BusinessRuleViolation);
    expect((refused as BusinessRuleViolation).rule).toBe('REQ-229');
    expect(await application.useCases.listProposals.execute()).toEqual([]);
    expect(await application.useCases.listClients.execute()).toEqual([]);
  });

  it('does not take an intermediary of another kind of reference (REQ-229)', async () => {
    await application.useCases.registerReference.execute({
      kind: 'INSURER',
      id: 'allianz',
      name: 'Allianz',
    });

    await expect(
      application.useCases.registerProposal.execute(
        proposal({ intermediary: { intermediaryId: 'allianz', ctu: '50' } }),
      ),
    ).rejects.toMatchObject({ rule: 'REQ-229' });
  });

  it('refuses an unregistered intermediary at the revision and keeps the receipt (REQ-225, REJ-246)', async () => {
    const registered = await application.useCases.registerProposal.execute(
      proposal({ intermediary: null }),
    );

    await expect(
      application.useCases.reviseReceipt.execute({
        proposalId: registered.id,
        intermediary: { intermediaryId: 'Intermediaria Digitada', ctu: '50' },
        author: 'bruno',
      }),
    ).rejects.toMatchObject({ rule: 'REQ-229' });

    expect(await application.useCases.getProposal.execute(registered.id)).toEqual(registered);
  });

  it('takes a second intermediary once it is registered, with no other change (CA-269)', async () => {
    await expect(
      application.useCases.registerProposal.execute(
        proposal({ intermediary: { intermediaryId: 'alfa', ctu: '50' } }),
      ),
    ).rejects.toMatchObject({ rule: 'REQ-229' });

    await application.useCases.registerReference.execute({
      kind: 'INTERMEDIARY',
      id: 'alfa',
      name: 'Alfa Intermediação',
    });

    await expect(
      application.useCases.registerProposal.execute(
        proposal({ intermediary: { intermediaryId: 'alfa', ctu: '50' } }),
      ),
    ).resolves.toMatchObject({ intermediaryId: 'alfa' });
  });

  it('keeps the identifier on the proposal when the registered name changes (REQ-229)', async () => {
    const registered = await application.useCases.registerProposal.execute(proposal());

    await application.useCases.registerReference.execute({
      kind: 'INTERMEDIARY',
      id: 'mega',
      name: 'Mega Corretagem',
    });

    expect(await application.useCases.getProposal.execute(registered.id)).toMatchObject({
      intermediaryId: 'mega',
    });
  });
});
