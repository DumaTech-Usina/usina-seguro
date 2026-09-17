import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config/config.ts';
import type { ProposalRepository } from './core/proposal/application/proposal-repository.ts';
import { RegisterProposal } from './core/proposal/application/register-proposal.ts';
import { InMemoryProposalRepository } from './infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { openSqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteProposalRepository } from './infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';

/**
 * Use cases exposed to the interface layer.
 *
 * This is the only surface `interfaces/` sees of the core.
 */
export interface UseCases {
  readonly registerProposal: RegisterProposal;
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
  const { proposals, shutdown } = composePersistence(config);

  return {
    useCases: {
      registerProposal: new RegisterProposal({
        proposals,
        newId: () => randomUUID(),
        now: () => new Date(),
      }),
    },
    shutdown,
  };
}

interface Persistence {
  readonly proposals: ProposalRepository;
  readonly shutdown: () => Promise<void>;
}

function composePersistence(config: Config): Persistence {
  switch (config.persistence.driver) {
    case 'memory':
      return {
        proposals: new InMemoryProposalRepository(),
        shutdown: async () => {},
      };

    case 'sqlite': {
      const db = openSqlite(config.persistence.file);
      return {
        proposals: new SqliteProposalRepository(db),
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
