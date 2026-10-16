/**
 * REQ-229: whether an id is that of an intermediary the reference registry
 * knows.
 *
 * Declared here, by the consumer: the proposal module imports no other module,
 * and the registry that answers it is wired in the composition root.
 */
export interface RegisteredIntermediaries {
  isRegistered(intermediaryId: string): Promise<boolean>;
}
