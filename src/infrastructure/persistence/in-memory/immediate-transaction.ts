import type { Transaction } from '../../../core/policy/application/transaction.ts';

/**
 * `Transaction` implementation for the in-memory driver: it just runs the work.
 *
 * There is nothing to roll back — the in-memory repositories hold plain maps
 * and do not simulate durability. A test that needs to observe a rollback has
 * to use SQLite, the same rule already stated for the in-memory repositories.
 */
export class ImmediateTransaction implements Transaction {
  async run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
