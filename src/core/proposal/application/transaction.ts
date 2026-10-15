/**
 * Runs a unit of work atomically.
 *
 * Declared again here, by its consumer, rather than imported from the policy
 * module: registering a proposal may register its client, and the two are one
 * act (REQ-317) — a proposal refused after its client was created would leave a
 * client no proposal names (CA-314). The same adapters satisfy every
 * declaration.
 */
export interface Transaction {
  run<T>(work: () => Promise<T>): Promise<T>;
}
