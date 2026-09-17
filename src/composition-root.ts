import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config/config.ts';
import { GetPolicy } from './core/policy/application/get-policy.ts';
import type { PolicyRepository } from './core/policy/application/policy-repository.ts';
import { RegisterPolicy } from './core/policy/application/register-policy.ts';
import type { Transaction } from './core/policy/application/transaction.ts';
import type { ProposalRepository } from './core/proposal/application/proposal-repository.ts';
import { RegisterProposal } from './core/proposal/application/register-proposal.ts';
import { RejectProposal } from './core/proposal/application/reject-proposal.ts';
import { TransmitProposal } from './core/proposal/application/transmit-proposal.ts';
import { ImmediateTransaction } from './infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryPolicyRepository } from './infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from './infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { openSqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqlitePolicyRepository } from './infrastructure/persistence/sqlite/sqlite-policy-repository.ts';
import { SqliteProposalRepository } from './infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';
import { SqliteTransaction } from './infrastructure/persistence/sqlite/sqlite-transaction.ts';

/**
 * Use cases exposed to the interface layer.
 *
 * This is the only surface `interfaces/` sees of the core.
 */
export interface UseCases {
  readonly registerProposal: RegisterProposal;
  readonly transmitProposal: TransmitProposal;
  readonly rejectProposal: RejectProposal;
  readonly registerPolicy: RegisterPolicy;
  readonly getPolicy: GetPolicy;
}

export interface Application {
  readonly useCases: UseCases;
  readonly shutdown: () => Promise<void>;
}

/**
 * Manual dependency composition. There is no DI container: the wiring fits in a
 * readable function and a container would only add indirection.
 *
 * This is the only file that knows both the core and the infrastructure.
 */
export function composeApplication(config: Config): Application {
  const { proposals, policies, transaction, shutdown } = composePersistence(config);
  const newId = (): string => randomUUID();
  const now = (): Date => new Date();

  return {
    useCases: {
      registerProposal: new RegisterProposal({ proposals, newId, now }),
      transmitProposal: new TransmitProposal({ proposals, now }),
      rejectProposal: new RejectProposal({ proposals }),
      registerPolicy: new RegisterPolicy({ proposals, policies, transaction, newId, now }),
      getPolicy: new GetPolicy({ proposals, policies }),
    },
    shutdown,
  };
}

interface Persistence {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly transaction: Transaction;
  readonly shutdown: () => Promise<void>;
}

function composePersistence(config: Config): Persistence {
  switch (config.persistence.driver) {
    case 'memory':
      return {
        proposals: new InMemoryProposalRepository(),
        policies: new InMemoryPolicyRepository(),
        transaction: new ImmediateTransaction(),
        shutdown: async () => {},
      };

    case 'sqlite': {
      const db = openSqlite(config.persistence.file);
      return {
        proposals: new SqliteProposalRepository(db),
        policies: new SqlitePolicyRepository(db),
        transaction: new SqliteTransaction(db),
        shutdown: async () => db.close(),
      };
    }

    case 'postgres':
      // Deliberate extension point: the PostgreSQL adapter plugs in here,
      // alongside the others, without the core changing. It was not implemented
      // in this foundation because no requirement at this stage needs
      // production persistence.
      throw new Error(
        'Persistence driver postgres is not implemented yet. ' +
          'Use PERSISTENCE_DRIVER=sqlite or memory.',
      );
  }
}

function openSqlite(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return openSqliteConnection(file);
}
