/**
 * Runs a unit of work atomically.
 *
 * Declared again here, by its consumer, rather than imported from the policy
 * module: accepting an invitation creates the user and consumes the invitation
 * as one fact (REQ-422), and a half-applied write would leave either a link
 * that still works for a user already created or a user nobody can create
 * again. The same adapters satisfy both declarations.
 */
export interface Transaction {
  run<T>(work: () => Promise<T>): Promise<T>;
}
