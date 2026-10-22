import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import type { RegisterProposalInput } from '../../src/core/proposal/application/register-proposal.ts';
import { BusinessRuleViolation } from '../../src/core/proposal/domain/errors.ts';
import { cpfOf } from '../support/cpf.ts';
import { recognitionInput } from '../support/policy-recognition.ts';

/**
 * The clients of V2 section 9E against the real SQLite driver: the client is
 * resolved by its CPF in the same unit of work as the proposal (REQ-317), the
 * policy has its proposal's client (REQ-318), and both listings are searched
 * through the client registry (REQ-319).
 */
let directory: string;
let application: Application;
let brokerId: string;

const MARIA = cpfOf(501);
const BRUNO = cpfOf(502);

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-clients-'));
  application = composeApplication(
    loadConfig({ PERSISTENCE_DRIVER: 'sqlite', SQLITE_FILE: path.join(directory, 'usina.sqlite') }),
  );
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

function proposal(overrides: Partial<RegisterProposalInput> = {}): RegisterProposalInput {
  return {
    client: { name: 'Maria Souza', cpf: MARIA },
    brokerId,
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-1',
    netPremium: '1000.00',
    coverageStart: '2026-10-01',
    coverageEnd: '2027-10-01',
    installments: [],
    workedCommission: '30',
    workedCommissionMode: 'INTEGRAL',
    intermediary: null,
    author: 'operator',
    ...overrides,
  };
}

/** `529.982.247-25` from `52998224725`: the CPF as a person types it. */
function punctuated(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

describe('the client of a proposal on SQLite (REQ-317)', () => {
  it('registers the client of a new CPF, signed by whoever registers the proposal (CA-313)', async () => {
    const { clientId } = await application.useCases.registerProposal.execute(proposal());

    expect(await application.useCases.getClient.execute({ clientId })).toMatchObject({
      name: 'Maria Souza',
      cpf: MARIA,
      history: [{ name: 'Maria Souza', signedBy: 'operator' }],
    });
  });

  it('reuses the client of a known CPF and never overwrites it (CA-313, REJ-314)', async () => {
    const first = await application.useCases.registerProposal.execute(proposal());

    const second = await application.useCases.registerProposal.execute(
      proposal({
        proposalNumber: 'PRP-2',
        client: { name: 'Maria S. Outra', cpf: punctuated(MARIA) },
        author: 'carla',
      }),
    );

    expect(second.clientId).toBe(first.clientId);
    const clients = (await application.useCases.listClients.execute()).items;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ name: 'Maria Souza', history: [{ signedBy: 'operator' }] });
  });

  it('leaves no client behind when the proposal is refused after the client was resolved (CA-314)', async () => {
    // The broker is checked after the client was created: only the rollback
    // of the unit of work can take the client back.
    const refused = await application.useCases.registerProposal
      .execute(proposal({ brokerId: 'Corretora Digitada' }))
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(BusinessRuleViolation);
    expect((refused as BusinessRuleViolation).rule).toBe('REQ-307');
    expect((await application.useCases.listClients.execute()).items).toEqual([]);
    expect((await application.useCases.listProposals.execute()).items).toEqual([]);
  });

  it('refuses a proposal without the client name or with an invalid CPF, and keeps nothing (REJ-310, REJ-311)', async () => {
    for (const client of [
      { name: '  ', cpf: MARIA },
      { name: 'Maria Souza', cpf: '' },
      { name: 'Maria Souza', cpf: '123.456.789-00' },
    ]) {
      await expect(
        application.useCases.registerProposal.execute(proposal({ client })),
      ).rejects.toBeInstanceOf(BusinessRuleViolation);
    }

    expect((await application.useCases.listClients.execute()).items).toEqual([]);
    expect((await application.useCases.listProposals.execute()).items).toEqual([]);
  });
});

describe('the client of a policy and the search by client on SQLite (REQ-318, REQ-319)', () => {
  it('gives the policy its proposal’s client and finds both by name or CPF (CA-315, CA-316)', async () => {
    const maria = await application.useCases.registerProposal.execute(proposal());
    const bruno = await application.useCases.registerProposal.execute(
      proposal({ proposalNumber: 'PRP-2', client: { name: 'Bruno Lima', cpf: BRUNO } }),
    );
    const policy = await application.useCases.registerPolicy.execute(
      recognitionInput(maria.id, 'operator', 'APL-MARIA'),
    );
    await application.useCases.registerPolicy.execute(
      recognitionInput(bruno.id, 'operator', 'APL-BRUNO'),
    );

    // REQ-241, REQ-318: read from the proposal, never stored again.
    expect((await application.useCases.getPolicy.execute(policy.id)).clientId).toBe(maria.clientId);

    const proposals = async (client: string) =>
      (await application.useCases.listProposals.execute({ client })).items.map(
        (p) => p.proposalNumber,
      );
    const policies = async (client: string) =>
      (await application.useCases.listPolicies.execute({ client })).items.map((p) => p.clientName);

    expect(await proposals('souza')).toEqual(['PRP-1']);
    expect(await proposals(punctuated(BRUNO).slice(-6))).toEqual(['PRP-2']);
    expect(await policies('MARIA')).toEqual(['Maria Souza']);
    expect(await policies(BRUNO)).toEqual(['Bruno Lima']);
    expect(await policies('carlos')).toEqual([]);

    // REQ-318: a renamed client is shown, and found, by the current name.
    await application.useCases.changeClient.execute({
      clientId: maria.clientId,
      name: 'Maria Souza Lima',
      cpf: MARIA,
      userId: 'operator',
    });
    expect(await policies('souza lima')).toEqual(['Maria Souza Lima']);
  });
});
