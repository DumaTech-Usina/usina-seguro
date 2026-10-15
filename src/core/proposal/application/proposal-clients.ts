/** REQ-317: the name and CPF of the client, as the user typed them at registration. */
export interface ProposalClientInput {
  readonly name: string;
  readonly cpf: string;
}

/**
 * The clients of the proposals (V2 section 9E), as this module needs them.
 *
 * Declared here, by the consumer: the proposal module imports no other module,
 * and the registry that answers it is wired in the composition root.
 */
export interface ProposalClients {
  /**
   * REQ-317: the id of the client holding the CPF, untouched, or of a client
   * registered now with this name and CPF, signed by `author`. Refuses a
   * missing name or an invalid CPF.
   */
  resolve(client: ProposalClientInput, author: string): Promise<string>;
  /** REQ-319: the ids of the registered clients whose name or CPF matches the term. */
  matching(query: string): Promise<ReadonlySet<string>>;
}
