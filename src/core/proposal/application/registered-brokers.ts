/**
 * REQ-307: whether an id is that of a registered broker.
 *
 * Declared here, by the consumer: the proposal module imports no other module,
 * and the registry that answers it is wired in the composition root.
 */
export interface RegisteredBrokers {
  isRegistered(brokerId: string): Promise<boolean>;
}
