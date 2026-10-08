/**
 * Runs a unit of work atomically.
 *
 * Declared here because `RegisterPolicy` is the first operation that has to
 * change two aggregates for a single business fact: the proposal becomes
 * `ISSUED` and the policy is created — the same act, with no state in between
 * (REQ-240, REQ-251) — and an issued proposal is frozen (REQ-244, REQ-260), so a
 * half-applied write would leave a record that no operation can fix.
 *
 * The contract says nothing about how atomicity is achieved: the SQLite adapter
 * uses a savepoint, a PostgreSQL adapter would use a transaction, and the
 * in-memory one just runs the work.
 */
export interface Transaction {
  run<T>(work: () => Promise<T>): Promise<T>;
}
