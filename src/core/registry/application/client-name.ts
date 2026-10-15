import type { ClientRepository } from './client-repository.ts';

/**
 * The name to show or to copy for the client a proposal identifies (REQ-318).
 *
 * The proposal holds the client's id. A proposal registered before the client
 * registry holds the text that was typed or read instead (REQ-320): no client
 * has that id, and the text itself is the answer — kept as it is, never
 * matched to a client.
 */
export async function clientNameOf(clients: ClientRepository, clientId: string): Promise<string> {
  return (await clients.findById(clientId))?.name ?? clientId;
}
